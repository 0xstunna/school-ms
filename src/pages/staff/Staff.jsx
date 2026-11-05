// ─── Staff Page ───────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Search, Edit2, Trash2, Users, Banknote, Receipt,
  Settings as SettingsIcon, Save, AlertTriangle, Printer,
  BarChart2, TrendingUp, PieChart,
} from 'lucide-react';
import { getStaff, createStaff, updateStaff, deleteStaff } from '../../db/staffService.js';
import { getPayrollEntries, recordPayroll, getExpenses, recordExpense, deleteExpense } from '../../db/payrollService.js';
import { getConfig, updateConfig } from '../../db/configService.js';
import { getGradingSettings, createOrUpdateGradingSettings, DEFAULT_GRADE_BANDS } from '../../db/gradingSettingsService.js';
import { printPayrollReceipt } from '../../utils/printUtils.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { STAFF_POSITIONS, PAYMENT_METHODS, EXPENSE_CATEGORIES, TERMS } from '../../utils/constants.js';
import { formatCurrency, formatDate, getCurrentDateISO, generateAcademicYears } from '../../utils/grading.js';
import Button from '../../components/common/Button.jsx';
import Modal, { ConfirmModal } from '../../components/common/Modal.jsx';
import { Input, Select, Textarea, FormRow } from '../../components/common/Input.jsx';
import {
  StatusBadge, EmptyState, PageHeader, Card, Badge, LoadingScreen, StatCard,
} from '../../components/common/Badge.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helper — mirrors the one in Fees.jsx
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
// Shared TermYearBar — reused by both Payroll and Expenses
// ─────────────────────────────────────────────────────────────────────────────

