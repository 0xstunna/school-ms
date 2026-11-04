import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, Wallet, CreditCard, AlertTriangle,
  Search, Settings, TrendingDown, Users, RefreshCw, DollarSign,
  FileBarChart, Download,
} from 'lucide-react';
import { getStudents } from '../../db/studentService.js';
import { getFeePayments, recordPayment, getStudentBalance } from '../../db/feeService.js';
import { getConfig } from '../../db/configService.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { CLASSES, STREAMS, PAYMENT_METHODS, TERMS } from '../../utils/constants.js';
import { formatCurrency, formatDate, getCurrentDateISO } from '../../utils/grading.js';
import Button from '../../components/common/Button.jsx';
import Modal from '../../components/common/Modal.jsx';
import { Input, Select, Textarea, FormRow } from '../../components/common/Input.jsx';
import {
  EmptyState, PageHeader, Card, Badge, LoadingScreen, StatCard,
} from '../../components/common/Badge.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_SUR = {
  enabled: false, dueDate: '', graceDays: 7, type: 'percent', value: 5,
};

function calcSurcharge(balance, surCfg) {
  if (!surCfg?.enabled || balance <= 0 || !surCfg.dueDate) return 0;
  const daysLate = Math.floor((Date.now() - new Date(surCfg.dueDate)) / 86_400_000);
  if (daysLate <= (Number(surCfg.graceDays) || 0)) return 0;
  return surCfg.type === 'percent'
    ? Math.round((balance * Number(surCfg.value)) / 100)
    : Number(surCfg.value);
}

function readSurConfig() {
  try { const s = localStorage.getItem('fees_sur'); return s ? JSON.parse(s) : DEFAULT_SUR; }
  catch { return DEFAULT_SUR; }
}

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

