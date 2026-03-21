import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Pill,
  LayoutDashboard,
  Package,
  ClipboardList,
  Bell,
  TrendingUp,
  Map,
  Calculator,
  FileText,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import type { UserRole } from '../../types';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  roles?: UserRole[];
}

const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { to: '/inventory', label: 'Inventory', icon: <Package size={18} /> },
  {
    to: '/dispense',
    label: 'Dispense',
    icon: <ClipboardList size={18} />,
    roles: ['pharmacist', 'admin'],
  },
  { to: '/alerts', label: 'Alerts', icon: <Bell size={18} /> },
  {
    to: '/forecast',
    label: 'Forecast',
    icon: <TrendingUp size={18} />,
    roles: ['manager', 'admin'],
  },
  { to: '/heatmap', label: 'Heatmap', icon: <Map size={18} /> },
  {
    to: '/waste',
    label: 'Waste Calc',
    icon: <Calculator size={18} />,
    roles: ['manager', 'admin'],
  },
  {
    to: '/report',
    label: 'Reports',
    icon: <FileText size={18} />,
    roles: ['admin'],
  },
];

const roleBadgeColors: Record<UserRole, string> = {
  pharmacist: 'bg-blue-500',
  manager: 'bg-amber-500',
  admin: 'bg-purple-500',
};

export default function Sidebar() {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const visibleItems = navItems.filter(
    (item) => !item.roles || (profile && item.roles.includes(profile.role))
  );

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-6 border-b border-slate-700">
        <div className="bg-emerald-500 rounded-lg p-1.5">
          <Pill size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-white font-bold text-sm leading-tight">PharmaGuard</h1>
          <p className="text-slate-400 text-xs">Gujarat</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-emerald-600 text-white font-medium'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* User info */}
      {profile && (
        <div className="px-4 py-4 border-t border-slate-700">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-white text-sm font-semibold">
              {profile.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-white text-sm font-medium truncate">{profile.name}</p>
              <span
                className={`inline-block text-xs text-white px-1.5 py-0.5 rounded ${roleBadgeColors[profile.role]}`}
              >
                {profile.role}
              </span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 text-slate-300 hover:bg-slate-700 hover:text-white rounded-lg text-sm transition-colors"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className="fixed top-4 left-4 z-50 md:hidden bg-slate-800 text-white p-2 rounded-lg"
        onClick={() => setOpen(!open)}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-56 bg-slate-800 transform transition-transform md:hidden ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 bg-slate-800 min-h-screen flex-shrink-0">
        {sidebarContent}
      </aside>
    </>
  );
}
