import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import { isSetupComplete, getConfig } from './db/configService.js';
import RoleGuard from './guards/RoleGuard.jsx';
import { isEnabled } from './utils/featureFlags.js';
import AppLayout from './components/layout/AppLayout.jsx';
import SetupWizard from './pages/setup/SetupWizard.jsx';
import Login from './pages/auth/Login.jsx';
import Dashboard from './pages/dashboard/Dashboard.jsx';
import Students from './pages/students/Students.jsx';
import ImportStudents from './pages/students/ImportStudents.jsx';
import Attendance from './pages/attendance/Attendance.jsx';
import Exams from './pages/exams/Exams.jsx';
import Fees from './pages/fees/Fees.jsx';
import { Staff, Payroll, Expenses, Settings } from './pages/staff/Staff.jsx';
import UserManagement from './pages/users/UserManagement.jsx';
import Subjects from './pages/settings/Subjects.jsx';
import ProjectWork from './pages/projectWork/ProjectWork.jsx';
import { LoadingScreen } from './components/common/Badge.jsx';
import './index.css';

// ─── Feature-gated route ────────────────────────────────────────────────
// Renders children only when the feature flag is on; otherwise redirects to
// the dashboard (never a blank page). Placed outside RoleGuard so a disabled
// feature redirects before any role/access check runs.
const FeatureRoute = ({ feature, children }) => {
  if (!isEnabled(feature)) return <Navigate to="/" replace />;
  return children;
};

// ─── Inner app (needs auth context) ──────────────────────────────────────────
const AppRoutes = ({ setupDone, schoolName, onSetupComplete }) => {
  const { user, loading } = useAuth();

  if (loading) return <LoadingScreen message="Starting up..." />;
  if (!setupDone) return <SetupWizard onComplete={onSetupComplete} />;
  if (!user) return <Login schoolName={schoolName} />;

  return (
    <Routes>
      <Route path="/" element={<AppLayout schoolName={schoolName} />}>
        <Route index element={<Dashboard />} />

        {/* Academic — Admin + Teacher */}
        <Route path="students" element={<FeatureRoute feature="students"><RoleGuard roles={['admin','teacher']}><Students /></RoleGuard></FeatureRoute>} />
        <Route path="students/import" element={<FeatureRoute feature="studentImport"><RoleGuard roles={['admin']}><ImportStudents /></RoleGuard></FeatureRoute>} />
        <Route path="attendance" element={<FeatureRoute feature="attendance"><RoleGuard roles={['admin','teacher']}><Attendance /></RoleGuard></FeatureRoute>} />
        <Route path="exams" element={<FeatureRoute feature="exams"><RoleGuard roles={['admin','teacher']}><Exams /></RoleGuard></FeatureRoute>} />

        {/* Finance — Admin + Bursar (hidden by default) */}
        <Route path="fees" element={<FeatureRoute feature="fees"><RoleGuard roles={['admin','bursar']}><Fees /></RoleGuard></FeatureRoute>} />
        <Route path="payroll" element={<FeatureRoute feature="payroll"><RoleGuard roles={['admin','bursar']}><Payroll /></RoleGuard></FeatureRoute>} />
        <Route path="expenses" element={<FeatureRoute feature="expenses"><RoleGuard roles={['admin','bursar']}><Expenses /></RoleGuard></FeatureRoute>} />

        {/* Admin only */}
        <Route path="staff" element={<FeatureRoute feature="staff"><RoleGuard roles={['admin']}><Staff /></RoleGuard></FeatureRoute>} />
        <Route path="users" element={<FeatureRoute feature="userAccounts"><RoleGuard roles={['admin']}><UserManagement /></RoleGuard></FeatureRoute>} />
        <Route path="settings" element={<FeatureRoute feature="settings"><RoleGuard roles={['admin']}><Settings /></RoleGuard></FeatureRoute>} />
        <Route path="subjects" element={<FeatureRoute feature="subjects"><RoleGuard roles={['admin']}><Subjects /></RoleGuard></FeatureRoute>} />
        <Route path="project-work" element={<FeatureRoute feature="projectWork"><RoleGuard roles={['admin','teacher']}><ProjectWork /></RoleGuard></FeatureRoute>} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
};

// ─── Root App ─────────────────────────────────────────────────────────────────
const App = () => {
  const [setupDone, setSetupDone] = useState(false);
  const [schoolName, setSchoolName] = useState('');
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        // isSetupComplete reads config/setup (the first-admin guard flag).
        // Firestore rules allow this read without authentication so the app can
        // detect setup status on every cold boot before any user is signed in.
        const done = await isSetupComplete();
        setSetupDone(done);
        if (done) {
          const cfg = await getConfig();
          setSchoolName(cfg?.schoolName || '');
        }
      } catch (e) {
        // Most likely cause: Firestore rules not yet published, or no network on
        // first run before any data is cached locally.
        // Log the full error so it's visible in DevTools / Electron console.
        console.error('[App init] Firestore read failed:', e.code, e.message);
        // Treat as "setup not done" so the wizard is shown and the user can
        // proceed rather than being stuck on the loading screen.
        setSetupDone(false);
      } finally {
        setInitializing(false);
      }
    };
    init();
  }, []);

  const handleSetupComplete = async (schoolId) => {
    const cfg = await getConfig(schoolId);
    setSchoolName(cfg?.schoolName || '');
    setSetupDone(true);
  };

  if (initializing) {
    return (
      <div className="min-h-screen bg-navy-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-navy-600 border-t-amber-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-navy-400 text-sm">Loading Alama…</p>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes
          setupDone={setupDone}
          schoolName={schoolName}
          onSetupComplete={handleSetupComplete}
        />
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
