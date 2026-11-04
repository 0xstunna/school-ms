import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, Save, RefreshCw } from 'lucide-react';
import { getProjectWork, saveProjectWork, updateProjectWork, deleteProjectWork, ACHIEVEMENT_LEVELS } from '../../db/projectWorkService.js';
import { getStudents } from '../../db/studentService.js';
import { getConfig } from '../../db/configService.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { CLASSES } from '../../utils/constants.js';
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
  const [saved, setSaved] = useState(false);

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
  const yearOptions = [...new Set([...records.map((r) => r.year), ...(config ? [config.academicYear] : []), ...years])];

  const resetForm = () => setForm({ studentId: '', year: config?.academicYear || '', title: '', subjectOrArea: '', achievementLevel: 'A', assessorId: user?.id || '', notes: '' });

  const handleOpen = (record = null) => {
    setError('');
    setSaved(false);
    if (record) {
      setEditing(record.id);
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
    if (!form.studentId) { setError('Select a student.'); return; }
    if (!form.title.trim()) { setError('Project title is required.'); return; }
    if (!ACHIEVEMENT_LEVELS.includes(form.achievementLevel)) { setError('Select an achievement level.'); return; }
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
        <form onSubmit={handleSave} className="space-y-4">
          <FormRow>
            <Select label="Student *" required value={form.studentId} onChange={(e) => setForm((p) => ({ ...p, studentId: e.target.value }))} placeholder="Select student">
              {students.map((s) => <option key={s.id} value={s.id}>{s.fullName} ({s.admissionNumber})</option>)}
            </Select>
            <Select label="Academic Year *" required value={form.year} onChange={(e) => setForm((p) => ({ ...p, year: e.target.value }))}>
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
          </FormRow>
          <Input label="Project Title *" required value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. Community sanitation project" />
          <Input label="Subject / Learning Area" value={form.subjectOrArea} onChange={(e) => setForm((p) => ({ ...p, subjectOrArea: e.target.value }))} placeholder="e.g. Integrated Science" />
          <FormRow>
            <Select label="Achievement Level *" required value={form.achievementLevel} onChange={(e) => setForm((p) => ({ ...p, achievementLevel: e.target.value }))}>
              {ACHIEVEMENT_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
            <Input label="Assessor (staff/user id)" value={form.assessorId} onChange={(e) => setForm((p) => ({ ...p, assessorId: e.target.value }))} />
          </FormRow>
          <Textarea label="Notes" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} rows={2} />
        </form>
      </Modal>
    </div>
  );
};

export default ProjectWork;
