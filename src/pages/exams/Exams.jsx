import { useState, useEffect, useCallback } from 'react';
import { Plus, BookOpen, Trash2, ClipboardList, FileText, Printer, ChevronDown } from 'lucide-react';
import { getExams, createExam, deleteExam, getResultsForExam, bulkSaveResults } from '../../db/examService.js';
import { getStudents } from '../../db/studentService.js';
import { getSubjects } from '../../db/subjectService.js';
import { getConfig } from '../../db/configService.js';
import { getProjectWork } from '../../db/projectWorkService.js';
import { getReportCardData } from '../../db/reportCardService.js';
import { printReportCard, printBroadsheet } from '../../utils/printUtils.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { CLASSES, STREAMS, EXAM_TYPES } from '../../utils/constants.js';
import { formatDate, getGradeFromMarks } from '../../utils/grading.js';
import Button from '../../components/common/Button.jsx';
import Modal, { ConfirmModal } from '../../components/common/Modal.jsx';
import { Input, Select, FormRow } from '../../components/common/Input.jsx';
import { GradeBadge, EmptyState, PageHeader, Card, Badge, LoadingScreen } from '../../components/common/Badge.jsx';

/** Detect NLSC cards from data attached by resultsService (grading interface). */
const isNlscCard = (card) => Boolean(card && card.subjectsAtDOrAbove !== undefined);

/* ─────────────────────────────────────────────
   CREATE EXAM MODAL (unchanged)
───────────────────────────────────────────── */
const ExamModal = ({ open, onClose, onSave, config }) => {
  const [form, setForm] = useState({ name: '', examType: 'CAT', classLevel: 'S1', classStream: 'all', subjectId: '', subjectName: '', outOf: '100', date: '' });
  const [subjects, setSubjects] = useState([]);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    if (open) {
      setError('');
      setForm((p) => ({ ...p, academicYear: config?.academicYear, term: config?.currentTerm }));
      getSubjects({ classLevel: form.classLevel }).then(setSubjects);
    }
  }, [open, config]);

  useEffect(() => {
    getSubjects({ classLevel: form.classLevel }).then(setSubjects);
  }, [form.classLevel]);

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Exam name is required.'); return; }
    if (!form.subjectId)   { setError('Select a subject.'); return; }
    setLoading(true);
    try {
      const subj = subjects.find((s) => s.id === form.subjectId);
      await onSave({ ...form, subjectName: subj?.name || '' });
      onClose();
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Exam" size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSave} loading={loading}>Create Exam</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Exam Name" required placeholder="e.g. Mathematics Term 1 Final"
          value={form.name} onChange={set('name')} />
        <FormRow>
          <Select label="Exam Type" value={form.examType} onChange={set('examType')}>
            {EXAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Input label="Date" type="date" value={form.date} onChange={set('date')} />
        </FormRow>
        <FormRow>
          <Select label="Class" value={form.classLevel} onChange={set('classLevel')}>
            {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select label="Stream" value={form.classStream} onChange={set('classStream')}>
            <option value="all">All Streams</option>
            {STREAMS.map((s) => <option key={s} value={`${form.classLevel}${s}`}>{form.classLevel}{s}</option>)}
          </Select>
        </FormRow>
        <FormRow>
          <Select label="Subject" required value={form.subjectId} onChange={set('subjectId')} placeholder="Select subject">
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Input label="Out of (Max Marks)" type="number" value={form.outOf} onChange={set('outOf')} />
        </FormRow>
        {subjects.length === 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            No subjects configured for {form.classLevel}. Go to Settings → Subjects to add them.
          </p>
        )}
        {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}
      </div>
    </Modal>
  );
};

