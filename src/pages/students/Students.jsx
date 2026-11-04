import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Search, Edit2, Trash2, GraduationCap, Users, AlertTriangle, BookOpen, TrendingUp } from 'lucide-react';
import { getStudents, createStudent, updateStudent, deleteStudent } from '../../db/studentService.js';
import { getConfig } from '../../db/configService.js';
import { CLASSES, STREAMS, GENDERS, GUARDIAN_RELATIONSHIPS, STUDENT_STATUSES } from '../../utils/constants.js';
import { formatDate } from '../../utils/grading.js';
import Button from '../../components/common/Button.jsx';
import Modal, { ConfirmModal } from '../../components/common/Modal.jsx';
import { Input, Select, Textarea, FormRow } from '../../components/common/Input.jsx';
import {
  StatusBadge, EmptyState, PageHeader, Card, LoadingScreen, Badge, StatCard,
} from '../../components/common/Badge.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers – mirrors the buildYearOptions used in Fees.jsx
// ─────────────────────────────────────────────────────────────────────────────

function buildYearOptions(currentYear) {
  if (!currentYear) return [];
  if (currentYear.includes('/')) {
    const startYear = parseInt(currentYear.split('/')[0], 10);
    if (isNaN(startYear)) return [currentYear];
    return [0, 1, 2].map((offset) => {
      const y = startYear - offset;
      return `${y}/${y + 1}`;
    });
  }
  const y = parseInt(currentYear, 10);
  if (isNaN(y)) return [currentYear];
  return [0, 1, 2].map((offset) => String(y - offset));
}

// ─────────────────────────────────────────────────────────────────────────────
// Student Modal (unchanged logic, kept intact)
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY = {
  schoolpayCode: '', admissionNumber: '', fullName: '', dateOfBirth: '', gender: '',
  classLevel: 'S1', stream: 'A', guardianName: '', guardianPhone: '',
  guardianRelationship: '', enrollmentDate: '', notes: '', source: 'manual',
};

