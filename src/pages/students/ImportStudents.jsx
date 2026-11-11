import { useState, useCallback, useMemo, useRef } from 'react';
import {
  Upload, FileText, Save, CheckCircle2, AlertTriangle, X, ArrowRight,
  RefreshCw, ChevronRight,
} from 'lucide-react';
import {
  parseFile, validateRows, matchExisting, classifyRows,
  findStudentsToInactivate, commitImport,
} from '../../db/studentImportService.js';
import { getStudents } from '../../db/studentService.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { CLASSES } from '../../utils/constants.js';
import Button from '../../components/common/Button.jsx';
import { Input, Select } from '../../components/common/Input.jsx';
import { authErrorMessage } from '../../lib/authErrors.js';
import {
  PageHeader, Card, LoadingScreen, Badge, StatCard, EmptyState,
} from '../../components/common/Badge.jsx';

const MAPPING_STORAGE_KEY = 'alama_import_column_mapping_v1';

const FIELDS = [
  { key: 'schoolpayCode', label: 'SchoolPay Code', required: true },
  { key: 'fullName', label: 'Full Name', required: true },
  { key: 'classLevel', label: 'Class Level', required: true },
  { key: 'admissionNumber', label: 'Admission Number', required: false },
];

// Alternate header names auto-mapped to each field (checked after the field key
// and label). Lets a SchoolPay "Students" sheet with headers like
// "No.", "Reference Number", "Student Name" map without manual intervention.
const FIELD_SYNONYMS = {
  schoolpayCode: ['reference number', 'referencenumber', 'reference no'],
  fullName: ['student name', 'studentname'],
  classLevel: ['class', 'grade', 'form'],
  admissionNumber: ['no.', 'admission no', 'admissionno'],
};

