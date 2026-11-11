import { useState, useEffect } from 'react';
import { GraduationCap, Users, Wallet, CalendarCheck, TrendingUp, ArrowRight, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { getStudentCount } from '../../db/studentService.js';
import { getStaffCount }   from '../../db/staffService.js';
import { getTermFeeCollection } from '../../db/feeService.js';
import { getTodayStats }   from '../../db/attendanceService.js';
import { getConfig }       from '../../db/configService.js';
import { isEnabled, financeEnabled } from '../../utils/featureFlags.js';
import { StatCard, Card, LoadingScreen } from '../../components/common/Badge.jsx';
import { formatCurrency, getCurrentDateISO, formatDate } from '../../utils/grading.js';

const QuickLink = ({ icon: Icon, label, path, color }) => {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(path)}
      className={`flex items-center gap-3 p-4 rounded-xl border-2 border-transparent
        hover:border-navy-200 hover:bg-navy-50 transition-all text-left group`}
    >
      <div className={`w-9 h-9 rounded-lg ${color} flex items-center justify-center`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-slate-800">{label}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-navy-600 transition-colors" />
    </button>
  );
};

const Dashboard = () => {
  const { user, hasRole, activeSchoolId } = useAuth();
  const [stats, setStats] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const cfg = await getConfig(activeSchoolId);
        setConfig(cfg);
        const [students, staff, feeTotal, attendance] = await Promise.all([
          getStudentCount(activeSchoolId),
          isEnabled('staff') ? getStaffCount() : Promise.resolve(null),
          isEnabled('fees')
            ? getTermFeeCollection(cfg?.academicYear, cfg?.currentTerm)
            : Promise.resolve(null),
          isEnabled('attendance')
            ? getTodayStats(getCurrentDateISO())
            : Promise.resolve(null),
        ]);
        setStats({ students, staff, feeTotal, attendance });
      } catch (e) {
        console.error('Dashboard load error:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [activeSchoolId]);

  if (loading) return <LoadingScreen message="Loading dashboard..." />;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Greeting banner */}
      <div className="bg-gradient-to-r from-navy-900 to-navy-700 rounded-2xl p-6 text-white relative overflow-hidden">
        <div className="absolute right-0 top-0 w-48 h-48 rounded-full bg-white/5 -translate-y-1/2 translate-x-1/4" />
        <div className="relative">
          <p className="text-navy-200 text-sm mb-1">{greeting},</p>
          <h1 className="font-display text-2xl font-bold mb-1">{user?.fullName}</h1>
          {config && (
            <p className="text-navy-300 text-sm">
              {config.schoolName} · {config.currentTerm}, {config.academicYear}
            </p>
          )}
        </div>
      </div>

      {user?.role === 'bursar' && !financeEnabled && (
        <Card className="bg-amber-50 border border-amber-200 rounded-xl">
          <div className="flex items-start gap-3 p-4">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">
                No modules are enabled for your role yet
              </p>
              <p className="text-xs text-amber-700 mt-1">
                Contact an administrator to enable finance modules (fees,
                payroll, expenses) for bursar accounts.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {hasRole('admin', 'teacher') && (
          <StatCard
            title="Total Students"
            value={stats?.students ?? '—'}
            subtitle="Active enrollments"
            icon={GraduationCap}
            color="navy"
          />
        )}
        {hasRole('admin') && isEnabled('staff') && (
          <StatCard
            title="Staff Members"
            value={stats?.staff ?? '—'}
            subtitle="Active staff"
            icon={Users}
            color="blue"
          />
        )}
        {hasRole('admin', 'bursar') && isEnabled('fees') && stats?.feeTotal !== null && (
          <StatCard
            title="Fee Collection"
            value={formatCurrency(stats?.feeTotal)}
            subtitle={`${config?.currentTerm} ${config?.academicYear}`}
            icon={Wallet}
            color="emerald"
          />
        )}
        {hasRole('admin', 'teacher') && isEnabled('attendance') && (
          <StatCard
            title="Today's Attendance"
            value={stats?.attendance?.present ?? '—'}
            subtitle={`${stats?.attendance?.absent ?? 0} absent · ${stats?.attendance?.late ?? 0} late`}
            icon={CalendarCheck}
            color="amber"
          />
        )}
      </div>

      {/* Quick actions + info row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Quick actions */}
        <Card className="lg:col-span-2">
          <h3 className="font-display font-semibold text-slate-800 mb-4">Quick Actions</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {hasRole('admin', 'teacher') && (
              <>
                <QuickLink icon={GraduationCap} label="Manage Students"  path="/students"  color="bg-navy-800"    />
                {hasRole('admin', 'teacher') && isEnabled('attendance') && (
                  <QuickLink icon={CalendarCheck} label="Mark Attendance"  path="/attendance" color="bg-amber-500"  />
                )}
              </>
            )}
            {hasRole('admin', 'teacher') && (
              <QuickLink icon={TrendingUp} label="Exam Results" path="/exams" color="bg-blue-600" />
            )}
            {hasRole('admin', 'bursar') && isEnabled('fees') && (
              <QuickLink icon={Wallet} label="Record Fee Payment" path="/fees" color="bg-emerald-600" />
            )}
            {hasRole('admin') && isEnabled('staff') && (
              <QuickLink icon={Users} label="Manage Staff" path="/staff" color="bg-purple-600" />
            )}
          </div>
        </Card>

        {/* School info */}
        <Card>
          <h3 className="font-display font-semibold text-slate-800 mb-4">School Info</h3>
          {config ? (
            <div className="space-y-3">
              {[
                { label: 'School',        value: config.schoolName    },
                { label: 'Academic Year', value: config.academicYear  },
                { label: 'Current Term',  value: config.currentTerm   },
                { label: 'Address',       value: config.schoolAddress || '—' },
              ].map((row) => (
                <div key={row.label} className="flex flex-col gap-0.5">
                  <span className="text-xs text-slate-400 uppercase tracking-wide">{row.label}</span>
                  <span className="text-sm font-medium text-slate-800">{row.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No school profile found.</p>
          )}
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
