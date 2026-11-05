import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plus, Edit, Trash2, Save, RefreshCw } from 'lucide-react';
import { getProjectWork, saveProjectWork, updateProjectWork, deleteProjectWork, ACHIEVEMENT_LEVELS } from '../../db/projectWorkService.js';
import { getStudents } from '../../db/studentService.js';
import { getConfig } from '../../db/configService.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { CLASSES, STREAMS } from '../../utils/constants.js';
import { generateAcademicYears } from '../../utils/grading.js';
import Button from '../../components/common/Button.jsx';
import Modal from '../../components/common/Modal.jsx';
import { Input, Select, Textarea, FormRow } from '../../components/common/Input.jsx';
import { PageHeader, Card, Badge, EmptyState, LoadingScreen } from '../../components/common/Badge.jsx';

const LEVEL_COLOR = {
  A: 'bg-emerald-100 text-emerald-800',
  B: 'bg-blue-100 text-blue-800',
  C: 'bg-amber-100 text-amber-800',
  D: 'bg-orange-100 text-orange-800',
  E: 'bg-red-100 text-red-800',
};

/** Project Work management — new curriculum stand-alone records shown on NLSC report cards. */
export const ProjectWork = () => {
  const { user } = useAuth();
  const [config, setConfig] = useState(null);
  const [students, setStudents] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // record id being edited
  const [form, setForm] = useState({ studentId: '', year: '', title: '', subjectOrArea: '', achievementLevel: 'A', assessorId: '', notes: '' });
  const [error, setError] = useState('');
  const [classLevel, setClassLevel] = useState('');   // UI-only grouping aid, not saved
  const [stream, setStream] = useState('');           // UI-only grouping aid, not saved
  const [errors, setErrors] = useState({});           // inline field errors
  const studentRef = useRef(null);
  const titleRef = useRef(null);
  const levelRef = useRef(null);
  const [saved, setSaved] = useState(false);

  // Set a form field and clear any inline error for that field as soon as it is corrected.
  const set = (f) => (e) => {
    setForm((p) => ({ ...p, [f]: e.target.value }));
    if (errors[f]) setErrors((prev) => ({ ...prev, [f]: '' }));
  };

  const years = generateAcademicYears();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfg, studs] = await Promise.all([getConfig(), getStudents({ status: 'active' })]);
        if (cancelled) return;
        setConfig(cfg);
        setStudents(studs);
      } catch (e) {
        setError(e.message || 'Failed to load project work data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadRecords = useCallback(async () => {
    try {
      const recs = await getProjectWork();
      setRecords(recs);
    } catch (e) {
      setError(e.message || 'Failed to load project work records.');
    }
  }, []);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  const studentById = (id) => students.find((s) => s.id === id) || {};

  // Students filterable by the UI-only class/stream grouping aids (not saved to the record).
  const classStudents = useMemo(() => {
    return students.filter((s) => {
      if (s.classLevel !== classLevel) return false;
      if (stream && s.stream !== stream) return false;
      return true;
    });
  }, [students, classLevel, stream]);

  // NOTE: generateAcademicYears() currently returns range years (e.g. "2026/2027").
  // Once the academic-year step is implemented, switch this to single-year
  // values (2026 onward) per the scope requirement.
  const yearOptions = [...new Set([...records.map((r) => r.year), ...(config ? [config.academicYear] : []), ...years])];

  const resetForm = () => {
    setForm({ studentId: '', year: config?.academicYear || yearOptions[0] || '', title: '', subjectOrArea: '', achievementLevel: 'A', assessorId: user?.id || '', notes: '' });
    setClassLevel('');
    setStream('');
    setErrors({});
  };

  const handleOpen = (record = null) => {
    setError('');
    setSaved(false);
    setErrors({});
    if (record) {
      const s = students.find((st) => st.id === record.studentId) || {};
      setEditing(record.id);
      setClassLevel(s.classLevel || '');
      setStream(s.stream || '');
      setForm({
        studentId: record.studentId || '',
        year: record.year || '',
        title: record.title || '',
        subjectOrArea: record.subjectOrArea || '',
        achievementLevel: record.achievementLevel || 'A',
        assessorId: record.assessorId || '',
        notes: record.notes || '',
      });
    } else {
      setEditing(null);
      resetForm();
    }
    setOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const next = {};
    if (!form.studentId) next.studentId = 'Select a student.';
    if (!form.title.trim()) next.title = 'Project title is required.';
    if (!ACHIEVEMENT_LEVELS.includes(form.achievementLevel)) next.achievementLevel = 'Select an achievement level.';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      if (studentRef.current) studentRef.current.focus();
      else if (titleRef.current) titleRef.current.focus();
      else if (levelRef.current) levelRef.current.focus();
      return;
    }
    setSaving(true);
    try {
      const data = {
        studentId: form.studentId,
        year: form.year,
        title: form.title.trim(),
        subjectOrArea: form.subjectOrArea.trim(),
        achievementLevel: form.achievementLevel,
        assessorId: form.assessorId.trim(),
        notes: form.notes.trim(),
      };
      if (editing) {
        await updateProjectWork(editing, data);
      } else {
        await saveProjectWork(data);
      }
      setSaved(true);
      setOpen(false);
      setEditing(null);
      resetForm();
      await loadRecords();
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this project work record?')) return;
    try {
      await deleteProjectWork(id);
      await loadRecords();
    } catch (e) { setError(e.message || 'Failed to delete.'); }
  };

  if (loading) return <LoadingScreen message="Loading project work…" />;

  return (
    <div className="space-y-5 animate-fade-in max-w-5xl">
      <PageHeader
        title="Project Work (New Curriculum)"
        subtitle="Competence-based project work records — shown as a stand-alone line on NLSC report cards and transcripts"
        actions={
          <div className="flex items-center gap-2">
            <Button icon={RefreshCw} onClick={loadRecords} size="sm">Refresh</Button>
            <Button icon={Plus} onClick={() => handleOpen(null)}>Add Project Work</Button>
          </div>
        }
      />
      {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}
      {saved && <div className="px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">✓ Saved.</div>}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-navy-900 text-white">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase">Student</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase">Year</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase">Title</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase">Subject / Area</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase">Level</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase">Assessor</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr><td colSpan="7" className="px-4 py-8 text-center text-slate-400">No project work records yet.</td></tr>
              ) : (
                records.map((r) => {
                  const s = studentById(r.studentId);
                  return (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <p className="text-sm font-medium text-slate-800">{s.fullName || '—'}</p>
                        <p className="text-xs text-slate-400">{s.admissionNumber || '—'}</p>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{r.year || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-700">{r.title || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{r.subjectOrArea || '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${LEVEL_COLOR[r.achievementLevel] || 'bg-slate-100 text-slate-700'}`}>
                          {r.achievementLevel}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{r.assessorId || '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Button size="sm" variant="ghost" icon={Edit} onClick={() => handleOpen(r)} />
                        <Button size="sm" variant="ghost" icon={Trash2} className="text-red-500 hover:bg-red-50" onClick={() => handleDelete(r.id)} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Project Work' : 'Add Project Work'} size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} loading={saving} icon={Save}>{editing ? 'Update' : 'Save'}</Button>
          </>
        }>
        <form onSubmit={handleSave} className="space-y-6">
          {/* ── Section: Student & Subject ── */}
          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Student &amp; Subject</h3>
            <Select
              label="Class *"
              required
              value={classLevel}
              onChange={(e) => {
                setClassLevel(e.target.value);
                setStream('');
                setForm((p) => ({ ...p, studentId: '' }));
                setErrors((prev) => ({ ...prev, studentId: '' }));
              }}
              placeholder="Select class"
            >
              {CLASSES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
            {classLevel && (
              <FormRow>
                <Select
                  label="Stream"
                  value={stream}
                  onChange={setStream}
                  placeholder="Select stream"
                >
                  {STREAMS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
                <Select
                  label="Academic Year *"
                  required
                  value={form.year}
                  onChange={set('year')}
                  placeholder="Select year"
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </Select>
              </FormRow>
            )}
            {!classLevel && (
              <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
                <p className="text-xs text-slate-500">
                  Pick a class above to see and choose students.
                </p>
              </div>
            )}
            {classLevel && (
              <>
                <Select
                  ref={studentRef}
                  label="Student *"
                  required
                  value={form.studentId}
                  onChange={set('studentId')}
                  error={errors.studentId}
                  placeholder="Select student"
                >
                  {classStudents.length === 0 ? (
                    <option value="" disabled>
                      No students found in this class{stream ? ` / stream ${stream}` : ''}
                    </option>
                  ) : (
                    classStudents.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName} — {s.schoolpayCode || s.admissionNumber || '—'}
                      </option>
                    ))
                  )}
                </Select>
              </>
            )}
          </div>

          {/* ── Section: Project Details ── */}
          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Project Details</h3>
            <Input
              ref={titleRef}
              label="Project Title *"
              required
              value={form.title}
              onChange={set('title')}
              error={errors.title}
              hint={errors.title ? undefined : 'e.g. Community sanitation project'}
              placeholder="e.g. Community sanitation project"
            />
            <Input
              label="Subject / Learning Area"
              value={form.subjectOrArea}
              onChange={set('subjectOrArea')}
              hint="e.g. Integrated Science"
              placeholder="e.g. Integrated Science"
            />
          </div>

          {/* ── Section: Scoring ── */}
          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Scoring</h3>
            <p className="text-xs text-slate-400">
              Competence level{' '}
              <span className="font-medium">{ACHIEVEMENT_LEVELS.join(' · ')}</span>
              {ACHIEVEMENT_LEVELS.length === 5 && ' (A = exceptional … E = elementary)'}
            </p>
            <FormRow>
              <Select
                ref={levelRef}
                label="Achievement Level *"
                required
                value={form.achievementLevel}
                onChange={set('achievementLevel')}
                error={errors.achievementLevel}
              >
                {ACHIEVEMENT_LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </Select>
              <Input
                label="Assessor (staff/user id)"
                value={form.assessorId}
                onChange={set('assessorId')}
                hint="Staff or user ID who assessed the project"
                placeholder="Staff or user ID"
              />
            </FormRow>
            <Textarea
              label="Notes"
              value={form.notes}
              onChange={set('notes')}
              rows={2}
              placeholder="Any remarks…"
            />
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default ProjectWork;
