import { useEffect, useState } from 'react';
import { DatabaseZap, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { seedDatabase, checkAlreadySeeded } from '../../utils/seedData';

export default function DashboardPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  // ── Seed state ──────────────────────────────────────────────────────────
  const [seeded, setSeeded]           = useState<boolean | null>(null); // null = checking
  const [seeding, setSeeding]         = useState(false);
  const [progress, setProgress]       = useState('');
  const [seedError, setSeedError]     = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    checkAlreadySeeded()
      .then(setSeeded)
      .catch(() => setSeeded(false));
  }, [isAdmin]);

  const handleSeed = async () => {
    setShowConfirm(false);
    setSeeding(true);
    setSeedError('');
    setProgress('');
    try {
      await seedDatabase((msg) => setProgress(msg));
      setSeeded(true);
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : 'Seed failed.');
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">
        Welcome back, {profile?.name ?? 'User'}
      </h1>
      <p className="text-slate-500 mb-6">Here's your pharmacy overview</p>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Drugs',      value: '—', color: 'bg-blue-50 text-blue-700'    },
          { label: 'Low Stock',        value: '—', color: 'bg-amber-50 text-amber-700'  },
          { label: 'Near Expiry',      value: '—', color: 'bg-orange-50 text-orange-700'},
          { label: 'Dispensed Today',  value: '—', color: 'bg-emerald-50 text-emerald-700'},
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <p className="text-slate-500 text-sm mb-1">{card.label}</p>
            <p className={`text-3xl font-bold ${card.color} px-2 py-0.5 rounded inline-block`}>
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {/* ── Seed panel — admin only ── */}
      {isAdmin && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 max-w-lg">
          <div className="flex items-start gap-3 mb-4">
            <div className="bg-violet-100 rounded-lg p-2 mt-0.5">
              <DatabaseZap size={18} className="text-violet-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-800">Database Seed</h2>
              <p className="text-slate-500 text-sm mt-0.5">
                Populates Firestore with 20 Gujarat EDL drugs, 3–5 batches each,
                6 months of seasonally-weighted dispense history, and 3 test users.
              </p>
            </div>
          </div>

          {/* Status indicators */}
          {seeded === null && isAdmin && (
            <div className="flex items-center gap-2 text-slate-400 text-sm mb-4">
              <Loader2 size={14} className="animate-spin" />
              Checking seed status…
            </div>
          )}

          {seeded === true && !seeding && (
            <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 text-sm mb-4">
              <CheckCircle2 size={16} />
              Database is already seeded. Data is ready.
            </div>
          )}

          {seedError && (
            <div className="flex items-start gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm mb-4">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              {seedError}
            </div>
          )}

          {seeding && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 mb-4">
              <div className="flex items-center gap-2 text-slate-600 text-sm font-medium mb-1">
                <Loader2 size={14} className="animate-spin" />
                Seeding in progress…
              </div>
              <p className="text-slate-500 text-xs">{progress}</p>
            </div>
          )}

          {/* Seed button */}
          {seeded !== true && !seeding && (
            <button
              onClick={() => setShowConfirm(true)}
              disabled={seeded === null}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
            >
              <DatabaseZap size={16} />
              Seed Database
            </button>
          )}
        </div>
      )}

      {/* ── Confirmation dialog ── */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <div className="flex items-center gap-3 mb-3">
              <div className="bg-amber-100 rounded-lg p-2">
                <AlertTriangle size={20} className="text-amber-600" />
              </div>
              <h3 className="font-semibold text-slate-800">Confirm Seed</h3>
            </div>
            <p className="text-slate-600 text-sm mb-5 leading-relaxed">
              This will write <strong>20 drugs</strong>, up to <strong>100 batches</strong>,
              and approximately <strong>360+ dispense records</strong> to Firestore.
              <br /><br />
              This action cannot be undone from the UI. Proceed only once.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSeed}
                className="flex-1 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                Yes, Seed Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
