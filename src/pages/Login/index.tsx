import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldPlus, Eye, EyeOff, Loader2, ChevronRight } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import type { UserRole } from '../../types';

// ── Firebase error → human-readable message ───────────────────────────────────
function authErrorMessage(code: string): string {
  switch (code) {
    case 'auth/user-not-found':
    case 'auth/invalid-credential':
    case 'auth/invalid-email':
      return 'No account found with that email address.';
    case 'auth/wrong-password':
      return 'Incorrect password. Please try again.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your internet connection.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

// ── Demo accounts ─────────────────────────────────────────────────────────────
const DEMO_ACCOUNTS = [
  {
    email:    'mehta@hospital.guj.in',
    name:     'Dr. Mehta',
    role:     'admin'       as UserRole,
    badge:    'bg-purple-100 text-purple-700',
    dot:      'bg-purple-500',
  },
  {
    email:    'shah@hospital.guj.in',
    name:     'Dr. Shah',
    role:     'manager'     as UserRole,
    badge:    'bg-amber-100 text-amber-700',
    dot:      'bg-amber-500',
  },
  {
    email:    'patel@hospital.guj.in',
    name:     'Dr. Patel',
    role:     'pharmacist'  as UserRole,
    badge:    'bg-blue-100 text-blue-700',
    dot:      'bg-blue-500',
  },
] as const;

const PASSWORD_DEMO = 'password123';

// ── Field-level validation ────────────────────────────────────────────────────
function validateEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? '' : 'Enter a valid email address.';
}
function validatePassword(v: string) {
  return v.length >= 6 ? '' : 'Password must be at least 6 characters.';
}
function validateName(v: string) {
  return v.trim().length >= 2 ? '' : 'Name must be at least 2 characters.';
}

// ─────────────────────────────────────────────────────────────────────────────
export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode]           = useState<'signin' | 'register'>('signin');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [name, setName]           = useState('');
  const [role, setRole]           = useState<UserRole>('pharmacist');
  const [showPw, setShowPw]       = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');

  // Field-level errors — shown after first submit attempt
  const [touched, setTouched]     = useState(false);

  const emailErr    = touched ? validateEmail(email)    : '';
  const passwordErr = touched ? validatePassword(password) : '';
  const nameErr     = touched && mode === 'register' ? validateName(name) : '';

  const hasFieldErrors = Boolean(emailErr || passwordErr || (mode === 'register' && nameErr));

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setServerError('');

    if (hasFieldErrors) return;

    setSubmitting(true);
    try {
      if (mode === 'signin') {
        await signIn(email, password);
      } else {
        await signUp(email, password, name.trim(), role);
      }
      navigate('/');
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      setServerError(authErrorMessage(code));
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemo = (account: (typeof DEMO_ACCOUNTS)[number]) => {
    setEmail(account.email);
    setPassword(PASSWORD_DEMO);
    setMode('signin');
    setServerError('');
    setTouched(false);
  };

  const switchMode = (next: typeof mode) => {
    setMode(next);
    setServerError('');
    setTouched(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 45%, #0c4a6e 100%)',
      }}
    >
      {/* Decorative blur orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* ── Card ── */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">

          {/* Header band */}
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-8 pt-8 pb-7">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-emerald-500 rounded-xl p-2.5 shadow-lg shadow-emerald-500/30">
                <ShieldPlus size={24} className="text-white" />
              </div>
              <div>
                <h1 className="text-white font-bold text-lg leading-tight">PharmaGuard Gujarat</h1>
                <p className="text-slate-400 text-xs mt-0.5">Pharmacy Management System</p>
              </div>
            </div>

            {/* Mode toggle */}
            <div className="flex bg-slate-700/60 rounded-lg p-1 gap-1">
              {(['signin', 'register'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchMode(m)}
                  className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all duration-150 ${
                    mode === m
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m === 'signin' ? 'Sign In' : 'Create Account'}
                </button>
              ))}
            </div>
          </div>

          {/* Form body */}
          <form onSubmit={handleSubmit} noValidate className="px-8 py-6 space-y-4">

            {/* Server error */}
            {serverError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg flex items-start gap-2">
                <span className="shrink-0 mt-0.5">⚠</span>
                {serverError}
              </div>
            )}

            {/* Name (register only) */}
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Dr. Firstname Lastname"
                  className={`w-full px-4 py-2.5 border rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-colors ${
                    nameErr ? 'border-red-400 bg-red-50' : 'border-slate-200'
                  }`}
                />
                {nameErr && <p className="mt-1 text-xs text-red-600">{nameErr}</p>}
              </div>
            )}

            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@hospital.guj.in"
                autoComplete="email"
                className={`w-full px-4 py-2.5 border rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-colors ${
                  emailErr ? 'border-red-400 bg-red-50' : 'border-slate-200'
                }`}
              />
              {emailErr && <p className="mt-1 text-xs text-red-600">{emailErr}</p>}
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? 'Minimum 6 characters' : '••••••••'}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  className={`w-full px-4 py-2.5 pr-10 border rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-colors ${
                    passwordErr ? 'border-red-400 bg-red-50' : 'border-slate-200'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {passwordErr && <p className="mt-1 text-xs text-red-600">{passwordErr}</p>}
            </div>

            {/* Role (register only) */}
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Role <span className="text-slate-400 normal-case font-normal">(demo only)</span>
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-colors"
                >
                  <option value="pharmacist">Pharmacist</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition-colors shadow-sm shadow-emerald-600/30 mt-2"
            >
              {submitting
                ? <><Loader2 size={16} className="animate-spin" /> {mode === 'signin' ? 'Signing in…' : 'Creating account…'}</>
                : mode === 'signin' ? 'Sign In' : 'Create Account'
              }
            </button>
          </form>

          {/* ── Demo accounts ── */}
          <div className="px-8 pb-8">
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Demo Accounts
                </p>
                <span className="text-xs text-slate-400">Click to auto-fill</span>
              </div>

              {DEMO_ACCOUNTS.map((account, i) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => fillDemo(account)}
                  className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left transition-colors group ${
                    i < DEMO_ACCOUNTS.length - 1 ? 'border-b border-slate-100' : ''
                  }`}
                >
                  {/* Avatar */}
                  <div className={`w-7 h-7 rounded-full ${account.dot} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                    {account.name.split(' ').pop()?.charAt(0)}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 leading-tight">{account.name}</p>
                    <p className="text-xs text-slate-400 truncate">{account.email}</p>
                  </div>

                  {/* Role badge */}
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${account.badge} shrink-0`}>
                    {account.role}
                  </span>

                  <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors shrink-0" />
                </button>
              ))}

              {/* Password hint */}
              <div className="bg-slate-50 border-t border-slate-200 px-4 py-2 flex items-center gap-1.5">
                <span className="text-xs text-slate-400">Password for all accounts:</span>
                <code className="text-xs font-mono bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">
                  password123
                </code>
              </div>
            </div>
          </div>
        </div>

        {/* Footer credit */}
        <p className="text-center text-slate-500 text-xs mt-4">
          Void Pointers · PharmaGuard Gujarat · 2026
        </p>
      </div>
    </div>
  );
}
