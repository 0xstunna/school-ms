import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { ShieldOff } from 'lucide-react';

// Wrap a route element: <RoleGuard roles={['admin']}><Page /></RoleGuard>
// Roles are resolved relative to the user's ACTIVE school (via
// AuthContext.activeRole / hasRole), not a single global role.
const RoleGuard = ({ roles, children }) => {
  const { user, loading, hasRole, hasNoActiveSchool } = useAuth();

  if (loading) return null; // Parent (AppRoutes) shows a loading screen.

  if (!user) return <Navigate to="/login" replace />;

  // A user with no active school membership cannot access school-scoped pages.
  if (hasNoActiveSchool()) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 text-center animate-fade-in">
        <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center mb-4">
          <ShieldOff className="w-8 h-8 text-amber-500" />
        </div>
        <h2 className="font-display text-xl font-700 text-slate-800 mb-2">No Active School</h2>
        <p className="text-slate-500 text-sm max-w-xs">
          Your account is not linked to any active school. Contact your
          administrator to be assigned to a school.
        </p>
      </div>
    );
  }

  if (!hasRole(...roles)) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 text-center animate-fade-in">
        <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center mb-4">
          <ShieldOff className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="font-display text-xl font-700 text-slate-800 mb-2">Access Denied</h2>
        <p className="text-slate-500 text-sm max-w-xs">
          You don't have permission to view this page for your active school.
          Contact your administrator if you think this is a mistake.
        </p>
      </div>
    );
  }

  return children;
};

// HOC version for programmatic use
export const withRole = (Component, roles) => {
  return (props) => (
    <RoleGuard roles={roles}>
      <Component {...props} />
    </RoleGuard>
  );
};

export default RoleGuard;