/* ─────────────────────────────────────────────
   ENTER MARKS MODAL (unchanged)
───────────────────────────────────────────── */
const MarksModal = ({ open, onClose, exam }) => {
  const { user } = useAuth();
  const [students, setStudents] = useState([]);
  const [marks, setMarks]       = useState({});
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [saveErrors, setSaveErrors] = useState({});

  useEffect(() => {
    if (!open || !exam) return;
    setSaved(false);
    setSaveErrors({});
    const stream = exam.classStream === 'all' ? undefined : exam.classStream.slice(2);
    Promise.all([
      getStudents({ classLevel: exam.classLevel, stream }),
      getResultsForExam(exam.id),
    ]).then(([studs, results]) => {
      setStudents(studs);
      const map = {};
      results.forEach((r) => { map[r.studentId] = String(r.marks); });
      const defaultMap = {};
      studs.forEach((s) => { defaultMap[s.id] = map[s.id] || ''; });
      setMarks(defaultMap);
    }).finally(() => setLoading(false));
  }, [open, exam]);

  const validateMarks = () => {
    const errors = {};
    const outOf = Number(exam?.outOf) || 100;
    let hasError = false;

    students.forEach((s) => {
      const val = marks[s.id];
      if (val === '' || val === null || val === undefined) {
        // Missing marks — not an error, just not saved
        return;
      }
      const n = Number(val);
      if (isNaN(n)) {
        errors[s.id] = 'Invalid mark';
        hasError = true;
      } else if (n < 0 || n > outOf) {
        errors[s.id] = `Mark must be between 0 and ${outOf}`;
        hasError = true;
      }
    });

    setSaveErrors(errors);
    return !hasError;
  };

  const handleSave = async () => {
    if (!validateMarks()) return;

    setSaving(true);
    setSaveErrors({});
    try {
      // Only save marks that have been entered — do NOT convert missing/empty to zero
      const toSave = students
        .filter((s) => marks[s.id] !== '' && marks[s.id] !== null && marks[s.id] !== undefined)
        .map((s) => ({ studentId: s.id, marks: Number(marks[s.id]) }));

      if (toSave.length === 0) {
        setSaved(true);
        return;
      }

      await bulkSaveResults(exam.id, toSave, exam.outOf, user.id);
      setSaved(true);
    } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg"
      title={`Enter Marks — ${exam?.name || ''}`}
      subtitle={`Out of ${exam?.outOf} marks`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {saved
            ? <span className="text-emerald-600 text-sm font-medium">✓ Marks saved</span>
            : <Button onClick={handleSave} loading={saving} icon={ClipboardList}>Save Marks</Button>
          }
        </>
      }
    >
      {loading ? <LoadingScreen /> : students.length === 0 ? (
        <EmptyState icon={BookOpen} title="No students found" message="No active students in this class/stream." />
      ) : (
        <div className="space-y-1">
          <div className="grid grid-cols-12 gap-2 px-2 pb-2 border-b border-slate-100">
            <span className="col-span-1 text-xs text-slate-400">#</span>
            <span className="col-span-5 text-xs text-slate-400 font-semibold uppercase tracking-wide">Student</span>
            <span className="col-span-3 text-xs text-slate-400 font-semibold uppercase tracking-wide">Marks</span>
            <span className="col-span-3 text-xs text-slate-400 font-semibold uppercase tracking-wide">Grade</span>
          </div>
          {students.map((s, idx) => {
            const m = Number(marks[s.id]);
            const gradeInfo = marks[s.id] !== '' ? getGradeFromMarks(m, exam?.outOf) : null;
            return (
              <div key={s.id} className="grid grid-cols-12 gap-2 items-center py-1.5 px-2 rounded-lg hover:bg-slate-50">
                <span className="col-span-1 text-xs text-slate-400">{idx + 1}</span>
                <div className="col-span-5">
                  <p className="text-sm font-medium text-slate-800">{s.fullName}</p>
                  <p className="text-xs text-slate-400">{s.admissionNumber}</p>
                </div>
                <div className="col-span-3 flex flex-col gap-0.5">
                  <input type="number" min="0" max={exam?.outOf}
                    value={marks[s.id] ?? ''}
                    onChange={(e) => setMarks((p) => ({ ...p, [s.id]: e.target.value }))}
                    className={
                      'w-full h-8 px-2 rounded-lg border text-sm focus:outline-none focus:ring-2 text-center ' +
                      (saveErrors[s.id]
                        ? 'border-red-400 focus:ring-red-400'
                        : 'border-slate-200 focus:ring-navy-500 hover:border-slate-300')
                    }
                    placeholder="—"
                  />
                  {saveErrors[s.id] && (
                    <span className="text-xs text-red-600">{saveErrors[s.id]}</span>
                  )}
                </div>
                <div className="col-span-3">
                  {gradeInfo ? (
                    <div className="flex items-center gap-1">
                      <GradeBadge grade={gradeInfo.grade} />
                      <span className="text-xs text-slate-400">{gradeInfo.percentage}%</span>
                    </div>
                  ) : <span className="text-xs text-slate-300">—</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
};

/* ─────────────────────────────────────────────
   REPORT CARDS MODAL  ← NEW
───────────────────────────────────────────── */
const ReportCardsModal = ({ open, onClose, config }) => {
  const [classLevel, setClassLevel] = useState('S1');
  const [stream, setStream]         = useState('all');
  const [loading, setLoading]       = useState(false);
  const [cards, setCards]           = useState(null);   // null = not yet loaded
  const [error, setError]           = useState('');
  const [printing, setPrinting]     = useState(null);   // studentId being printed

  // Reset when re-opened
  useEffect(() => {
    if (open) { setCards(null); setError(''); }
  }, [open]);

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    setCards(null);
    try {
      const data = await getReportCardData(classLevel, stream, config?.academicYear, config?.currentTerm);
      if (data.reportCards.length === 0) {
        setError('No students or no exam results found for this selection.');
      } else {
        setCards(data);
      }
    } catch (e) {
      setError(e.message || 'Failed to load report card data.');
    } finally {
      setLoading(false);
    }
  };

  const handlePrintOne = async (card) => {
    setPrinting(card.student.id);
    try {
      const printData = { ...card };
      // NLSC: attach project work for the stand-alone line on the report card
      if (card.subjectsAtDOrAbove !== undefined) {
        try {
          const pw = await getProjectWork({ studentId: card.student.id, year: config?.academicYear });
          printData.projectWork = pw;
        } catch (e) {
          console.warn('Could not load project work for print:', e.message);
          printData.projectWork = [];
        }
      }
      printReportCard(printData, {
        name:    config?.schoolName    || '',
        address: config?.schoolAddress || '',
        motto:   config?.schoolMotto   || '',
        logoUrl: config?.logoUrl       || '',
      }, {
        academicYear: config?.academicYear,
        term:         config?.currentTerm,
      });
    } finally {
      setTimeout(() => setPrinting(null), 600);
    }
  };

  const handlePrintAll = () => {
    if (!cards) return;
    cards.reportCards.forEach((card, i) => {
      // stagger slightly so browser doesn't block multiple popups
      setTimeout(() => handlePrintOne(card), i * 150);
    });
  };

  const gradeColor = (g) => {
    const map = { A: 'text-emerald-700', B: 'text-sky-700', C: 'text-amber-700', D: 'text-orange-600', F: 'text-red-600', U: 'text-red-600' };
    return map[g?.[0]] || 'text-slate-600';
  };

  return (
    <Modal open={open} onClose={onClose} title="Generate Report Cards" size="xl"
      subtitle={config ? `${config.currentTerm}, ${config.academicYear}` : ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {cards && (
            <Button icon={Printer} onClick={handlePrintAll}>
              Print All ({cards.reportCards.length})
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        {/* Filters */}
        <div className="flex items-end gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Class</label>
            <select
              value={classLevel}
              onChange={(e) => { setClassLevel(e.target.value); setCards(null); }}
              className="w-full h-9 px-3 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-navy-500"
            >
              {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Stream</label>
            <select
              value={stream}
              onChange={(e) => { setStream(e.target.value); setCards(null); }}
              className="w-full h-9 px-3 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-navy-500"
            >
              <option value="all">All Streams</option>
              {STREAMS.map((s) => <option key={s} value={`${classLevel}${s}`}>{classLevel}{s}</option>)}
            </select>
          </div>
          <Button onClick={handleGenerate} loading={loading} icon={FileText}>
            Generate
          </Button>
        </div>

        {error && (
          <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">{error}</div>
        )}

        {/* Results table */}
        {cards && (
          <div>
            <p className="text-xs text-slate-400 mb-3">
              {cards.reportCards.length} student{cards.reportCards.length !== 1 ? 's' : ''} · {cards.subjects.length} subject{cards.subjects.length !== 1 ? 's' : ''}
              {cards.reportCards[0]?.subjectsAtDOrAbove !== undefined && (
                <span className="text-slate-400 ml-2">· NLSC (competence-based) grading</span>
              )}
            </p>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-navy-900 text-white">
                    <th className="px-4 py-2.5 text-left font-semibold text-xs uppercase tracking-wide">Pos</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-xs uppercase tracking-wide">Student</th>
                    {cards.subjects.map((s) => (
                      <th key={s} className="px-3 py-2.5 text-center font-semibold text-xs uppercase tracking-wide whitespace-nowrap">{s}</th>
                    ))}
                    {cards.reportCards[0]?.subjectsAtDOrAbove !== undefined ? (
                      <>
                        <th className="px-4 py-2.5 text-center font-semibold text-xs uppercase tracking-wide">D+</th>
                        <th className="px-4 py-2.5 text-center font-semibold text-xs uppercase tracking-wide">Cert.</th>
                      </>
                    ) : (
                      <>
                        <th className="px-4 py-2.5 text-center font-semibold text-xs uppercase tracking-wide">Avg %</th>
                        <th className="px-4 py-2.5 text-center font-semibold text-xs uppercase tracking-wide">Grade</th>
                      </>
                    )}
                    <th className="px-4 py-2.5 text-right font-semibold text-xs uppercase tracking-wide">Print</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.reportCards.map((card, idx) => {
                    const isNlsc = card.subjectsAtDOrAbove !== undefined;
                    return (
                      <tr key={card.student.id}
                        className={`border-b border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'} hover:bg-navy-50/40 transition-colors`}
                      >
                        <td className="px-4 py-2.5 text-xs text-slate-400 font-medium">
                          {card.position ?? '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-slate-800">{card.student.fullName}</p>
                          <p className="text-xs text-slate-400">{card.student.admissionNumber}</p>
                        </td>
                        {cards.subjects.map((subj) => {
                          const row = card.subjectRows.find((r) => r.subjectName === subj);
                          if (isNlsc) {
                            const final = row?.finalScore !== null ? row.finalScore : '—';
                            const letter = row?.letter || '—';
                            return (
                              <td key={subj} className="px-3 py-2.5 text-center text-xs">
                                <div className="font-medium">{final}</div>
                                <div className={`text-xs font-bold ${gradeColor(letter)}`}>{letter}</div>
                              </td>
                            );
                          }
                          return (
                            <td key={subj} className="px-3 py-2.5 text-center text-xs">
                              {row?.totalMarks !== null ? (
                                <span className="font-medium">{row.totalMarks}<span className="text-slate-400">/{row.totalOutOf}</span></span>
                              ) : <span className="text-slate-300">—</span>}
                            </td>
                          );
                        })}
                        {isNlsc ? (
                          <>
                            <td className="px-4 py-2.5 text-center font-semibold">
                              {card.subjectsAtDOrAbove !== null ? card.subjectsAtDOrAbove : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-center font-semibold">
                              {card.certificateEligible ? 'YES' : 'NO'}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-2.5 text-center font-semibold">
                              {card.avgPercentage !== null ? `${card.avgPercentage}%` : '—'}
                            </td>
                            <td className={`px-4 py-2.5 text-center font-bold text-base ${gradeColor(card.overallGrade)}`}>
                              {card.overallGrade}
                            </td>
                          </>
                        )}
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => handlePrintOne(card)}
                            disabled={printing === card.student.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-navy-100 text-navy-700 hover:bg-navy-200 text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            <Printer className="w-3 h-3" />
                            {printing === card.student.id ? '...' : 'Print'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

/*** BROADSHEET MODAL START ***/
const BroadsheetModal = ({ open, onClose, config }) => {
  const [classLevel, setClassLevel] = useState('S1');
  const [stream, setStream]         = useState('all');
  const [loading, setLoading]       = useState(false);
  const [data, setData]             = useState(null);
  const [error, setError]           = useState('');

  useEffect(() => {
    if (open) { setData(null); setError(''); }
  }, [open]);

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    setData(null);
    try {
      const result = await getReportCardData(classLevel, stream, config?.academicYear, config?.currentTerm);
      if (result.reportCards.length === 0) {
        setError('No students or no exam results found for this selection.');
      } else {
        setData(result);
      }
    } catch (e) {
      setError(e.message || 'Failed to load broadsheet data.');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    if (!data) return;
    printBroadsheet(data, {
      name:    config?.schoolName    || '',
      address: config?.schoolAddress || '',
      motto:   config?.schoolMotto   || '',
      logoUrl: config?.logoUrl       || '',
    }, {
      academicYear: config?.academicYear,
      term:         config?.currentTerm,
    });
  };

  const gradeColor = (g) => {
    const map = { A: 'text-emerald-700', B: 'text-sky-700', C: 'text-amber-700', D: 'text-orange-600', F: 'text-red-600', U: 'text-red-600' };
    return map[g?.[0]] || 'text-slate-600';
  };

  return (
    <Modal open={open} onClose={onClose} title="Class Broadsheet" size="full"
      subtitle={config ? config.currentTerm + ", " + config.academicYear : ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {data && (
            <Button icon={Printer} onClick={handlePrint} loading={loading}>
              Print Broadsheet
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        {/* Filters */}
        <div className="flex items-end gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Class</label>
            <select
              value={classLevel}
              onChange={(e) => { setClassLevel(e.target.value); setData(null); }}
              className="w-full h-9 px-3 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-navy-500"
            >
              {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Stream</label>
            <select
              value={stream}
              onChange={(e) => { setStream(e.target.value); setData(null); }}
              className="w-full h-9 px-3 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-navy-500"
            >
              <option value="all">All Streams</option>
              {STREAMS.map((s) => <option key={s} value={classLevel + s}>{classLevel}{s}</option>)}
            </select>
          </div>
          <Button onClick={handleGenerate} loading={loading} icon={FileText}>
            Generate
          </Button>
        </div>

        {error && (
          <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">{error}</div>
        )}

        {/* Results table */}
        {data && (
          <div className="overflow-x-auto">
            <p className="text-xs text-slate-400 mb-3">
              {data.reportCards.length} student{data.reportCards.length !== 1 ? 's' : ''} · {data.subjects.length} subject{data.subjects.length !== 1 ? 's' : ''}
              {data.reportCards[0]?.subjectsAtDOrAbove !== undefined && (
                <span className="text-slate-400 ml-2">· NLSC (competence-based) grading</span>
              )}
            </p>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm min-w-full">
                <thead>
                  <tr className="bg-navy-900 text-white">
                    <th className="px-4 py-2.5 text-left font-semibold text-xs uppercase tracking-wide">#</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-xs uppercase tracking-wide">Student Name</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-xs uppercase tracking-wide">Adm No</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-xs uppercase tracking-wide">Stream</th>
                    {data.subjects.map((subj) => (
                      <th key={subj} className="px-3 py-2.5 text-center font-semibold text-xs uppercase tracking-wide whitespace-nowrap">{subj}</th>
                    ))}
                    {data.reportCards[0]?.subjectsAtDOrAbove !== undefined ? (
                      <>
                        <th className="px-4 py-2.5 text-center font-semibold text-xs uppercase tracking-wide">Subjects at D+</th>
                        <th className="px-4 py-2.5 text-center font-semibold text-xs uppercase tracking-wide">Certificate</th>
                      </>
                    ) : (
                      <>
                        <th className="px-4 py-2.5 text-center font-semibold text-xs uppercase tracking-wide">Total</th>
                        <th className="px-4 py-2.5 text-center font-semibold text-xs uppercase tracking-wide">Avg %</th>
                        <th className="px-4 py-2.5 text-center font-semibold text-xs uppercase tracking-wide">Grade</th>
                      </>
                    )}
                    <th className="px-4 py-2.5 text-center font-semibold text-xs uppercase tracking-wide">Stream Position</th>
                    <th className="px-4 py-2.5 text-center font-semibold text-xs uppercase tracking-wide">Overall Class Position</th>
                  </tr>
                </thead>
                <tbody>
                  {data.reportCards.map((card, idx) => {
                    const isNlsc = card.subjectsAtDOrAbove !== undefined;
                    return (
                      <tr key={card.student.id}
                        className={'border-b border-slate-100 ' + (idx % 2 === 0 ? 'bg-white' : 'bg-slate-50') + ' hover:bg-navy-50/40 transition-colors'}
                      >
                        <td className="px-4 py-2.5 text-xs text-slate-400 font-medium">{idx + 1}</td>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-slate-800">{card.student.fullName}</p>
                          <p className="text-xs text-slate-400">{card.student.admissionNumber}</p>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">{card.student.admissionNumber}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">
                          {card.streamKey || (card.student.classLevel || classLevel) + (card.student.stream || '')}
                        </td>
                        {data.subjects.map((subj) => {
                          const row = card.subjectRows.find((r) => r.subjectName === subj);
                          if (isNlsc) {
                            const final = row?.finalScore !== null ? row.finalScore : '—';
                            const letter = row?.letter || '—';
                            return (
                              <td key={subj} className="px-3 py-2.5 text-center text-xs">
                                <div className="font-medium">{final}</div>
                                <div className={`text-xs font-bold ${gradeColor(letter)}`}>{letter}</div>
                              </td>
                            );
                          }
                          return (
                            <td key={subj} className="px-3 py-2.5 text-center text-xs">
                              {row?.totalMarks !== null ? (
                                <span className="font-medium">{row.totalMarks}<span className="text-slate-400">/{row.totalOutOf}</span></span>
                              ) : <span className="text-slate-300">—</span>}
                            </td>
                          );
                        })}
                        {isNlsc ? (
                          <>
                            <td className="px-4 py-2.5 text-center font-semibold">
                              {card.subjectsAtDOrAbove !== null ? card.subjectsAtDOrAbove : '—'}
                            </td>
                            <td className={`px-4 py-2.5 text-center font-bold text-base ${card.certificateEligible ? 'text-emerald-700' : 'text-red-600'}`}>
                              {card.certificateEligible ? 'YES' : 'NO'}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-2.5 text-center font-semibold">
                              {card.aggMarks !== null ? card.aggMarks : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-center font-semibold">
                              {card.avgPercentage !== null ? card.avgPercentage + '%' : '—'}
                            </td>
                            <td className={'px-4 py-2.5 text-center font-bold text-base ' + gradeColor(card.overallGrade)}>
                              {card.overallGrade}
                            </td>
                          </>
                        )}
                        <td className="px-4 py-2.5 text-center text-xs">
                          {card.streamPosition !== null ? card.streamPosition + ' / ' + (card.streamTotal || '—') : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-center text-xs">
                          {card.overallClassPosition !== null ? card.overallClassPosition + ' / ' + (card.overallClassTotal || '—') : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

/*** BROADSHEET MODAL END ***/
const Exams = () => {
  const { user } = useAuth();
  const [exams, setExams]               = useState([]);
  const [config, setConfig]             = useState(null);
  const [loading, setLoading]           = useState(true);
  const [createOpen, setCreateOpen]     = useState(false);
  const [reportCardsOpen, setReportCardsOpen] = useState(false);   // ← NEW
  const [broadsheetOpen, setBroadsheetOpen]   = useState(false);   // ← NEW
  const [marksExam, setMarksExam]       = useState(null);
  const [deleting, setDeleting]         = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await getConfig();
      setConfig(cfg);
      setExams(await getExams({ academicYear: cfg?.academicYear, term: cfg?.currentTerm }));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (form) => {
    await createExam(form, user.id);
    await load();
  };

  const handleDelete = async () => {
    setActionLoading(true);
    try { await deleteExam(deleting.id); await load(); }
    finally { setActionLoading(false); setDeleting(null); }
  };

  const EXAM_TYPE_COLORS = { CAT: 'info', Midterm: 'warning', Final: 'navy' };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Exams & Results"
        subtitle={config ? `${config.currentTerm}, ${config.academicYear}` : ''}
        actions={
          <div className="flex items-center gap-2">
            {/* Report Cards button — only meaningful once exams exist */}
            {exams.length > 0 && (
              <>
                <Button
                  variant="secondary"
                  icon={FileText}
                  onClick={() => setReportCardsOpen(true)}
                >
                  Report Cards
                </Button>
                <Button
                  variant="secondary"
                  icon={ClipboardList}
                  onClick={() => setBroadsheetOpen(true)}
                >
                  Class Broadsheet
                </Button>
              </>
            )}
            <Button icon={Plus} onClick={() => setCreateOpen(true)}>Create Exam</Button>
          </div>
        }
      />

      <Card>
        {loading ? <LoadingScreen /> : exams.length === 0 ? (
          <EmptyState icon={BookOpen} title="No exams created"
            message="Create an exam to start entering marks."
            action={<Button icon={Plus} onClick={() => setCreateOpen(true)}>Create Exam</Button>}
          />
        ) : (
          <div className="space-y-2">
            {exams.map((exam) => (
              <div key={exam.id} className="flex items-center gap-4 p-4 rounded-xl border border-slate-100 hover:border-navy-200 hover:bg-navy-50/30 transition-all group">
                <div className="w-10 h-10 rounded-xl bg-navy-100 flex items-center justify-center flex-shrink-0">
                  <BookOpen className="w-5 h-5 text-navy-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800">{exam.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="navy">{exam.classStream === 'all' ? exam.classLevel : exam.classStream}</Badge>
                    <Badge variant={EXAM_TYPE_COLORS[exam.examType] || 'default'}>{exam.examType}</Badge>
                    <span className="text-xs text-slate-400">{exam.subjectName}</span>
                    {exam.date && <span className="text-xs text-slate-400">· {formatDate(exam.date)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button size="sm" variant="secondary" icon={ClipboardList}
                    onClick={() => setMarksExam(exam)}>
                    Enter Marks
                  </Button>
                  <Button size="xs" variant="ghost" icon={Trash2}
                    className="text-red-500 hover:bg-red-50"
                    onClick={() => setDeleting(exam)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ExamModal open={createOpen} onClose={() => setCreateOpen(false)} onSave={handleCreate} config={config} />
      <MarksModal open={!!marksExam} onClose={() => setMarksExam(null)} exam={marksExam} />
      <ReportCardsModal open={reportCardsOpen} onClose={() => setReportCardsOpen(false)} config={config} />
      <BroadsheetModal open={broadsheetOpen} onClose={() => setBroadsheetOpen(false)} config={config} />
      <ConfirmModal
        open={!!deleting} onClose={() => setDeleting(null)}
        onConfirm={handleDelete} loading={actionLoading}
        title="Delete Exam"
        message={`Delete "${deleting?.name}" and all its results? This cannot be undone.`}
      />
    </div>
  );
};

export default Exams;