const TermYearBar = ({ selectedTerm, setSelectedTerm, selectedYear, setSelectedYear, yearOptions, config }) => {
  const isHistorical = config
    && (selectedTerm !== config.currentTerm || selectedYear !== config.academicYear);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-xl">
        {TERMS.map((t) => (
          <button
            key={t}
            onClick={() => setSelectedTerm(t)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
              selectedTerm === t
                ? 'bg-white text-navy-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <Select
        value={selectedYear}
        onChange={(e) => setSelectedYear(e.target.value)}
        className="w-40"
      >
        {yearOptions.map((y) => (
          <option key={y} value={y}>
            {y}{y === config?.academicYear ? ' (current)' : ''}
          </option>
        ))}
      </Select>

      {isHistorical && (
        <span className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-full">
          <AlertTriangle size={11} />
          Historical view
          <button
            onClick={() => {
              setSelectedTerm(config.currentTerm);
              setSelectedYear(config.academicYear);
            }}
            className="ml-1 underline underline-offset-2 hover:text-blue-800"
          >
            Back to current
          </button>
        </span>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ExpensesReport — category summary + monthly trend + print
// ─────────────────────────────────────────────────────────────────────────────

// Colour palette cycled per category (tailwind-safe bg + text pairs)
const CATEGORY_COLORS = [
  { bg: 'bg-amber-100',   text: 'text-amber-700',   bar: 'bg-amber-400'   },
  { bg: 'bg-blue-100',    text: 'text-blue-700',     bar: 'bg-blue-400'    },
  { bg: 'bg-emerald-100', text: 'text-emerald-700',  bar: 'bg-emerald-400' },
  { bg: 'bg-purple-100',  text: 'text-purple-700',   bar: 'bg-purple-400'  },
  { bg: 'bg-rose-100',    text: 'text-rose-700',     bar: 'bg-rose-400'    },
  { bg: 'bg-cyan-100',    text: 'text-cyan-700',     bar: 'bg-cyan-400'    },
  { bg: 'bg-orange-100',  text: 'text-orange-700',   bar: 'bg-orange-400'  },
  { bg: 'bg-teal-100',    text: 'text-teal-700',     bar: 'bg-teal-400'    },
];

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function buildCategoryData(expenses) {
  const totals = {};
  expenses.forEach((e) => {
    totals[e.category] = (totals[e.category] || 0) + e.amount;
  });
  const grand = Object.values(totals).reduce((s, v) => s + v, 0) || 1;
  return Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([category, total], i) => ({
      category,
      total,
      pct: Math.round((total / grand) * 100),
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    }));
}

function buildMonthlyData(expenses) {
  const totals = {};
  expenses.forEach((e) => {
    if (!e.date) return;
    const d = new Date(e.date);
    if (isNaN(d)) return;
    const key = d.getMonth(); // 0-11
    totals[key] = (totals[key] || 0) + e.amount;
  });
  // Only return months that have data
  return Object.entries(totals)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([monthIdx, total]) => ({ label: MONTH_NAMES[Number(monthIdx)], total }));
}

const ExpensesReport = ({ expenses, config, term, year }) => {
  const categories = buildCategoryData(expenses);
  const monthly    = buildMonthlyData(expenses);
  const grand      = expenses.reduce((s, e) => s + e.amount, 0);
  const maxMonthly = Math.max(...monthly.map((m) => m.total), 1);

  const handlePrint = () => {
    const rows = categories
      .map((c) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">${c.category}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right">${c.pct}%</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600">UGX ${c.total.toLocaleString()}</td>
        </tr>`)
      .join('');

    const monthRows = monthly
      .map((m) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">${m.label}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600">UGX ${m.total.toLocaleString()}</td>
        </tr>`)
      .join('');

    const html = `
      <!DOCTYPE html><html><head><title>Expense Report</title>
      <style>
        body { font-family: Arial, sans-serif; color: #1e293b; padding: 32px; max-width: 720px; margin: 0 auto; }
        h1 { font-size: 22px; margin-bottom: 4px; }
        .meta { color: #64748b; font-size: 13px; margin-bottom: 28px; }
        h2 { font-size: 15px; font-weight: 700; border-bottom: 2px solid #0f172a; padding-bottom: 6px; margin: 24px 0 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; padding: 8px 12px; background: #f8fafc; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; }
        .total-row td { font-weight: 700; background: #f8fafc; padding: 10px 12px; }
        @media print { body { padding: 0; } }
      </style></head><body>
      <h1>${config?.schoolName || 'School'} — Expense Report</h1>
      <div class="meta">${term} &middot; ${year} &middot; Generated ${new Date().toLocaleDateString()}</div>

      <h2>Summary by Category</h2>
      <table>
        <thead><tr><th>Category</th><th style="text-align:right">Share</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>${rows}
          <tr class="total-row">
            <td>Grand Total</td><td style="text-align:right">100%</td>
            <td style="text-align:right">UGX ${grand.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>

      <h2>Monthly Breakdown</h2>
      <table>
        <thead><tr><th>Month</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>${monthRows}</tbody>
      </table>
      </body></html>`;

    // Use a hidden iframe instead of window.open — avoids popup blockers
    // and the Microsoft Store redirect that window.open triggers on some Windows setups.
    const existing = document.getElementById('__expense_print_frame');
    if (existing) existing.remove();

    const iframe = document.createElement('iframe');
    iframe.id = '__expense_print_frame';
    iframe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;border:none;visibility:hidden;';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    // Wait for content to render before printing
    iframe.onload = () => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      // Clean up after the print dialog closes
      setTimeout(() => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 1000);
    };
  };

  if (expenses.length === 0) {
    return (
      <div className="py-16 text-center text-slate-400">
        <PieChart size={36} className="mx-auto mb-3 opacity-40" />
        <p className="text-sm">No expense data to report for {term}, {year}.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header row ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-0.5">
            Expense Report
          </p>
          <p className="text-sm text-slate-600">{term} · {year} · {expenses.length} records · {formatCurrency(grand)} total</p>
        </div>
        <Button size="sm" variant="secondary" icon={Printer} onClick={handlePrint}>
          Print Report
        </Button>
      </div>

      {/* ── Category summary ── */}
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
          <PieChart size={14} className="text-slate-400" />
          Summary by Category
        </h3>
        <div className="space-y-2.5">
          {categories.map((c) => (
            <div key={c.category}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.color.bg} ${c.color.text}`}>
                    {c.category}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-slate-400 text-xs">{c.pct}%</span>
                  <span className="font-semibold text-slate-800 tabular-nums">{formatCurrency(c.total)}</span>
                </div>
              </div>
              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${c.color.bar} transition-all duration-500`}
                  style={{ width: `${c.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        {/* Total row */}
        <div className="flex justify-between items-center mt-4 pt-3 border-t border-slate-100">
          <span className="text-sm font-semibold text-slate-700">Grand Total</span>
          <span className="text-base font-bold text-slate-900">{formatCurrency(grand)}</span>
        </div>
      </div>

      {/* ── Monthly trend ── */}
      {monthly.length > 0 && (
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
            <BarChart2 size={14} className="text-slate-400" />
            Monthly Trend
          </h3>
          <div className="flex items-end gap-2 h-28">
            {monthly.map((m) => {
              const heightPct = Math.round((m.total / maxMonthly) * 100);
              const isPeak    = m.total === maxMonthly;
              return (
                <div key={m.label} className="flex-1 flex flex-col items-center gap-1 min-w-0 group">
                  <span className="text-xs text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity tabular-nums leading-none">
                    {formatCurrency(m.total)}
                  </span>
                  <div className="w-full flex items-end" style={{ height: '72px' }}>
                    <div
                      className={`w-full rounded-t-md transition-all duration-500 ${
                        isPeak ? 'bg-amber-400' : 'bg-amber-200 group-hover:bg-amber-300'
                      }`}
                      style={{ height: `${Math.max(heightPct, 4)}%` }}
                      title={`${m.label}: ${formatCurrency(m.total)}`}
                    />
                  </div>
                  <span className={`text-xs font-medium ${isPeak ? 'text-amber-600' : 'text-slate-400'}`}>
                    {m.label}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Peak month: <span className="font-medium text-slate-600">
              {monthly.find((m) => m.total === maxMonthly)?.label}
            </span> · Hover bars for amounts
          </p>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// STAFF
// ═══════════════════════════════════════════════════════════════════════════════

const EMPTY_STAFF = {
  staffNumber: '', fullName: '', email: '', phone: '',
  position: 'Teacher', department: '', joinDate: '',
};

const StaffModal = ({ open, onClose, onSave, existing }) => {
  const isEdit = !!existing;
  const [form, setForm]     = useState(EMPTY_STAFF);
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(existing ? { ...EMPTY_STAFF, ...existing } : EMPTY_STAFF);
      setError('');
    }
  }, [open, existing]);

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const handleSave = async () => {
    if (!form.fullName.trim()) { setError('Full name is required.'); return; }
    setLoading(true);
    try { await onSave(form); onClose(); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg"
      title={isEdit ? 'Edit Staff' : 'Add Staff Member'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSave} loading={loading}>{isEdit ? 'Save' : 'Add Staff'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormRow>
          <Input label="Full Name" required value={form.fullName} onChange={set('fullName')} placeholder="Full name" />
          <Input label="Staff No." value={form.staffNumber} onChange={set('staffNumber')} placeholder="Auto-generated" />
        </FormRow>
        <FormRow>
          <Input label="Email" type="email" value={form.email} onChange={set('email')} placeholder="staff@school.com" />
          <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} placeholder="+256..." />
        </FormRow>
        <FormRow>
          <Select label="Position" value={form.position} onChange={set('position')}>
            {STAFF_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
          <Input label="Department" value={form.department} onChange={set('department')} placeholder="e.g. Sciences" />
        </FormRow>
        <Input label="Join Date" type="date" value={form.joinDate} onChange={set('joinDate')} />
        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
        )}
      </div>
    </Modal>
  );
};

export const Staff = () => {
  const [staff, setStaff]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [modalOpen, setModalOpen]   = useState(false);
  const [editing, setEditing]       = useState(null);
  const [deleting, setDeleting]     = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setStaff(await getStaff({ search: search || undefined })); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (form) => {
    if (editing) await updateStaff(editing.id, form);
    else await createStaff(form);
    await load();
  };

  const handleDelete = async () => {
    setActionLoading(true);
    try { await deleteStaff(deleting.id); await load(); }
    finally { setActionLoading(false); setDeleting(null); }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Staff"
        subtitle={`${staff.length} staff members`}
        actions={
          <Button icon={Plus} onClick={() => { setEditing(null); setModalOpen(true); }}>
            Add Staff
          </Button>
        }
      />
      <Card>
        <Input placeholder="Search staff…" icon={Search} value={search}
          onChange={(e) => setSearch(e.target.value)} className="max-w-xs mb-5" />
        {loading ? <LoadingScreen /> : staff.length === 0 ? (
          <EmptyState icon={Users} title="No staff found"
            action={<Button icon={Plus} onClick={() => setModalOpen(true)}>Add Staff</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  {['Staff No.', 'Name', 'Position', 'Department', 'Salary', 'Join Date', ''].map((h) => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50/60 group">
                    <td className="py-3 px-3 text-xs font-mono text-slate-500">{s.staffNumber}</td>
                    <td className="py-3 px-3">
                      <p className="text-sm font-medium text-slate-800">{s.fullName}</p>
                      <p className="text-xs text-slate-400">{s.email}</p>
                    </td>
                    <td className="py-3 px-3"><Badge variant="navy">{s.position}</Badge></td>
                    <td className="py-3 px-3 text-sm text-slate-600">{s.department || '—'}</td>
                    <td className="py-3 px-3 text-sm font-medium text-slate-700">{s.salary ? formatCurrency(s.salary) : '—'}</td>
                    <td className="py-3 px-3 text-sm text-slate-500">{formatDate(s.joinDate)}</td>
                    <td className="py-3 px-3">
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                        <Button size="xs" variant="ghost" icon={Edit2}
                          onClick={() => { setEditing(s); setModalOpen(true); }} />
                        <Button size="xs" variant="ghost" icon={Trash2}
                          className="text-red-500 hover:bg-red-50" onClick={() => setDeleting(s)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <StaffModal open={modalOpen} onClose={() => setModalOpen(false)} onSave={handleSave} existing={editing} />
      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} onConfirm={handleDelete}
        loading={actionLoading} title="Delete Staff"
        message={`Delete ${deleting?.fullName}? This cannot be undone.`} />
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// PAYROLL
// ═══════════════════════════════════════════════════════════════════════════════

export const Payroll = () => {
  const { user } = useAuth();

  const [entries, setEntries]   = useState([]);
  const [staff, setStaff]       = useState([]);
  const [config, setConfig]     = useState(null);
  const [loading, setLoading]   = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving]     = useState(false);

  // ── Term / year selection ──
  const [selectedTerm, setSelectedTerm] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [yearOptions, setYearOptions]   = useState([]);

  const [form, setForm] = useState({
    staffId: '', basicSalary: '', allowances: '0', deductions: '0',
    month: '', paymentMethod: 'Cash', paymentDate: getCurrentDateISO(), notes: '',
  });

  useEffect(() => {
    getConfig().then((cfg) => {
      setConfig(cfg);
      setSelectedTerm(cfg?.currentTerm || TERMS[0]);
      setSelectedYear(cfg?.academicYear || '');
      setYearOptions(buildYearOptions(cfg?.academicYear));
    });
  }, []);

  const loadEntries = useCallback(async () => {
    if (!selectedTerm || !selectedYear) return;
    setLoading(true);
    try {
      const [e, s] = await Promise.all([
        getPayrollEntries({ academicYear: selectedYear, term: selectedTerm }),
        getStaff(),
      ]);
      setEntries(e);
      setStaff(s);
    } finally { setLoading(false); }
  }, [selectedTerm, selectedYear]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const resetForm = () => setForm({
    staffId: '', basicSalary: '', allowances: '0', deductions: '0',
    month: '', paymentMethod: 'Cash', paymentDate: getCurrentDateISO(), notes: '',
  });

  // ── Print receipt helper ──
  const handlePrintReceipt = (entry) => {
    printPayrollReceipt(entry, {
      name:    config?.schoolName    || '',
      address: config?.schoolAddress || '',
      logoUrl: config?.logoUrl       || '',
    });
  };

  const handleSave = async () => {
    if (!form.staffId)     { setFormError('Select a staff member.'); return; }
    if (!form.basicSalary) { setFormError('Enter basic salary.');    return; }
    setSaving(true);
    try {
      const s      = staff.find((x) => x.id === form.staffId);
      const result = await recordPayroll({
        ...form,
        staffName:    s?.fullName,
        academicYear: selectedYear,
        term:         selectedTerm,
      }, user.id);
      await loadEntries();
      setModalOpen(false);
      // Auto-print receipt immediately after saving
      handlePrintReceipt(result);
    } catch (e) { setFormError(e.message); }
    finally { setSaving(false); }
  };

  const totalPaid = entries.reduce((s, e) => s + e.netSalary, 0);

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Payroll"
        subtitle={`${selectedTerm} · ${selectedYear}`}
        actions={
          <Button icon={Plus} onClick={() => { resetForm(); setFormError(''); setModalOpen(true); }}>
            Record Salary
          </Button>
        }
      />

      <TermYearBar
        selectedTerm={selectedTerm} setSelectedTerm={setSelectedTerm}
        selectedYear={selectedYear} setSelectedYear={setSelectedYear}
        yearOptions={yearOptions} config={config}
      />

      <div className="grid grid-cols-2 gap-4">
        <StatCard title="Total Paid This Period" value={formatCurrency(totalPaid)} icon={Banknote} color="emerald"
          subtitle={`${selectedTerm} · ${selectedYear}`} />
        <StatCard title="Payments Recorded" value={entries.length} icon={Banknote} color="navy"
          subtitle={`${selectedTerm} · ${selectedYear}`} />
      </div>

      <Card>
        {loading ? <LoadingScreen /> : entries.length === 0 ? (
          <EmptyState icon={Banknote} title="No payroll records"
            message={`No salary payments recorded for ${selectedTerm}, ${selectedYear}.`}
            action={<Button icon={Plus} onClick={() => setModalOpen(true)}>Record Salary</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  {['Staff', 'Month', 'Basic Salary', 'Allowances', 'Deductions', 'Net Salary', 'Date', ''].map((h) => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50/60 group">
                    <td className="py-3 px-3 text-sm font-medium text-slate-800">{e.staffName}</td>
                    <td className="py-3 px-3 text-sm text-slate-600">{e.month}</td>
                    <td className="py-3 px-3 text-sm text-slate-700">{formatCurrency(e.basicSalary)}</td>
                    <td className="py-3 px-3 text-sm text-emerald-700">{formatCurrency(e.allowances)}</td>
                    <td className="py-3 px-3 text-sm text-red-600">{formatCurrency(e.deductions)}</td>
                    <td className="py-3 px-3 text-sm font-bold text-slate-900">{formatCurrency(e.netSalary)}</td>
                    <td className="py-3 px-3 text-sm text-slate-400">{formatDate(e.paymentDate)}</td>
                    {/* ── Receipt button — visible on row hover ── */}
                    <td className="py-3 px-3">
                      <Button
                        size="xs"
                        variant="secondary"
                        icon={Printer}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handlePrintReceipt(e)}
                      >
                        Receipt
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Record Salary Payment" size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={saving} icon={Printer}>Save & Print Receipt</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="px-2.5 py-1 rounded-full bg-slate-100 font-medium">{selectedTerm}</span>
            <span className="px-2.5 py-1 rounded-full bg-slate-100 font-medium">{selectedYear}</span>
          </div>

          <Select label="Staff Member" required value={form.staffId} onChange={set('staffId')} placeholder="Select staff">
            {staff.map((s) => <option key={s.id} value={s.id}>{s.fullName} — {s.position}</option>)}
          </Select>
          <FormRow>
            <Input label="Month" placeholder="e.g. January 2025" value={form.month} onChange={set('month')} />
            <Select label="Payment Method" value={form.paymentMethod} onChange={set('paymentMethod')}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </FormRow>
          <FormRow cols={3}>
            <Input label="Basic Salary" type="number" required value={form.basicSalary} onChange={set('basicSalary')} />
            <Input label="Allowances" type="number" value={form.allowances} onChange={set('allowances')} />
            <Input label="Deductions" type="number" value={form.deductions} onChange={set('deductions')} />
          </FormRow>
          <Input label="Payment Date" type="date" value={form.paymentDate} onChange={set('paymentDate')} />
          <Input label="Notes (optional)" value={form.notes} onChange={set('notes')} placeholder="Any remarks…" />
          {formError && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{formError}</div>
          )}
        </div>
      </Modal>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// EXPENSES
// ═══════════════════════════════════════════════════════════════════════════════

export const Expenses = () => {
  const { user } = useAuth();

  const [expenses, setExpenses]   = useState([]);
  const [config, setConfig]       = useState(null);
  const [loading, setLoading]     = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleting, setDeleting]   = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving]       = useState(false);

  // ── Transactions / Reports toggle ──
  const [view, setView] = useState('transactions');

  const [selectedTerm, setSelectedTerm] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [yearOptions, setYearOptions]   = useState([]);

  const [form, setForm] = useState({
    category: 'Utilities', description: '', amount: '',
    date: getCurrentDateISO(), notes: '',
  });

  useEffect(() => {
    getConfig().then((cfg) => {
      setConfig(cfg);
      setSelectedTerm(cfg?.currentTerm || TERMS[0]);
      setSelectedYear(cfg?.academicYear || '');
      setYearOptions(buildYearOptions(cfg?.academicYear));
    });
  }, []);

  const loadExpenses = useCallback(async () => {
    if (!selectedTerm || !selectedYear) return;
    setLoading(true);
    try {
      setExpenses(await getExpenses({ academicYear: selectedYear, term: selectedTerm }));
    } finally { setLoading(false); }
  }, [selectedTerm, selectedYear]);

  useEffect(() => { loadExpenses(); }, [loadExpenses]);

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const resetForm = () => setForm({
    category: 'Utilities', description: '', amount: '',
    date: getCurrentDateISO(), notes: '',
  });

  const handleSave = async () => {
    if (!form.description.trim())                 { setFormError('Description is required.'); return; }
    if (!form.amount || Number(form.amount) <= 0) { setFormError('Enter a valid amount.'); return; }
    setSaving(true);
    try {
      await recordExpense({ ...form, academicYear: selectedYear, term: selectedTerm }, user.id);
      await loadExpenses();
      setModalOpen(false);
    } catch (e) { setFormError(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setActionLoading(true);
    try { await deleteExpense(deleting.id); await loadExpenses(); }
    finally { setActionLoading(false); setDeleting(null); }
  };

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="Expenses"
        subtitle={`${selectedTerm} · ${selectedYear}`}
        actions={
          <Button icon={Plus} onClick={() => { resetForm(); setFormError(''); setModalOpen(true); }}>
            Add Expense
          </Button>
        }
      />

      <TermYearBar
        selectedTerm={selectedTerm} setSelectedTerm={setSelectedTerm}
        selectedYear={selectedYear} setSelectedYear={setSelectedYear}
        yearOptions={yearOptions} config={config}
      />

      <div className="grid grid-cols-2 gap-4">
        <StatCard title="Total Expenses" value={formatCurrency(total)} icon={Receipt} color="amber"
          subtitle={`${selectedTerm} · ${selectedYear}`} />
        <StatCard title="Records" value={expenses.length} icon={Receipt} color="navy"
          subtitle={`${selectedTerm} · ${selectedYear}`} />
      </div>

      <Card>
        {/* ── View toggle: Transactions / Reports ── */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl mb-5 self-start w-fit">
          {[
            { key: 'transactions', label: 'Transactions', icon: Receipt },
            { key: 'reports',      label: 'Reports',      icon: BarChart2 },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                view === key
                  ? 'bg-white text-navy-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        {/* ── Transactions view ── */}
        {view === 'transactions' && (
          loading ? <LoadingScreen /> : expenses.length === 0 ? (
            <EmptyState icon={Receipt} title="No expenses recorded"
              message={`No expenses recorded for ${selectedTerm}, ${selectedYear}.`}
              action={<Button icon={Plus} onClick={() => setModalOpen(true)}>Add Expense</Button>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    {['Category', 'Description', 'Amount', 'Date', ''].map((h) => (
                      <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50/60 group">
                      <td className="py-3 px-3"><Badge variant="warning">{e.category}</Badge></td>
                      <td className="py-3 px-3 text-sm text-slate-800">{e.description}</td>
                      <td className="py-3 px-3 text-sm font-semibold text-amber-700">{formatCurrency(e.amount)}</td>
                      <td className="py-3 px-3 text-sm text-slate-500">{formatDate(e.date)}</td>
                      <td className="py-3 px-3">
                        <Button size="xs" variant="ghost" icon={Trash2}
                          className="opacity-0 group-hover:opacity-100 text-red-500 hover:bg-red-50"
                          onClick={() => setDeleting(e)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* ── Reports view ── */}
        {view === 'reports' && (
          loading ? <LoadingScreen /> : (
            <ExpensesReport
              expenses={expenses}
              config={config}
              term={selectedTerm}
              year={selectedYear}
            />
          )
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Record Expense" size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={saving}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="px-2.5 py-1 rounded-full bg-slate-100 font-medium">{selectedTerm}</span>
            <span className="px-2.5 py-1 rounded-full bg-slate-100 font-medium">{selectedYear}</span>
          </div>

          <Select label="Category" value={form.category} onChange={set('category')}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Input label="Description" required placeholder="What was this expense for?"
            value={form.description} onChange={set('description')} />
          <FormRow>
            <Input label="Amount (UGX)" type="number" required value={form.amount} onChange={set('amount')} />
            <Input label="Date" type="date" value={form.date} onChange={set('date')} />
          </FormRow>
          <Textarea label="Notes" rows={2} value={form.notes} onChange={set('notes')} />
          {formError && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{formError}</div>
          )}
        </div>
      </Modal>

      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} onConfirm={handleDelete}
        loading={actionLoading} title="Delete Expense"
        message={`Delete "${deleting?.description}"?`} />
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

export const Settings = () => {
  const { user } = useAuth();
  const [config, setConfig]   = useState(null);
  const [form, setForm]       = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState('');
  const years = generateAcademicYears();

  // NLSC grading settings (admin-editable)
  const [grading, setGrading]          = useState(null);
  const [gradingForm, setGradingForm]  = useState({});
  const [gradingLoading, setGradingLoading] = useState(true);
  const [gradingSaving, setGradingSaving] = useState(false);
  const [gradingSaved, setGradingSaved]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfg, gs] = await Promise.all([getConfig(), getGradingSettings().catch(() => null)]);
        if (cancelled) return;
        setConfig(cfg);
        setGrading(gs);
        setForm({
          schoolName:    cfg?.schoolName    || '',
          schoolMotto:   cfg?.schoolMotto   || '',
          schoolAddress: cfg?.schoolAddress || '',
          schoolPhone:   cfg?.schoolPhone   || '',
          schoolEmail:   cfg?.schoolEmail   || '',
          academicYear:  cfg?.academicYear  || years[0],
          currentTerm:   cfg?.currentTerm   || 'Term 1',
        });
        if (gs) {
          setGradingForm({
            caWeight:                  gs.caWeight,
            examWeight:                gs.examWeight,
            minSubjectsAtDOrAbove:     gs.certificateRule?.minSubjectsAtDOrAbove ?? 1,
            gradeBands: JSON.stringify((gs.gradeBands || DEFAULT_GRADE_BANDS).map((b) => ({ letter: b.letter, min: b.min, descriptor: b.descriptor })).filter(Boolean), null, 2),
          });
        }
      } catch (e) {
        setError(e.message || 'Failed to load settings.');
      } finally {
        if (!cancelled) { setLoading(false); setGradingLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const handleSave = async () => {
    if (!form.schoolName.trim()) { setError('School name is required.'); return; }
    setSaving(true);
    try {
      await updateConfig(form);
      setSaved(true);
      setError('');
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const setGradingField = (f) => (e) => setGradingForm((p) => ({ ...p, [f]: e.target.value }));

  const handleSaveGrading = async () => {
    if (!gradingForm.caWeight || !gradingForm.examWeight) { setError('CA and exam weights are required.'); return; }
    let bands;
    try {
      bands = JSON.parse(gradingForm.gradeBands || '[]');
    } catch (e) { setError('Grade bands must be valid JSON.'); return; }
    if (!bands.length) { setError('At least one grade band is required.'); return; }
    // bands sorted descending by min
    bands = bands.map((b) => ({ letter: b.letter, min: Number(b.min), descriptor: b.descriptor || '' })).sort((a, b) => b.min - a.min);
    setGradingSaving(true);
    try {
      await createOrUpdateGradingSettings({
        caWeight: Number(gradingForm.caWeight),
        examWeight: Number(gradingForm.examWeight),
        certificateRule: { minSubjectsAtDOrAbove: Number(gradingForm.minSubjectsAtDOrAbove) || 1 },
        gradeBands: bands,
      }, user?.id);
      setGradingSaved(true);
      setError('');
      // reload settings
      const gs = await getGradingSettings();
      setGrading(gs);
      setTimeout(() => setGradingSaved(false), 3000);
    } catch (e) { setError(e.message); }
    finally { setGradingSaving(false); }
  };

  if (loading) return <LoadingScreen />;

  return (
    <div className="space-y-5 animate-fade-in max-w-2xl">
      <PageHeader title="Settings" subtitle="School profile and academic year configuration" />
      <Card>
        <h3 className="font-display font-semibold text-slate-800 mb-5">School Profile</h3>
        <div className="space-y-4">
          <Input label="School Name" required value={form.schoolName} onChange={set('schoolName')} />
          <Input label="School Motto" value={form.schoolMotto} onChange={set('schoolMotto')} />
          <Input label="Address" value={form.schoolAddress} onChange={set('schoolAddress')} />
          <FormRow>
            <Input label="Phone" type="tel" value={form.schoolPhone} onChange={set('schoolPhone')} />
            <Input label="Email" type="email" value={form.schoolEmail} onChange={set('schoolEmail')} />
          </FormRow>
          <div className="border-t border-slate-100 pt-4">
            <h4 className="text-sm font-semibold text-slate-700 mb-3">Academic Period</h4>
            <FormRow>
              <Select label="Academic Year" value={form.academicYear} onChange={set('academicYear')}>
                {(() => {
                  const extra = config?.academicYear && !years.includes(config.academicYear)
                    ? [config.academicYear] : [];
                  return [...years, ...extra];
                })().map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </Select>
              <Select label="Current Term" value={form.currentTerm} onChange={set('currentTerm')}>
                {TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </FormRow>
          </div>

          {/* NLSC Grading Settings — admin only */}
          {!gradingLoading && (
            <Card className="mt-6">
              <div className="flex items-center gap-2 mb-4">
                <h4 className="font-display font-semibold text-slate-800">NLSC Grading Settings (Competence-Based)</h4>
                <Badge variant="default" className="text-[10px]">S1–S4 · UNEB</Badge>
              </div>
              <p className="text-xs text-slate-500 mb-4">
                Grade-band cut-offs are placeholders flagged <strong>"VERIFY WITH UNEB"</strong>. Final scores use
                CA × caWeight% + exam × examWeight%. A–E letters: exceptional / outstanding / satisfactory / basic / elementary.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <Input label="CA weight (%)" type="number" value={gradingForm.caWeight} onChange={setGradingField('caWeight')} />
                <Input label="Exam weight (%)" type="number" value={gradingForm.examWeight} onChange={setGradingField('examWeight')} />
                <Input label="Min subjects at D+ for certificate" type="number" value={gradingForm.minSubjectsAtDOrAbove} onChange={setGradingField('minSubjectsAtDOrAbove')} />
              </div>
              <p className="text-xs text-amber-600 mb-4">
                ⚠ CA weight (default 20%) and exam weight (default 80%) are
                placeholders — verify against UNEB guidance before go-live.
              </p>
              <Textarea label="Grade bands (JSON — sorted high→low by min)" rows={5} value={gradingForm.gradeBands} onChange={setGradingField('gradeBands')} hint='Example: [{"letter":"A","min":80,"descriptor":"exceptional"},{"letter":"B","min":65,"descriptor":"outstanding"},{"letter":"C","min":50,"descriptor":"satisfactory"},{"letter":"D","min":35,"descriptor":"basic"},{"letter":"E","min":0,"descriptor":"elementary"}]' />
              {grading && (
                <p className="text-xs text-slate-400 mt-2">
                  <span className="font-semibold">Current bands:</span> {' '}
                  {(grading.gradeBands || []).map((b) => `${b.letter} ≥ ${b.min}`).join(' · ')}
                  {grading.gradeBands?.some((b) => b.note) && <span className="text-amber-700 ml-2">⚠ Some bands are placeholders — VERIFY WITH UNEB</span>}
                </p>
              )}
              {error && (
                <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
              )}
              <div className="flex items-center gap-3 pt-2">
                <Button icon={Save} onClick={handleSaveGrading} loading={gradingSaving}>Save Grading Settings</Button>
                {gradingSaved && <span className="text-emerald-600 text-sm font-medium">✓ Grading settings saved</span>}
              </div>
            </Card>
          )}
          {error && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
          )}
          <div className="flex items-center gap-3 pt-2">
            <Button icon={Save} onClick={handleSave} loading={saving}>Save Settings</Button>
            {saved && <span className="text-emerald-600 text-sm font-medium">✓ Settings saved</span>}
          </div>
        </div>
      </Card>
    </div>
  );
};
