import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Trash2, BookMarked } from 'lucide-react';
import { getSubjects, createSubject, updateSubject, deleteSubject } from '../../db/subjectService.js';
import { CLASSES } from '../../utils/constants.js';
import Button from '../../components/common/Button.jsx';
import Modal, { ConfirmModal } from '../../components/common/Modal.jsx';
import { Input, FormRow } from '../../components/common/Input.jsx';
import { authErrorMessage } from '../../lib/authErrors.js';
import { EmptyState, PageHeader, Card, Badge, LoadingScreen } from '../../components/common/Badge.jsx';

const EMPTY = { name: '', code: '', applicableClasses: [], outOf: '100' };

const SubjectModal = ({ open, onClose, onSave, existing }) => {
  const isEdit = !!existing;
  const [form, setForm]     = useState(EMPTY);
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(existing ? { ...EMPTY, ...existing, outOf: String(existing.outOf || 100) } : EMPTY);
      setError('');
    }
  }, [open, existing]);

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const toggleClass = (cls) => {
    setForm((p) => ({
      ...p,
      applicableClasses: p.applicableClasses.includes(cls)
        ? p.applicableClasses.filter((c) => c !== cls)
        : [...p.applicableClasses, cls],
    }));
  };

  const toggleAll = () => {
    setForm((p) => ({
      ...p,
      applicableClasses: p.applicableClasses.length === CLASSES.length ? [] : [...CLASSES],
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Subject name is required.'); return; }
    if (form.applicableClasses.length === 0) { setError('Select at least one class.'); return; }
    setLoading(true);
    try {
      await onSave({ ...form, outOf: Number(form.outOf) || 100 });
      onClose();
    } catch (e) { setError(authErrorMessage(e)); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="sm"
      title={isEdit ? 'Edit Subject' : 'Add Subject'}
      subtitle="Configure name, code, and applicable classes"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSave} loading={loading}>{isEdit ? 'Save' : 'Add Subject'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormRow>
          <Input label="Subject Name" required placeholder="e.g. Mathematics"
            value={form.name} onChange={set('name')} />
          <Input label="Subject Code" placeholder="e.g. MATH"
            value={form.code} onChange={set('code')} />
        </FormRow>
        <Input label="Marks Out Of" type="number" value={form.outOf} onChange={set('outOf')}
          hint="Maximum marks for this subject (default 100)" />

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-slate-700">
              Applicable Classes <span className="text-red-500">*</span>
            </label>
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs text-navy-600 hover:text-navy-800 font-medium"
            >
              {form.applicableClasses.length === CLASSES.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {CLASSES.map((cls) => {
              const active = form.applicableClasses.includes(cls);
              return (
                <button
                  key={cls}
                  type="button"
                  onClick={() => toggleClass(cls)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                    active
                      ? 'bg-navy-900 text-white border-navy-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-navy-400'
                  }`}
                >
                  {cls}
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
        )}
      </div>
    </Modal>
  );
};

const Subjects = () => {
  const [subjects, setSubjects]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing]     = useState(null);
  const [deleting, setDeleting]   = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setSubjects(await getSubjects()); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (form) => {
    if (editing) await updateSubject(editing.id, form);
    else          await createSubject(form);
    await load();
  };

  const handleDelete = async () => {
    setActionLoading(true);
    try { await deleteSubject(deleting.id); await load(); }
    finally { setActionLoading(false); setDeleting(null); }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Subjects"
        subtitle="Configure subjects available per class level"
        actions={
          <Button icon={Plus} onClick={() => { setEditing(null); setModalOpen(true); }}>
            Add Subject
          </Button>
        }
      />

      <Card>
        {loading ? <LoadingScreen /> : subjects.length === 0 ? (
          <EmptyState
            icon={BookMarked}
            title="No subjects configured"
            message="Add subjects and assign them to class levels. Teachers will select from these when creating exams."
            action={
              <Button icon={Plus} onClick={() => { setEditing(null); setModalOpen(true); }}>
                Add First Subject
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            {subjects.map((subject) => (
              <div
                key={subject.id}
                className="flex items-center gap-4 p-4 rounded-xl border border-slate-100 hover:border-navy-200 hover:bg-navy-50/20 transition-all group"
              >
                <div className="w-10 h-10 rounded-xl bg-navy-100 flex items-center justify-center flex-shrink-0">
                  <BookMarked className="w-5 h-5 text-navy-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-800">{subject.name}</p>
                    {subject.code && (
                      <span className="text-xs font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                        {subject.code}
                      </span>
                    )}
                    <span className="text-xs text-slate-400">/ {subject.outOf} marks</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {subject.applicableClasses.sort().map((cls) => (
                      <span key={cls} className="text-xs bg-navy-50 text-navy-700 border border-navy-100 px-2 py-0.5 rounded-full font-medium">
                        {cls}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button size="xs" variant="ghost" icon={Edit2}
                    onClick={() => { setEditing(subject); setModalOpen(true); }} />
                  <Button size="xs" variant="ghost" icon={Trash2}
                    className="text-red-500 hover:bg-red-50"
                    onClick={() => setDeleting(subject)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <SubjectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        existing={editing}
      />
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        loading={actionLoading}
        title="Delete Subject"
        message={`Delete "${deleting?.name}"? This will not delete existing exam results.`}
      />
    </div>
  );
};

export default Subjects;
