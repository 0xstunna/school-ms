import { useState } from 'react';
import { School, User, CheckCircle2, ChevronRight, ChevronLeft, Eye, EyeOff } from 'lucide-react';
import { createConfig, isSetupComplete } from '../../db/configService.js';
import { createFirstAdmin } from '../../db/userService.js';
import { TERMS } from '../../utils/constants.js';
import { generateAcademicYears } from '../../utils/grading.js';
import Button from '../../components/common/Button.jsx';
import { Input, Select, FormRow } from '../../components/common/Input.jsx';

const STEPS = [
  { id: 'school', label: 'School Profile', icon: School },
  { id: 'admin',  label: 'Admin Account',  icon: User   },
  { id: 'done',   label: 'Complete',       icon: CheckCircle2 },
];

const SetupWizard = ({ onComplete }) => {
  const [step, setStep]       = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [showPw, setShowPw]   = useState(false);

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
        // If setup was already completed (e.g. page refreshed mid-wizard),
        // skip straight to the done step instead of re-creating everything.
        const alreadyDone = await isSetupComplete();
        if (alreadyDone) {
          setStep(2);
          return;
        }

        // createFirstAdmin creates the Firebase Auth account (or signs in if
        // it already exists from an interrupted earlier attempt), then writes
        // the Firestore profile. Only after that is the user authenticated,
        // so the config write below is allowed by Firestore rules.
        await createFirstAdmin(adminData);
        await createConfig(schoolData);
        setStep(2);
      } catch (e) {
        const msg = e.message || 'Setup failed. Please try again.';
        // Give a helpful hint for the two most common setup errors.
        if (e.code === 'auth/email-already-in-use') {
          setError('An account with this email already exists. If you were mid-setup, click "Complete Setup" again — the existing account will be reused.');
        } else if (e.code === 'permission-denied') {
          setError('Missing or insufficient permissions to write school data. Please verify your Firebase Firestore rules allow authenticated writes, then click "Complete Setup" again.');
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
            <School className="w-9 h-9 text-white" />
          </div>
          <h1 className="font-display text-3xl font-bold text-white mb-1">School Setup</h1>
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
              <Button variant="amber" onClick={onComplete}>
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
