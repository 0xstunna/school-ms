import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, GraduationCap, ClipboardList, BookOpen,
  Wallet, Banknote, Receipt, Users, ShieldCheck, Settings,
  ChevronRight, LogOut, School, BookMarked, Upload,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { ROLE_LABELS } from '../../utils/constants.js';
import { getVisibleNavItems } from '../../utils/featureFlags.js';

const ICONS = {
  LayoutDashboard, GraduationCap, ClipboardList, BookOpen,
  Wallet, Banknote, Receipt, Users, ShieldCheck, Settings, BookMarked, Upload,
};

const Sidebar = ({ onLogout }) => {
  const { user } = useAuth();
  const location = useLocation();

  const visibleItems = getVisibleNavItems(user?.role);

  return (
    <aside className="w-60 min-h-screen bg-navy-950 flex flex-col select-none">
      {/* Logo / School branding */}
      <div className="px-5 py-5 border-b border-navy-800/60">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center flex-shrink-0">
            <School className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="font-display font-bold text-white text-sm leading-tight truncate">
              School MS
            </p>
            <p className="text-navy-300 text-xs truncate capitalize">{ROLE_LABELS[user?.role]}</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleItems.map((item, idx) => {
          if (item.type === 'divider') {
            return (
              <div key={idx} className="pt-4 pb-1 first:pt-2">
                <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-navy-500">
                  {item.label}
                </p>
              </div>
            );
          }

          const Icon = ICONS[item.icon];
          const isActive = item.path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.path);

          return (
            <NavLink
              key={item.id}
              to={item.path}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
                transition-all duration-150 group
                ${isActive
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'text-navy-300 hover:bg-navy-800 hover:text-white'
                }
              `}
            >
              {Icon && (
                <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-white' : 'text-navy-400 group-hover:text-white'}`} />
              )}
              <span className="flex-1 truncate">{item.label}</span>
              {isActive && <ChevronRight className="w-3 h-3 text-white/70 flex-shrink-0" />}
            </NavLink>
          );
        })}
      </nav>

      {/* User info + logout */}
      <div className="px-3 py-4 border-t border-navy-800/60">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-navy-800/50 mb-2">
          <div className="w-7 h-7 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
            <span className="text-amber-400 text-xs font-bold">
              {user?.fullName?.[0]?.toUpperCase() || '?'}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-white text-xs font-medium truncate">{user?.fullName}</p>
            <p className="text-navy-400 text-[10px] truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-navy-400 hover:text-red-400 hover:bg-red-400/10 transition-all text-sm"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
