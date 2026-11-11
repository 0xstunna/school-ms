import { useState } from 'react';
import { User, CheckCircle2, ChevronRight, ChevronLeft, Eye, EyeOff } from 'lucide-react';
import AlamaLogo from '../../components/common/AlamaLogo.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { TERMS } from '../../utils/constants.js';
import { generateAcademicYears } from '../../utils/grading.js';
import Button from '../../components/common/Button.jsx';
import { Input, Select, FormRow } from '../../components/common/Input.jsx';
import { authErrorMessage } from '../../lib/authErrors.js';

// Trusted server-side onboarding endpoint (src/server/index.js).
// Configure via VITE_ONBOARD_SCHOOL_ENDPOINT; defaults to a relative route.
const ONBOARD_SCHOOL_ENDPOINT =
  (import.meta.env?.VITE_ONBOARD_SCHOOL_ENDPOINT && String(import.meta.env.VITE_ONBOARD_SCHOOL_ENDPOINT)) ||
  '/api/onboard-school';

const STEPS = [
  { id: 'school', label: 'School Profile', icon: AlamaLogo },
  { id: 'admin',  label: 'Admin Account',  icon: User   },
  { id: 'done',   label: 'Complete',       icon: CheckCircle2 },
];

/** Client-generated idempotency key so repeat submissions don't duplicate schools. */
function makeIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID.
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

