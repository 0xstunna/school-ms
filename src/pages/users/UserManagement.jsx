import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, UserX, UserCheck, ShieldCheck, Search, Eye, EyeOff } from 'lucide-react';
import { getUsers, createUser, updateUser, deactivateUser, activateUser, countAdmins } from '../../db/userService.js';
import { ROLES, ROLE_LABELS, ROLE_COLORS } from '../../utils/constants.js';
import { formatDate } from '../../utils/grading.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { isEnabled, financeEnabled } from '../../utils/featureFlags.js';
import Button from '../../components/common/Button.jsx';
import Modal, { ConfirmModal } from '../../components/common/Modal.jsx';
import { Input, Select, FormRow } from '../../components/common/Input.jsx';
import { Badge, EmptyState, PageHeader, Card, LoadingScreen } from '../../components/common/Badge.jsx';

const EMPTY_FORM = {
  fullName: '', email: '', password: '', confirmPassword: '',
  role: 'teacher', assignedClasses: [],
};

const UserModal = ({ open, onClose, onSave, existing }) => {
  const isEdit = !!existing;
  const [form, setForm]       = useState(EMPTY_FORM);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw]   = useState(false);

  useEffect(() => {
    if (open) {
      setForm(existing
        ? { fullName: existing.fullName, email: existing.email,
            password: '', confirmPassword: '',
            role: existing.role, assignedClasses: existing.assignedClasses || [] }
        : EMPTY_FORM
      );
      setError('');
    }
  }, [open, existing]);

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }));

  const validate = () => {
    if (!form.fullName.trim()) return 'Full name is required.';
    if (!form.email.trim())    return 'Email is required.';
    if (!/\S+@\S+\.\S+/.test(form.email)) return 'Enter a valid email.';
    if (!isEdit) {
      if (form.password.length < 8) return 'Password must be at least 8 characters.';
      if (form.password !== form.confirmPassword) return 'Passwords do not match.';
    }
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
      setError(e.message || 'Failed to save user.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}
      title={isEdit ? 'Edit User' : 'Create New User'}
      subtitle={isEdit ? 'Update user information' : 'Creates a Firebase Auth account for this user'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSave} loading={loading}>{isEdit ? 'Save Changes' : 'Create User'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Full Name" required placeholder="e.g. Jane Doe"
          value={form.fullName} onChange={set('fullName')} />
        <Input label="Email Address" required type="email" placeholder="user@school.com"
          value={form.email} onChange={set('email')} />
        <Select label="Role" required value={form.role} onChange={set('role')}>
          {Object.entries(ROLES)
            .filter(([, v]) => !(v === 'bursar' && !financeEnabled))
            .map(([, v]) => (
              <option key={v} value={v}>{ROLE_LABELS[v]}</option>
            ))}
        </Select>

        {!isEdit && (
          <div className="border-t border-slate-100 pt-4 space-y-4">
            <p className="text-xs text-slate-500">
              Set a temporary password. The user should change it after first login.
            </p>
            <div className="relative">
              <Input label="Password" required
                type={showPw ? 'text' : 'password'} placeholder="Min. 8 characters"
                value={form.password} onChange={set('password')} />
              <button type="button" onClick={() => setShowPw((p) => !p)}
                className="absolute right-3 top-7 text-slate-400 hover:text-slate-600">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Input label="Confirm Password" required type="password"
              placeholder="Re-enter password"
              value={form.confirmPassword} onChange={set('confirmPassword')} />
          </div>
        )}

        {isEdit && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-500">
            Password changes are not supported here. The user must change their own password from the profile settings, or contact a system administrator.
          </div>
        )}

        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
        )}
      </div>
    </Modal>
  );
};

const UserManagement = () => {
  const { user: me } = useAuth();
  const [users, setUsers]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing]     = useState(null);
  const [confirm, setConfirm]     = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await getUsers()); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = users.filter((u) =>
    !search ||
    u.fullName?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  const handleSave = async (form) => {
    if (editing) {
      // Edit: update Firestore profile only (name, role)
      await updateUser(editing.id, { fullName: form.fullName, email: form.email, role: form.role });
    } else {
      // Create: uses secondary Firebase Auth app, then Firestore profile
      await createUser(form, me.id);
    }
    await load();
  };

  const handleToggleActive = async () => {
    if (!confirm) return;
    setActionLoading(true);
    try {
      if (confirm.user.active) {
        const adminCount = await countAdmins();
        if (confirm.user.role === 'admin' && adminCount <= 1)
          throw new Error('Cannot deactivate the only admin account.');
        await deactivateUser(confirm.user.id);
      } else {
        await activateUser(confirm.user.id);
      }
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setActionLoading(false);
      setConfirm(null);
    }
  };

  if (loading) return <LoadingScreen />;

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="User Accounts"
        subtitle="Manage who can access the system"
        actions={
          <Button icon={Plus} onClick={() => { setEditing(null); setModalOpen(true); }}>
            New User
          </Button>
        }
      />

      <Card>
        <div className="flex items-center gap-3 mb-5">
          <Input placeholder="Search by name or email…" icon={Search}
            value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
          <span className="text-sm text-slate-500 ml-auto">
            {filtered.length} user{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No users found"
            message="Create user accounts for teachers and bursars." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  {['Name', 'Email', 'Role', 'Status', 'Created', 'Actions'].map((h) => (
                    <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-navy-100 flex items-center justify-center text-navy-700 font-semibold text-sm flex-shrink-0">
                          {u.fullName?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-800">{u.fullName}</p>
                          {u.id === me?.id && <span className="text-xs text-amber-600 font-medium">You</span>}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-sm text-slate-600">{u.email}</td>
                    <td className="py-3 px-3">
                      <Badge className={ROLE_COLORS[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                    </td>
                    <td className="py-3 px-3">
                      <Badge variant={u.active ? 'success' : 'default'}>{u.active ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="py-3 px-3 text-sm text-slate-400">{formatDate(u.createdAt)}</td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1">
                        <Button size="xs" variant="ghost" icon={Edit2}
                          onClick={() => { setEditing(u); setModalOpen(true); }} />
                        {u.id !== me?.id && (
                          <Button size="xs" variant="ghost"
                            icon={u.active ? UserX : UserCheck}
                            className={u.active ? 'text-red-500 hover:bg-red-50' : 'text-emerald-600 hover:bg-emerald-50'}
                            onClick={() => setConfirm({ user: u })}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <UserModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        existing={editing}
      />

      <ConfirmModal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={handleToggleActive}
        loading={actionLoading}
        title={confirm?.user?.active ? 'Deactivate User' : 'Activate User'}
        message={confirm?.user?.active
          ? `Deactivate ${confirm?.user?.fullName}? They will no longer be able to sign in.`
          : `Reactivate ${confirm?.user?.fullName}? They will be able to sign in again.`}
        confirmLabel={confirm?.user?.active ? 'Deactivate' : 'Activate'}
      />
    </div>
  );
};

export default UserManagement;