const ImportStudents = () => {
  const { activeSchoolId } = useAuth();
  const fileInputRef = useRef(null);

  const [stage, setStage] = useState('upload'); // upload | mapping | preview | confirm | result
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [savedMappings, setSavedMappings] = useState({});
  const [validation, setValidation] = useState(null); // {ready, problems}
  const [problems, setProblems] = useState([]);
  const [fixes, setFixes] = useState({}); // rowIndex -> {code, classLevel}
  const [skipped, setSkipped] = useState(new Set());
  const [classified, setClassified] = useState(null); // {categories, counts}
  const [allStudents, setAllStudents] = useState([]);
  const [fullList, setFullList] = useState(false);
  const [inactivationCount, setInactivationCount] = useState(0);
  const [commitResult, setCommitResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');

  // ── Auto-map headers to fields by name similarity ────────────────────────
  const autoMap = useCallback((hs) => {
    const m = {};
    FIELDS.forEach((f) => {
      const lk = f.key.toLowerCase();
      const ll = f.label.toLowerCase();
      const syn = (FIELD_SYNONYMS[f.key] || []).map((s) => s.toLowerCase());
      let match = hs.find((h) => {
        const lh = h.toLowerCase();
        return lh.includes(lk) || lh.includes(ll);
      });
      if (!match) {
        match = hs.find((h) => syn.some((s) => h.toLowerCase().includes(s)));
      }
      m[f.key] = match || '';
    });
    return m;
  }, []);

  // ── Load saved column mappings from localStorage ─────────────────────────
  useCallback(() => {
    try {
      const raw = localStorage.getItem(MAPPING_STORAGE_KEY);
      if (raw) setSavedMappings(JSON.parse(raw));
    } catch (e) { /* ignore */ }
  }, [])();

  // ── Normalize raw rows into standard fields using current mapping ────────
  const normalizedRows = useMemo(() => {
    return rows.map((row) => {
      const n = {};
      FIELDS.forEach((f) => {
        const col = mapping[f.key];
        n[f.key] = col ? String(row[col] || '').trim() : '';
      });
      return n;
    });
  }, [rows, mapping]);

  const requiredFieldsMissing = FIELDS.filter((f) => f.required).some((f) => !mapping[f.key]);

  const applyFixes = useCallback((rs) => {
    return rs.map((r, i) => {
      const fix = fixes[i];
      if (!fix) return r;
      return {
        ...r,
        schoolpayCode: fix.code !== undefined ? fix.code : r.schoolpayCode,
        classLevel: fix.classLevel !== undefined ? fix.classLevel : r.classLevel,
      };
    });
  }, [fixes]);

  // ── Effective ready count AFTER fixes and skips are applied ────────────────
  // Keeps the preview "Ready" count in sync with the confirm-screen total
  // (classified.counts.total) so the numbers match end to end.
  const effectiveReadyCount = useMemo(() => {
    const fixed = applyFixes(normalizedRows);
    const filtered = fixed.filter((_, i) => !skipped.has(i));
    const { ready } = validateRows(filtered, new Map(), CLASSES);
    return ready.length;
  }, [normalizedRows, fixes, skipped, applyFixes]);

  // ── File upload ──────────────────────────────────────────────────────────
  const handleFileChange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(ext)) {
      setError('Please upload a CSV or Excel file (.csv, .xlsx, .xls).');
      return;
    }
    setFile(f);
    setFileName(f.name);
    setError('');
    setStage('upload');
    setParsing(true);
    try {
      const { headers: hs, rows: rs } = await parseFile(f);
      if (!hs || hs.length === 0) {
        setError('The file appears to be empty. Please upload a CSV or Excel file with a header row.');
        setParsing(false);
        resetFileInput();
        return;
      }
      setHeaders(hs);
      setRows(rs);
      setFixes({});
      setSkipped(new Set());
      setMapping(autoMap(hs));
      setStage('mapping');
    } catch (e) {
      setError(`Failed to parse file: ${authErrorMessage(e)}`);
    } finally {
      setParsing(false);
      resetFileInput();
    }
  };

  // Reset the native input so the same file can be picked again (onChange only
  // fires when the value actually changes).
  const resetFileInput = () => {
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = () => {
    if (fileInputRef.current) fileInputRef.current.value = '';
    setFile(null);
    setFileName('');
    setHeaders([]);
    setRows([]);
    setMapping({});
    setValidation(null);
    setProblems([]);
    setFixes({});
    setSkipped(new Set());
    setClassified(null);
    setCommitResult(null);
    setError('');
    setStage('upload');
  };

  // ── Saved mappings ───────────────────────────────────────────────────────
  const saveMapping = () => {
    try {
      const next = { ...savedMappings, [fileName || 'default']: mapping };
      localStorage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(next));
      setSavedMappings(next);
    } catch (e) { /* ignore */ }
  };

  const loadMapping = (name) => {
    setMapping(savedMappings[name] || {});
  };

  // ── Validate + load students ─────────────────────────────────────────────
  const continueToPreview = async () => {
    setError('');
    const { ready, problems: probs } = validateRows(normalizedRows, new Map(), CLASSES);
    setValidation({ ready, problems: probs });
    setProblems(probs);
    setFixes({});
    setSkipped(new Set());

    try {
      const students = await getStudents({ schoolId: activeSchoolId });
      setAllStudents(students);

      // Pre-classify ready rows so link rows can be shown and skipped on preview.
      // This lets an admin spot and skip a wrong admission-number / name+class match
      // before the confirm screen.
      if (ready.length > 0) {
        const matched = matchExisting([...ready], students);
        const codeMap = new Map(
          students.filter((s) => s.schoolpayCode).map((s) => [s.schoolpayCode, s])
        );
        const { categories, counts } = classifyRows(matched, codeMap);
        setClassified({ categories, counts });
      }

      setStage('preview');
    } catch (e) {
      setError(`Failed to load existing students: ${authErrorMessage(e)}`);
    }
  };

  // ── Fix / skip problem rows ──────────────────────────────────────────────
  const setFix = (rowIndex, field, value) => {
    setFixes((prev) => ({ ...prev, [rowIndex]: { ...prev[rowIndex], [field]: value } }));
  };

  const toggleSkip = (rowIndex) => {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  };

  // ── Re-validate after fixes, then build classification ───────────────────
  const continueAfterFixes = () => {
    const fixed = applyFixes(normalizedRows);
    const filtered = fixed.filter((_, i) => !skipped.has(i));
    const { ready, problems: probs } = validateRows(filtered, new Map(), CLASSES);
    setFixes({});
    setSkipped(new Set());
    setValidation({ ready, problems: probs });
    setProblems(probs);
    if (probs.length === 0) {
      goToClassified(ready, allStudents);
    }
  };

  const goToClassified = (readyRows, students) => {
    const matched = matchExisting([...readyRows], students);
    const codeMap = new Map(
      students.filter((s) => s.schoolpayCode).map((s) => [s.schoolpayCode, s])
    );
    const { categories, counts } = classifyRows(matched, codeMap);
    setClassified({ categories, counts });
    setStage('confirm');

    const importedCodes = new Set(readyRows.map((r) => r.code));
    const toInactivate = findStudentsToInactivate(students, importedCodes);
    setInactivationCount(toInactivate.length);
  };

  // ── Commit via batched writes ────────────────────────────────────────────
  const handleCommit = async () => {
    if (!validation) return;
    setLoading(true);
    setError('');
    try {
      const accepted = validation.ready.filter((_, i) => !skipped.has(i));
      const matched = matchExisting([...accepted], allStudents);
      const codeMap = new Map(
        allStudents.filter((s) => s.schoolpayCode).map((s) => [s.schoolpayCode, s])
      );
      const { categories } = classifyRows(matched, codeMap);
      const acceptedRows = [
        ...categories.new,
        ...categories.link,
        ...categories.update,
        ...categories.classChanged,
      ];

      const result = await commitImport(acceptedRows, {
        schoolId:   activeSchoolId,
        fullList,
        studentsToInactivate: fullList
          ? findStudentsToInactivate(
              allStudents,
              new Set(acceptedRows.map((r) => r.code))
            )
          : [],
      });
      setCommitResult(result);
      setStage('result');
    } catch (e) {
      setError(`Commit failed: ${authErrorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const importAnother = () => {
    if (fileInputRef.current) fileInputRef.current.value = '';
    setFile(null);
    setFileName('');
    setHeaders([]);
    setRows([]);
    setMapping({});
    setValidation(null);
    setProblems([]);
    setFixes({});
    setSkipped(new Set());
    setClassified(null);
    setCommitResult(null);
    setError('');
    setStage('upload');
  };

  const counts = classified?.counts || { new: 0, link: 0, update: 0, classChanged: 0, unchanged: 0, total: 0 };

  if (loading) return <LoadingScreen message="Committing import…" />;

  return (
    <div className="space-y-5 animate-fade-in">

      {/* ─── Stage: Upload ─── */}
      {stage === 'upload' && (
        <div className="space-y-5">
          <PageHeader
            title="Import Students"
            subtitle="Upload a SchoolPay export file (CSV or Excel) to bulk-import students."
          />

          {error && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              {error}
            </div>
          )}

          <Card>
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <Upload className="w-12 h-12 text-slate-400 mb-4" />
              <p className="text-sm font-medium text-slate-700 mb-2">
                Click to upload or drag and drop
              </p>
              <p className="text-xs text-slate-500 mb-6">
                Supports .csv, .xlsx, .xls · SchoolPay-owned fields are
                overwritten; school-owned fields are never touched.
              </p>
              <label
                className="cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <Button disabled={parsing || loading}>
                  {parsing ? 'Reading file…' : 'Select File'}
                </Button>
              </label>
              {file && (
                <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                  <FileText className="w-3 h-3" />
                  <span title={fileName}>{fileName}</span>
                  <Button variant="ghost" size="sm" onClick={removeFile}>Remove</Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ─── Stage: Column Mapping ─── */}
      {stage === 'mapping' && (
        <div className="space-y-5">
          <PageHeader
            title="Map Columns"
            subtitle="Match your file columns to student fields. Required fields are marked *."
          />

          <div className="flex items-center gap-2 text-xs text-slate-500 mb-4">
            <span>File: <span className="font-medium">{fileName}</span></span>
            <span>·</span>
            <span>{rows.length} row{rows.length !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span>{headers.length} column{headers.length !== 1 ? 's' : ''}</span>
          </div>

          {Object.keys(savedMappings).length > 0 && (
            <Card className="bg-amber-50 border-amber-100">
              <div className="flex items-center gap-3">
                <Save className="w-4 h-4 text-amber-600" />
                <label className="text-sm text-amber-800">Saved column mapping:</label>
                <Select
                  value=""
                  onChange={(e) => loadMapping(e.target.value)}
                  placeholder="Load saved…"
                  className="w-48"
                >
                  {Object.keys(savedMappings).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </Select>
                <Button variant="ghost" size="sm" onClick={saveMapping}>
                  Save mapping for "{fileName || 'default'}"
                </Button>
              </div>
            </Card>
          )}

          <Card>
            <h3 className="font-display font-semibold text-slate-800 mb-4">Column Mapping</h3>
            <p className="text-sm text-slate-500 mb-4">
              Map each student field to the column in your file.
            </p>
            <div className="space-y-3">
              {FIELDS.map((f) => (
                <div key={f.key} className="flex items-center gap-4">
                  <label className="text-sm font-medium text-slate-700 min-w-[160px]">
                    {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
                  </label>
                  <Select
                    value={mapping[f.key] || ''}
                    onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}
                    placeholder="— ignore —"
                    className="w-64"
                  >
                    <option value="">— ignore —</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          </Card>

          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStage('upload')}>
              Back
            </Button>
            <Button
              onClick={continueToPreview}
              disabled={requiredFieldsMissing}
            >
              Continue to Preview
            </Button>
          </div>
        </div>
      )}

      {/* ─── Stage: Preview (fix-or-skip problems) ─── */}
      {stage === 'preview' && (
        <div className="space-y-5">
          <PageHeader
            title="Preview Import"
            subtitle="Review detected problems before committing changes."
          />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard title="Total Rows" value={rows.length} icon={FileText} color="navy" />
            <StatCard
              title="Ready"
              value={effectiveReadyCount}
              icon={CheckCircle2}
              color="emerald"
            />
            <StatCard title="Problems" value={problems.length} icon={AlertTriangle} color="warning" />
          </div>

          {problems.length > 0 && (
            <Card>
              <h3 className="font-display font-semibold text-slate-800 mb-4">
                Problems to Fix
              </h3>
              <p className="text-sm text-slate-500 mb-4">
                Fix the SchoolPay code or class, or skip the row. Rows with
                unresolved problems will not be imported.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b-2 border-slate-100">
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase">
                        Row
                      </th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase">
                        Reason
                      </th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase">
                        SchoolPay Code
                      </th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase">
                        Class
                      </th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {problems.map((p) => {
                      const fix = fixes[p.rowIndex];
                      const currentCode = fix?.code ?? p.code;
                      const currentClass = fix?.classLevel ?? p.classLevel;
                      return (
                        <tr key={p.rowIndex}>
                          <td className="py-3 px-3 text-sm font-mono text-slate-500">
                            {p.rowIndex + 1}
                          </td>
                          <td className="py-3 px-3 text-sm text-red-600">
                            {p.reason}
                          </td>
                          <td className="py-3 px-3">
                            <Input
                              value={currentCode}
                              onChange={(e) => setFix(p.rowIndex, 'code', e.target.value)}
                              placeholder="Enter code"
                            />
                          </td>
                          <td className="py-3 px-3">
                            <Select
                              value={currentClass}
                              onChange={(e) =>
                                setFix(p.rowIndex, 'classLevel', e.target.value)
                              }
                              placeholder="Select class"
                            >
                              {CLASSES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </Select>
                          </td>
                          <td className="py-3 px-3">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleSkip(p.rowIndex)}
                            >
                              Skip Row
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Link rows to existing students — skippable before commit */}
          {classified?.categories.link?.length > 0 && (
            <Card className="border-blue-100 bg-blue-50">
              <h3 className="font-display font-semibold text-slate-800 mb-4">
                Rows to Link to Existing Students
              </h3>
              <p className="text-sm text-slate-500 mb-4">
                These existing students will be matched to SchoolPay codes. Skip
                any match that looks wrong.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b-2 border-slate-100">
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase">
                        Row
                      </th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase">
                        Full Name
                      </th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase">
                        Class
                      </th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase">
                        Match Method
                      </th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase">
                        SchoolPay Code
                      </th>
                      <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {classified.categories.link.map((item) => {
                      const isSkipped = skipped.has(item.rowIndex);
                      return (
                        <tr key={item.rowIndex}>
                          <td className="py-3 px-3 text-sm font-mono text-slate-500">
                            {item.rowIndex + 1}
                          </td>
                          <td className="py-3 px-3 text-sm text-slate-700">
                            {item.fullName}
                          </td>
                          <td className="py-3 px-3 text-sm text-slate-500">
                            {item.classLevel}
                          </td>
                          <td className="py-3 px-3 text-sm text-slate-500">
                            {item.matchMethod}
                          </td>
                          <td className="py-3 px-3 text-sm font-mono text-slate-700">
                            {item.code}
                          </td>
                          <td className="py-3 px-3">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleSkip(item.rowIndex)}
                            >
                              {isSkipped ? 'Undo Skip' : 'Skip Row'}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStage('mapping')}>
              Back to Mapping
            </Button>
            <Button onClick={continueAfterFixes}>
              Continue to Review
            </Button>
          </div>
        </div>
      )}

      {/* ─── Stage: Confirm (counts + inactivation safeguard) ─── */}
      {stage === 'confirm' && (
        <div className="space-y-5">
          <PageHeader
            title="Confirm Import"
            subtitle="Review what will be written before committing."
          />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard title="New Students" value={counts.new} icon={ArrowRight} color="emerald" />
            <StatCard
              title="Link to SchoolPay"
              value={counts.link}
              icon={Save}
              color="blue"
            />
            <StatCard
              title="Name Updated"
              value={counts.update}
              icon={RefreshCw}
              color="amber"
            />
            <StatCard
              title="Class Changed"
              value={counts.classChanged}
              icon={RefreshCw}
              color="purple"
            />
            <StatCard title="Unchanged" value={counts.unchanged} icon={CheckCircle2} color="slate" />
          </div>

          <Card>
            <h3 className="font-display font-semibold text-slate-800 mb-4">
              Inactivation Safeguard
            </h3>
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={fullList}
                onChange={(e) => setFullList(e.target.checked)}
                className="mt-1 text-navy-600"
              />
              <div>
                <label className="text-sm font-medium text-slate-700">
                  Mark students absent from this import as inactive
                </label>
                {inactivationCount > 0 ? (
                  <p className="text-sm text-red-600">
                    {inactivationCount} schoolpay student(s) will be set to
                    inactive.
                  </p>
                ) : (
                  <p className="text-sm text-slate-500">
                    No schoolpay students absent from this import.
                  </p>
                )}
                <p className="text-xs text-slate-400 mt-1">
                  Manual students are never inactivated. Students are never
                  deleted.
                </p>
              </div>
            </div>
          </Card>

          {counts.link > 0 && (
            <Card className="border-blue-100 bg-blue-50">
              <h3 className="font-semibold text-blue-800 mb-2">
                {counts.link} student(s) will be linked to SchoolPay
              </h3>
              <p className="text-sm text-blue-700">
                Existing students without a SchoolPay code will be matched by
                admission number and linked to this import.
              </p>
            </Card>
          )}

          {counts.classChanged > 0 && (
            <Card className="border-amber-100 bg-amber-50">
              <h3 className="font-semibold text-amber-800 mb-2">
                {counts.classChanged} student(s) changing class
              </h3>
              <p className="text-sm text-amber-700">
                Class history will be appended, stream cleared, and flagged as
                needing a stream.
              </p>
            </Card>
          )}

          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStage('preview')}>
              Back
            </Button>
            <Button onClick={handleCommit} disabled={loading}>
              Commit Import
            </Button>
          </div>
        </div>
      )}

      {/* ─── Stage: Result ─── */}
      {stage === 'result' && (
        <div className="space-y-5">
          <PageHeader title="Import Complete" subtitle="Students imported successfully." />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard title="Rows Written" value={commitResult.written} icon={CheckCircle2} color="emerald" />
            <StatCard title="Inactivated" value={commitResult.inactivated} icon={X} color="red" />
          </div>

          <Card>
            <h3 className="font-display font-semibold text-slate-800 mb-4">
              What happened
            </h3>
            <ul className="list-disc list-inside text-sm text-slate-600 space-y-2">
              <li>
                New students created with doc ID = SchoolPay code
              </li>
              <li>
                Existing students updated (SchoolPay-owned fields only)
              </li>
              <li>
                Class changes recorded in classHistory; stream cleared
              </li>
              <li>
                School-owned fields (stream, guardian, notes, marks) preserved
              </li>
              <li>
                Absent schoolpay students marked inactive (never deleted)
              </li>
            </ul>
          </Card>

          <div className="flex justify-end">
            <Button onClick={importAnother}>Import Another File</Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImportStudents;