/** Convert rows array to a CSV string and trigger a browser download. */
function exportCSV(rows, surEnabled, term, year) {
  const baseHeaders = ['Name', 'Admission No', 'Class', 'Total Due (UGX)', 'Paid (UGX)', 'Balance (UGX)'];
  const surHeaders  = surEnabled ? ['Surcharge (UGX)', 'Total Owed (UGX)'] : [];
  const headers     = [...baseHeaders, ...surHeaders, 'Status'];

  const lines = [
    headers.join(','),
    ...rows.map((r) => {
      const base = [
        `"${r.fullName}"`,
        r.admissionNumber,
        r.classStream,
        r.totalDue  ?? '',
        r.paid      ?? '',
        r.balance   ?? '',
      ];
      const sur = surEnabled ? [r.surcharge ?? '', r.totalOwed ?? ''] : [];
      return [...base, ...sur, r.status].join(',');
    }),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `fees_${term}_${year}.csv`.replace(/\//g, '-');
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// Report Modal
// ─────────────────────────────────────────────────────────────────────────────

const REPORT_TABS = ['Summary', 'By Class', 'By Stream'];

const ReportModal = ({ open, onClose, rows, surEnabled, term, year }) => {
  const [tab, setTab] = useState('Summary');

  // Reset tab when modal opens
  useEffect(() => { if (open) setTab('Summary'); }, [open]);

  // ── Aggregate helpers ──
  const aggregate = (groups) =>
    Object.entries(groups).map(([key, members]) => {
      const due  = members.reduce((s, r) => s + (r.totalDue  ?? 0), 0);
      const paid = members.reduce((s, r) => s + (r.paid      ?? 0), 0);
      const bal  = members.reduce((s, r) => s + (r.balance   ?? 0), 0);
      const sur  = members.reduce((s, r) => s + (r.surcharge ?? 0), 0);
      return {
        key,
        count:   members.length,
        paid:    members.filter((r) => r.status === 'paid').length,
        owing:   members.filter((r) => r.status === 'owing' || r.status === 'overdue').length,
        overdue: members.filter((r) => r.status === 'overdue').length,
        due, bal, sur,
        totalOwed: bal + sur,
        // Re-use 'paid' for total collected — rename for clarity
        collected: paid,
      };
    }).sort((a, b) => a.key.localeCompare(b.key));

  const byClass  = useMemo(() => {
    const g = {};
    rows.forEach((r) => { (g[r.classStream] = g[r.classStream] || []).push(r); });
    return aggregate(g);
  }, [rows]);

  const byStream = useMemo(() => {
    const g = {};
    rows.forEach((r) => {
      // Extract stream letter from classStream e.g. "S1A" → "A", or fall back to "—"
      const match  = r.classStream?.match(/[A-Z]$/);
      const stream = match ? `Stream ${match[0]}` : 'Unknown';
      (g[stream] = g[stream] || []).push(r);
    });
    return aggregate(g);
  }, [rows]);

  const totals = useMemo(() => ({
    due:       rows.reduce((s, r) => s + (r.totalDue  ?? 0), 0),
    collected: rows.reduce((s, r) => s + (r.paid      ?? 0), 0),
    bal:       rows.reduce((s, r) => s + (r.balance   ?? 0), 0),
    sur:       rows.reduce((s, r) => s + (r.surcharge ?? 0), 0),
    paid:      rows.filter((r) => r.status === 'paid').length,
    owing:     rows.filter((r) => r.status === 'owing' || r.status === 'overdue').length,
    overdue:   rows.filter((r) => r.status === 'overdue').length,
    total:     rows.length,
  }), [rows]);

  const collectionRate = totals.due > 0
    ? Math.round((totals.collected / totals.due) * 100)
    : 0;

  // ── Breakdown table (shared for class + stream tabs) ──
  const BreakdownTable = ({ data }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-slate-100">
            {['Group', 'Students', 'Expected', 'Collected', 'Balance', ...(surEnabled ? ['Surcharge', 'Total Owed'] : []), 'Paid', 'Owing'].map((h) => (
              <th key={h} className={`py-2 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide ${h === 'Group' ? 'text-left' : 'text-right'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {data.map((row) => (
            <tr key={row.key} className="hover:bg-slate-50/70 transition-colors">
              <td className="py-2.5 px-2 font-medium text-slate-800">{row.key}</td>
              <td className="py-2.5 px-2 text-right text-slate-500">{row.count}</td>
              <td className="py-2.5 px-2 text-right text-slate-600 tabular-nums">{formatCurrency(row.due)}</td>
              <td className="py-2.5 px-2 text-right text-emerald-700 font-medium tabular-nums">{formatCurrency(row.collected)}</td>
              <td className={`py-2.5 px-2 text-right font-semibold tabular-nums ${row.bal > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatCurrency(row.bal)}</td>
              {surEnabled && <td className="py-2.5 px-2 text-right text-amber-700 tabular-nums">{row.sur > 0 ? formatCurrency(row.sur) : '—'}</td>}
              {surEnabled && <td className={`py-2.5 px-2 text-right font-bold tabular-nums ${row.totalOwed > 0 ? 'text-red-700' : 'text-emerald-600'}`}>{formatCurrency(row.totalOwed)}</td>}
              <td className="py-2.5 px-2 text-right">
                <span className="text-emerald-700 font-medium">{row.paid}</span>
                <span className="text-slate-300 mx-1">/</span>
                <span className="text-slate-500">{row.count}</span>
              </td>
              <td className="py-2.5 px-2 text-right">
                {row.owing > 0 ? <span className="text-red-600 font-medium">{row.owing}</span> : <span className="text-slate-300">0</span>}
                {row.overdue > 0 && <span className="text-amber-500 text-xs ml-1">({row.overdue} late)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title={`Fee Report · ${term} · ${year}`} size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button icon={Download} onClick={() => exportCSV(rows, surEnabled, term, year)}>
            Export CSV
          </Button>
        </>
      }
    >
      <div className="space-y-5">

        {/* ── Tab bar ── */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit">
          {REPORT_TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                tab === t ? 'bg-white text-navy-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >{t}</button>
          ))}
        </div>

        {/* ── Summary tab ── */}
        {tab === 'Summary' && (
          <div className="space-y-4">

            {/* KPI grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Total Expected',  value: formatCurrency(totals.due),       sub: `${totals.total} students`,               color: 'text-slate-800' },
                { label: 'Total Collected', value: formatCurrency(totals.collected),  sub: `${collectionRate}% collection rate`,     color: 'text-emerald-700' },
                { label: 'Outstanding',     value: formatCurrency(totals.bal),        sub: `${totals.owing} student${totals.owing !== 1 ? 's' : ''} owing`, color: totals.bal > 0 ? 'text-red-700' : 'text-emerald-700' },
                { label: 'Surcharge',       value: formatCurrency(totals.sur),        sub: `${totals.overdue} overdue`,              color: totals.sur > 0 ? 'text-amber-700' : 'text-slate-400' },
              ].map((k) => (
                <div key={k.label} className="rounded-xl border border-slate-100 p-4 bg-slate-50/50">
                  <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-1">{k.label}</p>
                  <p className={`text-lg font-bold tabular-nums ${k.color}`}>{k.value}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{k.sub}</p>
                </div>
              ))}
            </div>

            {/* Status distribution */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Status distribution</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Paid',    count: totals.paid,                       pct: totals.total > 0 ? Math.round((totals.paid    / totals.total) * 100) : 0, color: 'bg-emerald-500' },
                  { label: 'Owing',   count: totals.owing - totals.overdue,     pct: totals.total > 0 ? Math.round(((totals.owing - totals.overdue) / totals.total) * 100) : 0, color: 'bg-red-400' },
                  { label: 'Overdue', count: totals.overdue,                    pct: totals.total > 0 ? Math.round((totals.overdue / totals.total) * 100) : 0, color: 'bg-amber-500' },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-slate-100 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${s.color} shrink-0`} />
                      <span className="text-xs text-slate-500 font-medium">{s.label}</span>
                    </div>
                    <p className="text-xl font-bold text-slate-800 tabular-nums">{s.count}</p>
                    <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className={`h-full rounded-full ${s.color}`} style={{ width: `${s.pct}%` }} />
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{s.pct}% of students</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Collection progress bar */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs text-slate-500 font-medium">Collection progress</p>
                <p className="text-xs font-bold text-slate-700">{collectionRate}%</p>
              </div>
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${collectionRate}%` }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <p className="text-xs text-emerald-600">{formatCurrency(totals.collected)} collected</p>
                <p className="text-xs text-red-500">{formatCurrency(totals.bal)} outstanding</p>
              </div>
            </div>
          </div>
        )}

        {/* ── By Class tab ── */}
        {tab === 'By Class' && (
          <div>
            <p className="text-xs text-slate-400 mb-3">{byClass.length} class group{byClass.length !== 1 ? 's' : ''}</p>
            <BreakdownTable data={byClass} />
          </div>
        )}

        {/* ── By Stream tab ── */}
        {tab === 'By Stream' && (
          <div>
            <p className="text-xs text-slate-400 mb-3">{byStream.length} stream{byStream.length !== 1 ? 's' : ''}</p>
            <BreakdownTable data={byStream} />
          </div>
        )}
      </div>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Record Payment Modal (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_FORM = () => ({
  amountPaid:       '',
  remainingBalance: '',
  paymentMethod:    'Cash',
  paidBy:           '',
  payerPhone:       '',
  paymentDate:      getCurrentDateISO(),
  notes:            '',
});

const PaymentModal = ({ open, onClose, onSave, config, surConfig, selectedTerm, selectedYear }) => {
  const [search, setSearch]                 = useState('');
  const [suggestions, setSug]               = useState([]);
  const [selected, setSelected]             = useState(null);
  const [balance, setBalance]               = useState(null);
  const [includeSur, setIncludeSur]         = useState(false);
  const [form, setForm]                     = useState(EMPTY_FORM());
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState('');
  const [balanceManuallySet, setBalanceManuallySet] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearch(''); setSug([]); setSelected(null); setBalance(null);
      setIncludeSur(false); setError(''); setForm(EMPTY_FORM()); setBalanceManuallySet(false);
    }
  }, [open]);

  useEffect(() => {
    if (search.length < 2) { setSug([]); return; }
    getStudents({ search }).then(setSug);
  }, [search]);

  useEffect(() => {
    if (!selected || !config) return;
    setBalance(null);
    getStudentBalance(selected.id, selected.classLevel, selectedYear, selectedTerm).then(setBalance);
  }, [selected, config, selectedTerm, selectedYear]);

  useEffect(() => {
    if (balanceManuallySet || !balance) return;
    const parsed       = parseFloat(form.amountPaid) || 0;
    const clampedBal   = Math.max(0, balance.balance);
    const effectiveBal = clampedBal + (includeSur ? calcSurcharge(clampedBal, surConfig) : 0);
    const computed     = Math.max(0, effectiveBal - parsed);
    setForm((p) => ({ ...p, remainingBalance: parsed > 0 ? String(computed) : '' }));
  }, [form.amountPaid, balance, balanceManuallySet, includeSur, surConfig]);

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const effectiveBalance = balance ? Math.max(0, balance.balance) : 0;
  const surAmt           = balance ? calcSurcharge(effectiveBalance, surConfig) : 0;
  const totalOwed        = effectiveBalance + surAmt;
  const parsedAmt        = parseFloat(form.amountPaid) || 0;

  const isHistorical = config
    && (selectedTerm !== config.currentTerm || selectedYear !== config.academicYear);

  const handleSave = async () => {
    if (!selected)      { setError('Select a student first.'); return; }
    if (parsedAmt <= 0) { setError('Enter a valid amount.');   return; }
    setLoading(true);
    try {
      await onSave({
        ...form,
        amountPaid:       parsedAmt,
        remainingBalance: parseFloat(form.remainingBalance) || 0,
        studentId:        selected.id,
        academicYear:     selectedYear,
        term:             selectedTerm,
        ...(includeSur && surAmt > 0 ? { surchargeApplied: surAmt } : {}),
      });
      onClose();
    } catch (e) { setError(e.message); }
    finally     { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Record Fee Payment" size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSave} loading={loading} icon={CreditCard}>Record Payment</Button>
        </>
      }
    >
      <div className="space-y-4">
        {isHistorical && (
          <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700">
            <AlertTriangle size={13} className="shrink-0" />
            <span>Recording against <strong>{selectedTerm} · {selectedYear}</strong> (not the active term).</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="px-2.5 py-1 rounded-full bg-slate-100 font-medium">{selectedTerm}</span>
          <span className="px-2.5 py-1 rounded-full bg-slate-100 font-medium">{selectedYear}</span>
        </div>
        <div>
          <Input label="Search Student" placeholder="Type name or admission number…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (selected) { setSelected(null); setBalance(null); }
            }}
          />
          {suggestions.length > 0 && !selected && (
            <div className="mt-1 border border-slate-200 rounded-lg overflow-hidden shadow-sm bg-white z-10 relative">
              {suggestions.slice(0, 5).map((s) => (
                <button key={s.id}
                  onClick={() => { setSelected(s); setSug([]); setSearch(s.fullName); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 border-b last:border-0 text-left">
                  <div className="w-7 h-7 rounded-full bg-navy-100 flex items-center justify-center text-navy-700 text-xs font-bold shrink-0">
                    {s.fullName[0]}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{s.fullName}</p>
                    <p className="text-xs text-slate-400">{s.admissionNumber} · {s.classStream}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        {selected && (
          <div className="flex items-center gap-3 px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-100">
            <div className="w-9 h-9 rounded-full bg-navy-100 flex items-center justify-center text-navy-700 text-sm font-bold shrink-0">
              {selected.fullName[0]}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 leading-tight">{selected.fullName}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {selected.admissionNumber} · {selected.classStream ?? `${selected.classLevel}${selected.stream ?? ''}`}
              </p>
            </div>
          </div>
        )}
        {selected && (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Fee Summary</p>
            </div>
            {!balance ? (
              <div className="px-4 py-3 flex items-center gap-2 text-sm text-slate-400">
                <RefreshCw size={13} className="animate-spin" /> Loading…
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 divide-x divide-slate-100">
                  {[
                    { l: 'Total Due', v: formatCurrency(balance.totalDue),  c: 'text-slate-700' },
                    { l: 'Paid',      v: formatCurrency(balance.totalPaid), c: 'text-emerald-700' },
                    { l: 'Remaining', v: formatCurrency(Math.max(0, balance.balance)),
                      c: Math.max(0, balance.balance) > 0 ? 'text-red-700' : 'text-emerald-700' },
                  ].map((i) => (
                    <div key={i.l} className="text-center py-3">
                      <p className="text-xs text-slate-400 mb-0.5">{i.l}</p>
                      <p className={`text-sm font-bold ${i.c}`}>{i.v}</p>
                    </div>
                  ))}
                </div>
                {surConfig.enabled && Math.max(0, balance.balance) > 0 && (
                  <div className="px-4 py-2.5 bg-amber-50 border-t border-amber-100 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-amber-800">
                        Surcharge: {formatCurrency(surAmt)}
                        {surAmt === 0 && ' (within grace period)'}
                      </p>
                      {surAmt > 0 && (
                        <p className="text-xs text-amber-600">
                          Total owed: <strong>{formatCurrency(totalOwed)}</strong>
                        </p>
                      )}
                    </div>
                    {surAmt > 0 && (
                      <label className="flex items-center gap-2 cursor-pointer shrink-0">
                        <input type="checkbox" checked={includeSur}
                          onChange={(e) => {
                            setIncludeSur(e.target.checked);
                            setBalanceManuallySet(false);
                            if (e.target.checked)
                              setForm((p) => ({ ...p, amountPaid: String(totalOwed) }));
                          }}
                          className="w-3.5 h-3.5 rounded accent-amber-600" />
                        <span className="text-xs text-amber-700 font-medium">Include surcharge</span>
                      </label>
                    )}
                  </div>
                )}
                {Math.max(0, balance.balance) > 0 && (
                  <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center gap-2">
                    <p className="text-xs text-slate-400">Quick fill:</p>
                    <button
                      onClick={() => {
                        setBalanceManuallySet(false);
                        setForm((p) => ({ ...p, amountPaid: String(Math.max(0, balance.balance)) }));
                      }}
                      className="text-xs px-2.5 py-1 rounded-full border border-slate-200 hover:bg-white text-slate-600 transition-colors">
                      Balance ({formatCurrency(Math.max(0, balance.balance))})
                    </button>
                    {surAmt > 0 && (
                      <button
                        onClick={() => {
                          setBalanceManuallySet(false);
                          setForm((p) => ({ ...p, amountPaid: String(totalOwed) }));
                        }}
                        className="text-xs px-2.5 py-1 rounded-full border border-amber-200 hover:bg-amber-50 text-amber-700 transition-colors">
                        + Surcharge ({formatCurrency(totalOwed)})
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        <FormRow>
          <Input label="Amount Paid (UGX)" required type="number" placeholder="0"
            value={form.amountPaid} onChange={set('amountPaid')} />
          <Input label="Remaining Balance (UGX)" type="number" placeholder="0"
            value={form.remainingBalance}
            onChange={(e) => { setBalanceManuallySet(true); set('remainingBalance')(e); }} />
        </FormRow>
        <FormRow>
          <Select label="Payment Method" value={form.paymentMethod} onChange={set('paymentMethod')}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
          <Input label="Payment Date" type="date" value={form.paymentDate} onChange={set('paymentDate')} />
        </FormRow>
        <FormRow>
          <Input label="Paid By" placeholder="Parent / guardian name"
            value={form.paidBy} onChange={set('paidBy')} />
          <Input label="Phone Number" type="tel" placeholder="e.g. 0712 345 678"
            value={form.payerPhone} onChange={set('payerPhone')} />
        </FormRow>
        <Textarea label="Notes (optional)" placeholder="Any additional notes…" rows={2}
          value={form.notes} onChange={set('notes')} />
        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
        )}
      </div>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Surcharge Config Modal (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

const SurchargeModal = ({ open, onClose, config, onSave }) => {
  const [form, setForm] = useState({ ...config });
  const set = (f) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((p) => ({ ...p, [f]: val }));
  };
  useEffect(() => { if (open) setForm({ ...config }); }, [open, config]);

  return (
    <Modal open={open} onClose={onClose} title="Surcharge Settings" size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { onSave(form); onClose(); }}>Save Settings</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Add a late-payment surcharge to outstanding balances once the due date has passed.
        </p>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={form.enabled} onChange={set('enabled')}
            className="w-4 h-4 rounded accent-navy-600" />
          <span className="text-sm font-medium text-slate-700">Enable surcharge</span>
        </label>
        {form.enabled && (
          <>
            <Input label="Payment Due Date" type="date" value={form.dueDate} onChange={set('dueDate')} />
            <Input label="Grace Period (days after due date)" type="number" min="0"
              placeholder="0" value={form.graceDays} onChange={set('graceDays')} />
            <Select label="Surcharge Type" value={form.type} onChange={set('type')}>
              <option value="percent">Percentage of balance (%)</option>
              <option value="flat">Flat amount (UGX)</option>
            </Select>
            <Input
              label={form.type === 'percent' ? 'Surcharge Rate (%)' : 'Surcharge Amount (UGX)'}
              type="number" min="0" placeholder="0"
              value={form.value} onChange={set('value')} />
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
              <strong>Preview:</strong> A student with UGX 200,000 owing past grace would owe an extra{' '}
              <strong>
                {form.type === 'percent'
                  ? formatCurrency(Math.round((200_000 * Number(form.value)) / 100))
                  : formatCurrency(Number(form.value))}
              </strong>.
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Status filter config
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_FILTERS = [
  { key: 'all',     label: 'All' },
  { key: 'paid',    label: 'Paid' },
  { key: 'owing',   label: 'Owing' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'unknown', label: 'Unknown' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main Fees Component
// ─────────────────────────────────────────────────────────────────────────────

const Fees = () => {
  const { user } = useAuth();

  const [config, setConfig]         = useState(null);
  const [configLoading, setCfgLoad] = useState(true);
  const [surConfig, setSurConfig]   = useState(readSurConfig);

  const [selectedTerm, setSelectedTerm] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [yearOptions, setYearOptions]   = useState([]);

  const [modalOpen, setModalOpen]   = useState(false);
  const [surModalOpen, setSurModal] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const [search, setSearch]             = useState('');
  const [filterClass, setFilterClass]   = useState('');
  const [filterStream, setFilterStream] = useState('');
  // ── NEW: status filter ──
  const [filterStatus, setFilterStatus] = useState('all');

  const [rows, setRows]          = useState([]);
  const [tableLoading, setTLoad] = useState(false);

  useEffect(() => {
    getConfig().then((cfg) => {
      setConfig(cfg);
      setSelectedTerm(cfg?.currentTerm  || TERMS[0]);
      setSelectedYear(cfg?.academicYear || '');
      setYearOptions(buildYearOptions(cfg?.academicYear));
      setCfgLoad(false);
    });
  }, []);

  const loadTable = useCallback(async () => {
    if (!config || !selectedTerm || !selectedYear) return;
    setTLoad(true);
    try {
      const students = await getStudents({
        classLevel: filterClass  || undefined,
        stream:     filterStream || undefined,
        search:     search       || undefined,
      });
      const balances = await Promise.all(
        students.map((s) =>
          getStudentBalance(s.id, s.classLevel, selectedYear, selectedTerm).catch(() => null)
        )
      );
      setRows(students.map((s, i) => {
        const b          = balances[i];
        const rawBalance = b?.balance ?? null;
        const balance    = rawBalance !== null ? Math.max(0, rawBalance) : null;
        const sur        = balance !== null ? calcSurcharge(balance, surConfig) : 0;
        return {
          id:              s.id,
          fullName:        s.fullName,
          admissionNumber: s.admissionNumber,
          classStream:     s.classStream || `${s.classLevel}${s.stream}`,
          totalDue:        b?.totalDue  ?? null,
          paid:            b?.totalPaid ?? null,
          balance,
          surcharge:       sur,
          totalOwed:       balance !== null ? (balance + sur) : null,
          status:          !b               ? 'unknown'
                         : balance <= 0     ? 'paid'
                         : sur > 0          ? 'overdue'
                         :                    'owing',
        };
      }));
    } finally { setTLoad(false); }
  }, [config, filterClass, filterStream, search, surConfig, selectedTerm, selectedYear]);

  useEffect(() => { loadTable(); }, [loadTable]);

  // ── NEW: client-side status filter ──
  const filteredRows = useMemo(() => {
    if (filterStatus === 'all') return rows;
    // "owing" pill shows both owing AND overdue (overdue is a sub-state of owing)
    if (filterStatus === 'owing') return rows.filter((r) => r.status === 'owing' || r.status === 'overdue');
    return rows.filter((r) => r.status === filterStatus);
  }, [rows, filterStatus]);

  // Counts used on the pills — always from unfiltered `rows`
  const statusCounts = useMemo(() => ({
    all:     rows.length,
    paid:    rows.filter((r) => r.status === 'paid').length,
    owing:   rows.filter((r) => r.status === 'owing' || r.status === 'overdue').length,
    overdue: rows.filter((r) => r.status === 'overdue').length,
    unknown: rows.filter((r) => r.status === 'unknown').length,
  }), [rows]);

  const handleRecordPayment = async (data) => {
    await recordPayment(data, user.id);
    loadTable();
  };

  const handleSaveSurcharge = (cfg) => {
    setSurConfig(cfg);
    try { localStorage.setItem('fees_sur', JSON.stringify(cfg)); } catch {}
  };

  // Totals driven by filteredRows so they match the visible table
  const totals = useMemo(() => {
    let due = 0, paid = 0, bal = 0, sur = 0;
    filteredRows.forEach((r) => {
      due  += r.totalDue  ?? 0;
      paid += r.paid      ?? 0;
      bal  += r.balance   ?? 0;
      sur  += r.surcharge ?? 0;
    });
    return { due, paid, bal, sur };
  }, [filteredRows]);

  const paidCount    = filteredRows.filter((r) => r.status === 'paid').length;
  const owingCount   = filteredRows.filter((r) => r.status === 'owing' || r.status === 'overdue').length;
  const overdueCount = filteredRows.filter((r) => r.status === 'overdue').length;
  const filterLabel  = [filterClass, filterStream && `Stream ${filterStream}`].filter(Boolean).join(' · ');

  const isHistoricalView = config
    && (selectedTerm !== config.currentTerm || selectedYear !== config.academicYear);

  if (configLoading) return <LoadingScreen />;

  const STATUS_MAP = {
    paid:    { label: 'Paid',    variant: 'success' },
    owing:   { label: 'Owing',   variant: 'danger'  },
    overdue: { label: 'Overdue', variant: 'warning' },
    unknown: { label: '—',       variant: 'default' },
  };

  return (
    <div className="space-y-5 animate-fade-in">

      <PageHeader
        title="Fees Management"
        subtitle={`${selectedTerm} · ${selectedYear}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" icon={FileBarChart} size="sm" onClick={() => setReportOpen(true)}>
              Report
            </Button>
            <Button variant="secondary" icon={Settings} size="sm" onClick={() => setSurModal(true)}>
              Surcharge
              {surConfig.enabled && (
                <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-400 text-amber-900 text-xs font-bold">!</span>
              )}
            </Button>
            <Button icon={Plus} onClick={() => setModalOpen(true)}>Record Payment</Button>
          </div>
        }
      />

      {/* ── Term / Academic Year selectors ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-xl">
          {TERMS.map((t) => (
            <button key={t} onClick={() => setSelectedTerm(t)}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                selectedTerm === t ? 'bg-white text-navy-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >{t}</button>
          ))}
        </div>
        <Select value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} className="w-40">
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}{y === config?.academicYear ? ' (current)' : ''}</option>
          ))}
        </Select>
        {isHistoricalView && (
          <span className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-full">
            <AlertTriangle size={11} />
            Historical view
            <button
              onClick={() => { setSelectedTerm(config.currentTerm); setSelectedYear(config.academicYear); }}
              className="ml-1 underline underline-offset-2 hover:text-blue-800"
            >Back to current</button>
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard title="Total Expected"  value={formatCurrency(totals.due)}  icon={DollarSign}   color="navy"    subtitle={filterLabel || 'All classes'} />
        <StatCard title="Total Collected" value={formatCurrency(totals.paid)} icon={Wallet}       color="emerald" subtitle={filterLabel || 'All classes'} />
        <StatCard title="Outstanding"     value={formatCurrency(totals.bal)}  icon={TrendingDown} color="red"     subtitle={`${owingCount} student${owingCount !== 1 ? 's' : ''}`} />
        <StatCard
          title={surConfig.enabled ? 'Total Surcharge' : 'Current Term'}
          value={surConfig.enabled ? formatCurrency(totals.sur) : (config?.currentTerm || '—')}
          icon={surConfig.enabled ? AlertTriangle : CreditCard}
          color="amber"
          subtitle={surConfig.enabled ? `${overdueCount} overdue` : config?.academicYear}
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h3 className="font-display font-semibold text-slate-800">Fee Tracker</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {filteredRows.length} student{filteredRows.length !== 1 ? 's' : ''}
              {filterLabel ? ` · ${filterLabel}` : ''}{' · '}
              <span className="text-emerald-600">{paidCount} paid</span>{' · '}
              <span className="text-red-500">{owingCount} owing</span>
              {overdueCount > 0 && <><span className="text-slate-300"> · </span><span className="text-amber-600">{overdueCount} overdue</span></>}
            </p>
          </div>
          {/* ── CSV export shortcut (exports filteredRows) ── */}
          <Button variant="ghost" size="sm" icon={Download}
            onClick={() => exportCSV(filteredRows, surConfig.enabled, selectedTerm, selectedYear)}>
            Export
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Input placeholder="Search name or admission no…" icon={Search}
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-48 max-w-xs" />
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

        {/* ── NEW: Status filter pills ── */}
        <div className="flex flex-wrap items-center gap-1.5 mb-5">
          {STATUS_FILTERS.map(({ key, label }) => {
            const count   = statusCounts[key];
            const active  = filterStatus === key;
            const dotColor = {
              all: '',
              paid: 'bg-emerald-500',
              owing: 'bg-red-400',
              overdue: 'bg-amber-500',
              unknown: 'bg-slate-300',
            }[key];
            return (
              <button
                key={key}
                onClick={() => setFilterStatus(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  active
                    ? 'bg-navy-800 text-white border-navy-800 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                {key !== 'all' && (
                  <span className={`w-2 h-2 rounded-full ${active ? 'bg-white/70' : dotColor}`} />
                )}
                {label}
                <span className={`ml-0.5 ${active ? 'text-white/70' : 'text-slate-400'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {surConfig.enabled && (
          <div className="flex items-center gap-2 p-3 mb-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            <AlertTriangle size={14} className="shrink-0" />
            <span>
              Surcharge active ·{' '}
              {surConfig.type === 'percent'
                ? `${surConfig.value}% of outstanding`
                : `${formatCurrency(surConfig.value)} flat`}
              {surConfig.dueDate && ` · Due: ${formatDate(surConfig.dueDate)}`}
              {Number(surConfig.graceDays) > 0 && ` · Grace: ${surConfig.graceDays} days`}
            </span>
          </div>
        )}

        {tableLoading ? <LoadingScreen /> : filteredRows.length === 0 ? (
          <EmptyState icon={Users} title="No students found"
            message={filterClass || filterStream || search || filterStatus !== 'all'
              ? 'No students match your current filters.'
              : 'No students have been registered yet.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-slate-100">
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Student</th>
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Class</th>
                  <th className="text-right py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Total Due</th>
                  <th className="text-right py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Paid</th>
                  <th className="text-right py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Balance</th>
                  {surConfig.enabled && (
                    <th className="text-right py-2.5 px-3 text-xs font-semibold text-amber-500 uppercase tracking-wide">Surcharge</th>
                  )}
                  {surConfig.enabled && (
                    <th className="text-right py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Total Owed</th>
                  )}
                  <th className="text-center py-2.5 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredRows.map((r) => {
                  const s = STATUS_MAP[r.status];
                  return (
                    <tr key={r.id}
                      className={`hover:bg-slate-50/70 transition-colors ${r.status === 'overdue' ? 'bg-amber-50/30' : ''}`}>
                      <td className="py-3 px-3">
                        <p className="text-sm font-medium text-slate-800">{r.fullName}</p>
                        <p className="text-xs text-slate-400">{r.admissionNumber}</p>
                      </td>
                      <td className="py-3 px-3">
                        <Badge variant="navy">{r.classStream}</Badge>
                      </td>
                      <td className="py-3 px-3 text-sm text-slate-600 text-right tabular-nums">
                        {r.totalDue !== null ? formatCurrency(r.totalDue) : '—'}
                      </td>
                      <td className="py-3 px-3 text-sm font-medium text-emerald-700 text-right tabular-nums">
                        {r.paid !== null ? formatCurrency(r.paid) : '—'}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">
                        {r.balance !== null
                          ? <span className={`text-sm font-semibold ${r.balance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                              {formatCurrency(r.balance)}
                            </span>
                          : '—'}
                      </td>
                      {surConfig.enabled && (
                        <td className="py-3 px-3 text-right tabular-nums">
                          {r.surcharge > 0
                            ? <span className="text-sm font-medium text-amber-700">{formatCurrency(r.surcharge)}</span>
                            : <span className="text-slate-300 text-sm">—</span>}
                        </td>
                      )}
                      {surConfig.enabled && (
                        <td className="py-3 px-3 text-right tabular-nums">
                          {r.totalOwed !== null
                            ? <span className={`text-sm font-bold ${r.totalOwed > 0 ? 'text-red-700' : 'text-emerald-600'}`}>
                                {formatCurrency(r.totalOwed)}
                              </span>
                            : '—'}
                        </td>
                      )}
                      <td className="py-3 px-3 text-center">
                        <Badge variant={s.variant}>{s.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td className="py-3 px-3 text-xs font-semibold text-slate-500 uppercase">Totals</td>
                  <td className="py-3 px-3 text-xs text-slate-400">{filteredRows.length} students</td>
                  <td className="py-3 px-3 text-sm font-semibold text-slate-700 text-right tabular-nums">{formatCurrency(totals.due)}</td>
                  <td className="py-3 px-3 text-sm font-semibold text-emerald-700 text-right tabular-nums">{formatCurrency(totals.paid)}</td>
                  <td className="py-3 px-3 text-sm font-semibold text-red-600 text-right tabular-nums">{formatCurrency(totals.bal)}</td>
                  {surConfig.enabled && (
                    <td className="py-3 px-3 text-sm font-semibold text-amber-600 text-right tabular-nums">{formatCurrency(totals.sur)}</td>
                  )}
                  {surConfig.enabled && (
                    <td className="py-3 px-3 text-sm font-bold text-red-700 text-right tabular-nums">{formatCurrency(totals.bal + totals.sur)}</td>
                  )}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <PaymentModal
        open={modalOpen} onClose={() => setModalOpen(false)}
        onSave={handleRecordPayment} config={config} surConfig={surConfig}
        selectedTerm={selectedTerm} selectedYear={selectedYear}
      />
      <SurchargeModal
        open={surModalOpen} onClose={() => setSurModal(false)}
        config={surConfig} onSave={handleSaveSurcharge}
      />
      <ReportModal
        open={reportOpen} onClose={() => setReportOpen(false)}
        rows={rows}
        surEnabled={surConfig.enabled}
        term={selectedTerm}
        year={selectedYear}
      />
    </div>
  );
};

export default Fees;
