import { Navigate, useLocation } from 'react-router-dom';
import { Loader2, ShieldX } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import type { UserRole } from '../../types';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

export default function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  // ── 1. Auth state still resolving ────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 gap-3">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col items-center gap-3">
          <Loader2 size={28} className="animate-spin text-emerald-600" />
          <p className="text-slate-500 text-sm font-medium">Loading PharmaGuard…</p>
        </div>
      </div>
    );
  }

  // ── 2. Not authenticated → go to login, preserve intended destination ────
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // ── 3. Role check ─────────────────────────────────────────────────────────
  // Profile may still be null for a brief moment right after sign-in while
  // onAuthStateChanged writes the Firestore doc; wait rather than deny.
  if (allowedRoles) {
    if (!profile) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 gap-3">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col items-center gap-3">
            <Loader2 size={28} className="animate-spin text-emerald-600" />
            <p className="text-slate-500 text-sm font-medium">Loading profile…</p>
          </div>
        </div>
      );
    }

    if (!allowedRoles.includes(profile.role)) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6">
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 max-w-sm w-full text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-red-100 mb-4">
              <ShieldX size={28} className="text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">Access Denied</h2>
            <p className="text-slate-500 text-sm mb-1">
              Your role <span className="font-semibold text-slate-700">({profile.role})</span> does
              not have permission to view this page.
            </p>
            <p className="text-slate-400 text-xs mb-6">
              Required: {allowedRoles.join(' or ')}
            </p>
            <Navigate to="/" replace />
          </div>
        </div>
      );
    }
  }

  // ── 4. All checks passed ──────────────────────────────────────────────────
  return <>{children}</>;
}