const StudentModal = ({ open, onClose, onSave, existing }) => {
  const isEdit = !!existing;
  // SchoolPay-owned fields (schoolpayCode, fullName, classLevel) are read-only
  // for students created by import, so they can't be drifted away from SchoolPay.
  const readOnly = isEdit && existing?.source === 'schoolpay';
  const [form, setForm]       = useState(EMPTY);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(existing ? { ...EMPTY, ...existing } : EMPTY);
      setError('');
    }
  }, [open, existing]);

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const validate = () => {
    if (!form.fullName.trim()) return 'Student name is required.';
    if (!form.classLevel)      return 'Class is required.';
    if (!form.stream)          return 'Stream is required.';
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    setLoading(true);
    try {
      await onSave(form);
      onClose();
    } catch (e) {
      setError(e.message || 'Failed to save student.');
    } finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg"
      title={isEdit ? 'Edit Student' : 'Add New Student'}
      subtitle={isEdit ? 'Update student information' : 'Register a new student'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSave} loading={loading}>{isEdit ? 'Save Changes' : 'Add Student'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Personal Info</p>
        <FormRow>
          <Input label="Full Name" required placeholder="Student full name"
            value={form.fullName} onChange={set('fullName')} disabled={readOnly} />
          <Input label="Admission No." placeholder="Auto-generated if blank"
            value={form.admissionNumber} onChange={set('admissionNumber')} />
          <Input label="SchoolPay Code" placeholder="SchoolPay reference number"
            value={form.schoolpayCode} onChange={set('schoolpayCode')} disabled={readOnly} />
        </FormRow>
        <FormRow>
          <Input label="Date of Birth" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} />
          <Select label="Gender" value={form.gender} onChange={set('gender')} placeholder="Select gender">
            {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
          </Select>
        </FormRow>

        <div className="border-t border-slate-100 pt-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Class Assignment</p>
          <FormRow cols={3}>
            <Select label="Class" required value={form.classLevel} onChange={set('classLevel')} disabled={readOnly}>
              {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select label="Stream" required value={form.stream} onChange={set('stream')}>
              {STREAMS.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Input label="Enrollment Date" type="date" value={form.enrollmentDate} onChange={set('enrollmentDate')} />
          </FormRow>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Guardian / Parent</p>
          <FormRow>
            <Input label="Guardian Name" placeholder="Full name"
              value={form.guardianName} onChange={set('guardianName')} />
            <Input label="Guardian Phone" placeholder="+256..." type="tel"
              value={form.guardianPhone} onChange={set('guardianPhone')} />
          </FormRow>
          <Select label="Relationship" value={form.guardianRelationship}
            onChange={set('guardianRelationship')} placeholder="Select relationship" className="mt-4">
            {GUARDIAN_RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </div>

        <Textarea label="Notes (optional)" placeholder="Any additional information…"
          value={form.notes} onChange={set('notes')} />

        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
        )}
      </div>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Students Component
// ─────────────────────────────────────────────────────────────────────────────

const Students = () => {
  const [config, setConfig]         = useState(null);
  const [configLoading, setCfgLoad] = useState(true);

  // ── Year / class selection (mirrors Fees.jsx) ──
  const [selectedYear, setSelectedYear] = useState('');
  const [yearOptions, setYearOptions]   = useState([]);

  const [students, setStudents]         = useState([]);
  const [loading, setLoading]           = useState(false);
  const [search, setSearch]             = useState('');
  const [filterClass, setFilterClass]   = useState('');
  const [filterStream, setFilterStream] = useState('');

  const [modalOpen, setModalOpen]       = useState(false);
  const [editing, setEditing]           = useState(null);
  const [deleting, setDeleting]         = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Load config once; seed year selector
  useEffect(() => {
    getConfig().then((cfg) => {
      setConfig(cfg);
      setSelectedYear(cfg?.academicYear || '');
      setYearOptions(buildYearOptions(cfg?.academicYear));
      setCfgLoad(false);
    });
  }, []);

  const isHistoricalView = config && selectedYear !== config.academicYear;

  // Load students filtered by selected year + optional class/stream/search
  const load = useCallback(async () => {
    if (!selectedYear) return;
    setLoading(true);
    try {
      const data = await getStudents({
        academicYear: selectedYear,
        classLevel:   filterClass  || undefined,
        stream:       filterStream || undefined,
        search:       search       || undefined,
      });
      setStudents(data);
    } finally { setLoading(false); }
  }, [selectedYear, filterClass, filterStream, search]);

  useEffect(() => { load(); }, [load]);

  // ── Enrollment stats per class ──
  const classBreakdown = useMemo(() => {
    const map = {};
    students.forEach((s) => {
      const key = s.classLevel || 'Unknown';
      if (!map[key]) map[key] = { total: 0, male: 0, female: 0 };
      map[key].total++;
      if (s.gender === 'Male')   map[key].male++;
      if (s.gender === 'Female') map[key].female++;
    });
    // Return sorted by class order defined in CLASSES constant
    return CLASSES
      .filter((c) => map[c])
      .map((c) => ({ classLevel: c, ...map[c] }));
  }, [students]);

  const totals = useMemo(() => {
    const male   = students.filter((s) => s.gender === 'Male').length;
    const female = students.filter((s) => s.gender === 'Female').length;
    const active = students.filter((s) => !s.status || s.status === 'active').length;
    return { total: students.length, male, female, active };
  }, [students]);

  const handleSave = async (form) => {
    if (editing) await updateStudent(editing.id, form);
    else         await createStudent(form);
    await load();
  };

  const handleDelete = async () => {
    setActionLoading(true);
    try { await deleteStudent(deleting.id); await load(); }
    finally { setActionLoading(false); setDeleting(null); }
  };

  const filterLabel = [filterClass, filterStream && `Stream ${filterStream}`].filter(Boolean).join(' · ');

  if (configLoading) return <LoadingScreen />;

  return (
    <div className="space-y-5 animate-fade-in">

      <PageHeader
        title="Students"
        subtitle={`${selectedYear}${isHistoricalView ? ' · Historical' : ''}`}
        actions={
          <Button icon={Plus} onClick={() => { setEditing(null); setModalOpen(true); }}>
            Add Student
          </Button>
        }
      />

      {/* ── Academic Year selector (matches Fees.jsx pattern) ── */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={selectedYear}
          onChange={(e) => setSelectedYear(e.target.value)}
          className="w-44"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}{y === config?.academicYear ? ' (current)' : ''}
            </option>
          ))}
        </Select>

        {isHistoricalView && (
          <span className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-full">
            <AlertTriangle size={11} />
            Historical view
            <button
              onClick={() => setSelectedYear(config.academicYear)}
              className="ml-1 underline underline-offset-2 hover:text-blue-800"
            >
              Back to current
            </button>
          </span>
        )}
      </div>

      {/* ── Summary stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          title="Total Enrolled"
          value={totals.total}
          icon={Users}
          color="navy"
          subtitle={filterLabel || 'All classes'}
        />
        <StatCard
          title="Active"
          value={totals.active}
          icon={GraduationCap}
          color="emerald"
          subtitle={`${totals.total - totals.active} inactive`}
        />
        <StatCard
          title="Male"
          value={totals.male}
          icon={TrendingUp}
          color="blue"
          subtitle={totals.total > 0 ? `${Math.round((totals.male / totals.total) * 100)}% of total` : '—'}
        />
        <StatCard
          title="Female"
          value={totals.female}
          icon={TrendingUp}
          color="amber"
          subtitle={totals.total > 0 ? `${Math.round((totals.female / totals.total) * 100)}% of total` : '—'}
        />
      </div>

      {/* ── Per-class enrollment breakdown ── */}
      {classBreakdown.length > 0 && !filterClass && (
        <Card>
          <h3 className="font-display font-semibold text-slate-800 mb-4">
            Enrollment by Class · {selectedYear}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {classBreakdown.map(({ classLevel, total, male, female }) => (
              <button
                key={classLevel}
                onClick={() => setFilterClass(classLevel)}
                className="text-left p-3 rounded-xl border border-slate-200 hover:border-navy-300 hover:bg-slate-50/80 transition-all group"
              >
                <Badge variant="navy" className="mb-2">{classLevel}</Badge>
                <p className="text-xl font-bold text-slate-800 mt-1">{total}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {male}M · {female}F
                </p>
                <div className="mt-2 h-1 rounded-full bg-slate-100 overflow-hidden">
                  {total > 0 && (
                    <div
                      className="h-full bg-navy-500 rounded-full transition-all"
                      style={{ width: `${Math.round((female / total) * 100)}%` }}
                    />
                  )}
                </div>
                <p className="text-xs text-slate-300 mt-1 group-hover:text-slate-400 transition-colors">
                  Click to filter
                </p>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* ── Main student table ── */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h3 className="font-display font-semibold text-slate-800">Student Register</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {students.length} student{students.length !== 1 ? 's' : ''}
              {filterLabel ? ` · ${filterLabel}` : ' · all classes'}{' · '}
              <span className="text-emerald-600">{totals.active} active</span>
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <Input placeholder="Search name or admission no…" icon={Search}
            value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 min-w-48 max-w-xs" />
          <Select value={filterClass} onChange={(e) => setFilterClass(e.target.value)}
            placeholder="All Classes" className="w-36">
            {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select value={filterStream} onChange={(e) => setFilterStream(e.target.value)}
            placeholder="All Streams" className="w-36">
            {STREAMS.map((s) => <option key={s} value={s}>Stream {s}</option>)}
          </Select>
          {(filterClass || filterStream || search) && (
            <Button variant="ghost" size="sm"
              onClick={() => { setFilterClass(''); setFilterStream(''); setSearch(''); }}>
              Clear
            </Button>
          )}
        </div>

        {loading ? <LoadingScreen /> : students.length === 0 ? (
          <EmptyState icon={GraduationCap} title="No students found"
            message={
              filterClass || filterStream || search
                ? 'No students match your current filters.'
                : `No students enrolled for ${selectedYear} yet.`
            }
            action={
              !isHistoricalView && (
                <Button icon={Plus} onClick={() => { setEditing(null); setModalOpen(true); }}>
                  Add Student
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-slate-100">
                  {['Adm. No.', 'SchoolPay Code', 'Full Name', 'Class', 'Gender', 'Enrolled', 'Guardian', 'Status', 'Actions'].map((h) => (
                    <th key={h} className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {students.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/70 transition-colors group">
                    <td className="py-3 px-3 text-sm font-mono text-slate-500">{s.admissionNumber}</td>
                    <td className="py-3 px-3 text-sm font-mono text-slate-500">{s.schoolpayCode || '—'}</td>
                    <td className="py-3 px-3">
                      <p className="text-sm font-medium text-slate-800">{s.fullName}</p>
                    </td>
                    <td className="py-3 px-3">
                      <Badge variant="navy">{s.classStream}</Badge>
                    </td>
                    <td className="py-3 px-3 text-sm text-slate-600">{s.gender || '—'}</td>
                    <td className="py-3 px-3 text-sm text-slate-500">
                      {s.enrollmentDate ? formatDate(s.enrollmentDate) : '—'}
                    </td>
                    <td className="py-3 px-3">
                      <p className="text-sm text-slate-700">{s.guardianName || '—'}</p>
                      {s.guardianPhone && <p className="text-xs text-slate-400">{s.guardianPhone}</p>}
                    </td>
                    <td className="py-3 px-3"><StatusBadge status={s.status} /></td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button size="xs" variant="ghost" icon={Edit2}
                          onClick={() => { setEditing(s); setModalOpen(true); }} />
                        <Button size="xs" variant="ghost" icon={Trash2}
                          className="text-red-500 hover:bg-red-50"
                          onClick={() => setDeleting(s)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td className="py-3 px-3 text-xs font-semibold text-slate-500 uppercase">Totals</td>
                  <td className="py-3 px-3 text-xs text-slate-400">{students.length} students</td>
                  <td className="py-3 px-3 text-xs text-slate-400">
                    {filterClass ? filterClass : `${classBreakdown.length} class${classBreakdown.length !== 1 ? 'es' : ''}`}
                  </td>
                  <td className="py-3 px-3 text-xs text-slate-500">
                    {totals.male}M · {totals.female}F
                  </td>
                  <td colSpan={3} />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <StudentModal
        open={modalOpen} onClose={() => setModalOpen(false)}
        onSave={handleSave} existing={editing}
      />
      <ConfirmModal
        open={!!deleting} onClose={() => setDeleting(null)}
        onConfirm={handleDelete} loading={actionLoading}
        title="Delete Student"
        message={`Permanently delete ${deleting?.fullName}? This cannot be undone.`}
      />
    </div>
  );
};

export default Students;