const SetupWizard = ({ onComplete }) => {
  const { login } = useAuth();
  const [step, setStep]       = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [showPw, setShowPw]   = useState(false);
  // Idempotency key is generated once per wizard session so a page refresh
  // mid-onboarding resubmits the same key and the server returns the existing
  // school instead of creating a duplicate.
  const [idempotencyKey] = useState(makeIdempotencyKey);
  // Server-issued school ID captured once onboarding succeeds; used to hand
  // the new school off to the app when the user opens the dashboard.
  const [schoolId, setSchoolId] = useState('');

  const years = generateAcademicYears();

  const [schoolData, setSchoolData] = useState({
    schoolName: '', schoolMotto: '', schoolAddress: '',
    schoolPhone: '', schoolEmail: '',
    academicYear: years[0], currentTerm: 'Term 1',
  });

  const [adminData, setAdminData] = useState({
    fullName: '', email: '', password: '', confirmPassword: '',
  });

  const updateSchool = (f) => (e) => setSchoolData((p) => ({ ...p, [f]: e.target.value }));
  const updateAdmin  = (f) => (e) => setAdminData((p)  => ({ ...p, [f]: e.target.value }));

  const validateSchool = () => {
    if (!schoolData.schoolName.trim()) return 'School name is required.';
    if (!schoolData.academicYear)      return 'Academic year is required.';
    if (!schoolData.currentTerm)       return 'Current term is required.';
    return null;
  };

  const validateAdmin = () => {
    if (!adminData.fullName.trim()) return 'Full name is required.';
    if (!adminData.email.trim())    return 'Email is required.';
    if (!/\S+@\S+\.\S+/.test(adminData.email)) return 'Enter a valid email.';
    if (adminData.password.length < 8) return 'Password must be at least 8 characters.';
    if (adminData.password !== adminData.confirmPassword) return 'Passwords do not match.';
    return null;
  };

  const handleNext = async () => {
    setError('');
    if (step === 0) {
      const err = validateSchool();
      if (err) { setError(err); return; }
      setStep(1);
    } else if (step === 1) {
      const err = validateAdmin();
      if (err) { setError(err); return; }
      setLoading(true);
      try {
        // Send school + admin data to the trusted server-side onboarding
        // endpoint. The server generates the definitive school ID (never a
        // slug derived from the name), creates the school record, the first
        // administrator account, the membership, the active-school claims and
        // the school-specific configuration — all with rollback on failure.
        const schoolPayload = {
          schoolName:    schoolData.schoolName,
          schoolEmail:   schoolData.schoolEmail,
          schoolAddress: schoolData.schoolAddress,
          schoolPhone:   schoolData.schoolPhone,
          academicYear:  schoolData.academicYear,
          currentTerm:   schoolData.currentTerm,
          plan:          'trial', // billing deferred to a later milestone
          adminFullName: adminData.fullName,
          adminEmail:    adminData.email,
          adminPassword: adminData.password,
        };

        const resp = await fetch(ONBOARD_SCHOOL_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schoolData: schoolPayload, idempotencyKey }),
        });
        const json = await resp.json();
        if (!resp.ok) {
          throw new Error(json.error || 'Onboarding rejected by server.');
        }

        const serverSchoolId = json.schoolId;
        if (!serverSchoolId || typeof serverSchoolId !== 'string') {
          throw new Error('Server did not return a school ID.');
        }

        // Sign in the newly created administrator so the session carries the
        // server-issued active-school claims. initializeUserSession refreshes
        // the ID token so Firestore rule evaluation uses the new active school.
        await login(adminData.email, adminData.password);

        setSchoolId(serverSchoolId);
        setStep(2);
        onComplete(serverSchoolId);
      } catch (e) {
        const msg = authErrorMessage(e) || 'Setup failed. Please try again.';
        if (msg.includes('already exists')) {
          setError('An account or school with these details already exists. If you were mid-setup, click "Complete Setup" again — the existing school will be reused.');
        } else if (msg.includes('Failed to fetch') || msg.includes('network')) {
          setError('Could not reach the setup server. Please verify the server is running (see SETUP.md) and try again.');
        } else {
          setError(msg);
        }
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy-950 via-navy-900 to-navy-800 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-amber-500/5" />
        <div className="absolute -bottom-24 -right-24 w-80 h-80 rounded-full bg-amber-500/5" />
      </div>

      <div className="relative w-full max-w-xl animate-slide-up">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500 mb-4 shadow-lg">
            <AlamaLogo className="w-9 h-9" />
          </div>
          <h1 className="font-display text-3xl font-bold text-white mb-1">Alama Setup</h1>
          <p className="text-navy-300 text-sm">Configure your system in just a few steps</p>
        </div>

        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold transition-all
                ${i < step  ? 'bg-amber-500 text-white' :
                  i === step ? 'bg-white text-navy-900 ring-2 ring-amber-400' :
                               'bg-navy-700 text-navy-400'}`}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className={`text-xs hidden sm:block ${i === step ? 'text-white' : 'text-navy-500'}`}>
                {s.label}
              </span>
              {i < STEPS.length - 1 && (
                <div className={`w-8 h-px mx-1 ${i < step ? 'bg-amber-500' : 'bg-navy-700'}`} />
              )}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          {step === 0 && (
            <div className="p-7 space-y-4">
              <div>
                <h2 className="font-display text-xl font-bold text-slate-900">School Profile</h2>
                <p className="text-slate-500 text-sm mt-1">Tell us about your school</p>
              </div>
              <Input label="School Name" required placeholder="e.g. Kampala Secondary School"
                value={schoolData.schoolName} onChange={updateSchool('schoolName')} />
              <Input label="School Motto" placeholder="e.g. Excellence in Education"
                value={schoolData.schoolMotto} onChange={updateSchool('schoolMotto')} />
              <Input label="Address" placeholder="School physical address"
                value={schoolData.schoolAddress} onChange={updateSchool('schoolAddress')} />
              <FormRow>
                <Input label="Phone" placeholder="+256 ..." type="tel"
                  value={schoolData.schoolPhone} onChange={updateSchool('schoolPhone')} />
                <Input label="Email" placeholder="school@example.com" type="email"
                  value={schoolData.schoolEmail} onChange={updateSchool('schoolEmail')} />
              </FormRow>
              <FormRow>
                <Select label="Academic Year" required value={schoolData.academicYear}
                  onChange={updateSchool('academicYear')}>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </Select>
                <Select label="Current Term" required value={schoolData.currentTerm}
                  onChange={updateSchool('currentTerm')}>
                  {TERMS.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </FormRow>
            </div>
          )}

          {step === 1 && (
            <div className="p-7 space-y-4">
              <div>
                <h2 className="font-display text-xl font-bold text-slate-900">Admin Account</h2>
                <p className="text-slate-500 text-sm mt-1">Create the first administrator account</p>
              </div>
              <Input label="Full Name" required placeholder="e.g. John Doe"
                value={adminData.fullName} onChange={updateAdmin('fullName')} />
              <Input label="Email Address" required type="email" placeholder="admin@school.com"
                value={adminData.email} onChange={updateAdmin('email')} />
              <div className="relative">
                <Input label="Password" required type={showPw ? 'text' : 'password'}
                  placeholder="Minimum 8 characters"
                  value={adminData.password} onChange={updateAdmin('password')} />
                <button type="button" onClick={() => setShowPw((p) => !p)}
                  className="absolute right-3 top-7 text-slate-400 hover:text-slate-600">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <Input label="Confirm Password" required type="password" placeholder="Re-enter password"
                value={adminData.confirmPassword} onChange={updateAdmin('confirmPassword')} />
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                <strong>Important:</strong> Keep these credentials safe. You can create more users from the admin dashboard after setup.
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="p-7 text-center">
              <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-10 h-10 text-emerald-600" />
              </div>
              <h2 className="font-display text-xl font-bold text-slate-900 mb-2">Setup Complete!</h2>
              <p className="text-slate-500 text-sm mb-2">
                <strong>{schoolData.schoolName}</strong> is ready to use.
              </p>
              <p className="text-slate-400 text-xs mb-6">
                You are now signed in as admin. Click below to open the dashboard.
              </p>
            </div>
          )}

          {error && (
            <div className="mx-7 mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="px-7 pb-7 flex items-center justify-between">
            {step > 0 && step < 2 ? (
              <Button variant="secondary" icon={ChevronLeft}
                onClick={() => { setError(''); setStep((s) => s - 1); }}>Back</Button>
            ) : <div />}

            {step < 2 ? (
              <Button icon={ChevronRight} loading={loading} onClick={handleNext}>
                {step === 1 ? 'Complete Setup' : 'Continue'}
              </Button>
            ) : (
              <Button variant="amber" onClick={() => onComplete(schoolId || '')}>
                Open Dashboard →
              </Button>
            )}
          </div>
        </div>

        <p className="text-center text-navy-500 text-xs mt-4">
          Offline-first — data syncs to Firebase when connected
        </p>
      </div>
    </div>
  );
};

export default SetupWizard;
