import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection, onSnapshot, getDocs, query, where, orderBy, limit, Timestamp,
} from 'firebase/firestore';
import {
  format, formatDistanceToNow, startOfToday, subDays, isSameDay,
} from 'date-fns';
import {
  Package, AlertTriangle, Clock, Activity, Bell,
  CheckCircle2, ChevronRight, DatabaseZap, Loader2, ShieldAlert,
} from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import { db } from '../../config/firebase';
import { useAuth } from '../../hooks/useAuth';
import { seedDatabase, checkAlreadySeeded } from '../../utils/seedData';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend);

// ─── Types ────────────────────────────────────────────────────────────────────

interface Drug {
  id: string;
  name: string;
  category: string;
  currentStock: number;
  reorderLevel: number;
  unit: string;
}

interface Batch {
  id: string;
  quantity: number;
  expiryDate: string;
}

interface DispenseLog {
  id: string;
  drugName: string;
  quantity: number;
  dispensedBy?: string;
  timestamp: Timestamp | null;
}

interface AlertDoc {
  id: string;
  type: string;
  drugName?: string;
  message?: string;
  description?: string;
  read: boolean;
  createdAt?: Timestamp | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tsToDate(ts: Timestamp | null | undefined): Date | null {
  if (!ts || !(ts instanceof Timestamp)) return null;
  return ts.toDate();
}

function relativeTime(ts: Timestamp | null | undefined): string {
  const d = tsToDate(ts);
  if (!d) return '—';
  return formatDistanceToNow(d, { addSuffix: true });
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub?: string;
  iconBg: string;
  leftBorder: string;
  loading: boolean;
  onClick?: () => void;
}

function StatCard({ icon, label, value, sub, iconBg, leftBorder, loading, onClick }: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={`bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 flex items-start gap-4 border-l-4 ${leftBorder} ${onClick ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all' : ''}`}
    >
      <div className={`${iconBg} rounded-lg p-2.5 shrink-0`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
          {label}
        </p>
        {loading ? (
          <div className="h-8 w-14 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
        ) : (
          <p className="text-3xl font-bold text-slate-800 dark:text-slate-100 leading-none tabular-nums">
            {value.toLocaleString('en-IN')}
          </p>
        )}
        {sub && !loading && (
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{sub}</p>
        )}
      </div>
      {onClick && (
        <ChevronRight size={15} className="text-slate-300 dark:text-slate-600 shrink-0 mt-1" />
      )}
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isAdmin = profile?.role === 'admin';

  // ── Data state ────────────────────────────────────────────────────────────
  const [drugs, setDrugs]               = useState<Drug[]>([]);
  const [drugsLoading, setDrugsLoading] = useState(true);

  const [nearExpiryCount, setNearExpiryCount]     = useState(0);
  const [batchesLoading, setBatchesLoading]       = useState(true);

  const [weekLogs, setWeekLogs]         = useState<DispenseLog[]>([]);
  const [recentLogs, setRecentLogs]     = useState<DispenseLog[]>([]);
  const [logsLoading, setLogsLoading]   = useState(true);

  const [alerts, setAlerts]             = useState<AlertDoc[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);

  // Seed state (admin only)
  const [seeded, setSeeded]           = useState<boolean | null>(null);
  const [seeding, setSeeding]         = useState(false);
  const [progress, setProgress]       = useState('');
  const [seedError, setSeedError]     = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  // ── Live drugs listener ───────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'drugs'), snap => {
      setDrugs(snap.docs.map(d => ({ id: d.id, ...d.data() } as Drug)));
      setDrugsLoading(false);
    });
    return unsub;
  }, []);

  // ── Batch fetch for near-expiry count ────────────────────────────────────
  useEffect(() => {
    if (!drugs.length) { setBatchesLoading(false); return; }
    setBatchesLoading(true);
    const today = new Date();
    const in30  = new Date(today); in30.setDate(today.getDate() + 30);

    Promise.all(
      drugs.map(d =>
        getDocs(collection(db, 'drugs', d.id, 'batches')).then(snap =>
          snap.docs.map(b => ({ id: b.id, ...b.data() } as Batch))
        )
      )
    ).then(all => {
      const near = all.flat().filter(b => {
        if (!b.quantity || b.quantity <= 0) return false;
        const exp = new Date(b.expiryDate);
        return exp >= today && exp <= in30;
      }).length;
      setNearExpiryCount(near);
      setBatchesLoading(false);
    }).catch(() => setBatchesLoading(false));
  }, [drugs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dispense logs (last 7 days + recent 10) ───────────────────────────────
  useEffect(() => {
    const sevenAgoTs = Timestamp.fromDate(subDays(new Date(), 7));
    const logsQ = query(
      collection(db, 'dispenseLogs'),
      where('timestamp', '>=', sevenAgoTs),
      orderBy('timestamp', 'desc'),
      limit(200),
    );
    getDocs(logsQ).then(snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as DispenseLog));
      setWeekLogs(all);
      setRecentLogs(all.slice(0, 10));
      setLogsLoading(false);
    }).catch(() => setLogsLoading(false));
  }, []);

  // ── Live alerts listener ──────────────────────────────────────────────────
  useEffect(() => {
    const alertsQ = query(
      collection(db, 'alerts'),
      where('read', '==', false),
      limit(20),
    );
    const unsub = onSnapshot(
      alertsQ,
      snap => {
        setAlerts(snap.docs.map(d => ({ id: d.id, ...d.data() } as AlertDoc)));
        setAlertsLoading(false);
      },
      () => setAlertsLoading(false)
    );
    return unsub;
  }, []);

  // ── Admin: check seed status ──────────────────────────────────────────────
  useEffect(() => {
    if (!isAdmin) return;
    checkAlreadySeeded().then(setSeeded).catch(() => setSeeded(false));
  }, [isAdmin]);

  const handleSeed = async () => {
    setShowConfirm(false);
    setSeeding(true);
    setSeedError('');
    setProgress('');
    try {
      await seedDatabase((msg: string) => setProgress(msg));
      setSeeded(true);
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : 'Seed failed.');
    } finally {
      setSeeding(false);
    }
  };

  // ── Derived: stock buckets ────────────────────────────────────────────────
  const lowStockDrugs   = useMemo(() => drugs.filter(d => d.currentStock > 0 && d.currentStock <= d.reorderLevel), [drugs]);
  const outOfStockDrugs = useMemo(() => drugs.filter(d => d.currentStock === 0), [drugs]);
  const inStockDrugs    = useMemo(() => drugs.filter(d => d.currentStock > d.reorderLevel), [drugs]);

  // ── Derived: today's stats ────────────────────────────────────────────────
  const todayLogs = useMemo(() => weekLogs.filter(l => {
    const d = tsToDate(l.timestamp);
    return d ? isSameDay(d, new Date()) : false;
  }), [weekLogs]);

  const dispensedToday = useMemo(
    () => todayLogs.reduce((s, l) => s + (l.quantity ?? 0), 0),
    [todayLogs]
  );

  // ── Bar chart: dispenses per day last 7 days ──────────────────────────────
  const barData = useMemo(() => {
    const days   = Array.from({ length: 7 }, (_, i) => subDays(new Date(), 6 - i));
    const labels = days.map(d => format(d, 'EEE d'));
    const data   = days.map(day =>
      weekLogs
        .filter(l => { const ld = tsToDate(l.timestamp); return ld ? isSameDay(ld, day) : false; })
        .reduce((s, l) => s + (l.quantity ?? 0), 0)
    );
    return {
      labels,
      datasets: [{
        label: 'Units Dispensed',
        data,
        backgroundColor: 'rgba(16, 185, 129, 0.7)',
        borderColor: 'rgba(16, 185, 129, 1)',
        borderWidth: 1.5,
        borderRadius: 6,
      }],
    };
  }, [weekLogs]);

  const barOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx: { raw: unknown }) => ` ${ctx.raw} units` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#94a3b8' }, border: { display: false } },
      y: { grid: { color: 'rgba(148,163,184,0.12)' }, ticks: { color: '#94a3b8' }, border: { display: false }, beginAtZero: true },
    },
  }), []);

  // ── Doughnut chart: stock status distribution ─────────────────────────────
  const doughnutData = useMemo(() => ({
    labels: ['In Stock', 'Low Stock', 'Out of Stock'],
    datasets: [{
      data: [inStockDrugs.length, lowStockDrugs.length, outOfStockDrugs.length],
      backgroundColor: ['rgba(16,185,129,0.8)', 'rgba(245,158,11,0.8)', 'rgba(239,68,68,0.8)'],
      borderColor:     ['rgba(16,185,129,1)',   'rgba(245,158,11,1)',   'rgba(239,68,68,1)'  ],
      borderWidth: 2,
      hoverOffset: 4,
    }],
  }), [inStockDrugs.length, lowStockDrugs.length, outOfStockDrugs.length]);

  const doughnutOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    cutout: '68%',
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          color: '#64748b',
          padding: 14,
          font: { size: 11 },
          usePointStyle: true,
          pointStyleWidth: 7,
        },
      },
      tooltip: {
        callbacks: {
          label: (ctx: { raw: unknown; label: string }) => ` ${ctx.label}: ${ctx.raw} drugs`,
        },
      },
    },
  }), []);

  // ── Role badge ────────────────────────────────────────────────────────────
  const roleBadgeCls: Record<string, string> = {
    admin:      'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
    manager:    'bg-amber-100  text-amber-700  dark:bg-amber-900/40  dark:text-amber-300',
    pharmacist: 'bg-blue-100   text-blue-700   dark:bg-blue-900/40   dark:text-blue-300',
  };

  const weekTotal = weekLogs.reduce((s, l) => s + (l.quantity ?? 0), 0);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="p-6 min-h-full bg-slate-50 dark:bg-slate-900">

      {/* ── Welcome header ── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
            Welcome back, {profile?.name ?? 'User'}
          </h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {profile?.role && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${roleBadgeCls[profile.role] ?? ''}`}>
                {profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}
              </span>
            )}
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {format(new Date(), "EEEE, MMMM d, yyyy")}
            </p>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 shadow-sm shrink-0">
          <Activity size={14} className="text-emerald-500" />
          PharmaGuard Gujarat
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <StatCard
          icon={<Package size={18} className="text-blue-600 dark:text-blue-400" />}
          iconBg="bg-blue-50 dark:bg-blue-900/30"
          label="Total Drugs"
          value={drugs.length}
          sub={`${inStockDrugs.length} adequately stocked`}
          leftBorder="border-l-blue-500"
          loading={drugsLoading}
          onClick={() => navigate('/inventory')}
        />
        <StatCard
          icon={<AlertTriangle size={18} className="text-amber-600 dark:text-amber-400" />}
          iconBg="bg-amber-50 dark:bg-amber-900/30"
          label="Low Stock"
          value={lowStockDrugs.length + outOfStockDrugs.length}
          sub={`${outOfStockDrugs.length} out · ${lowStockDrugs.length} low`}
          leftBorder="border-l-amber-500"
          loading={drugsLoading}
          onClick={() => navigate('/inventory')}
        />
        <StatCard
          icon={<Clock size={18} className="text-red-600 dark:text-red-400" />}
          iconBg="bg-red-50 dark:bg-red-900/30"
          label="Near Expiry"
          value={nearExpiryCount}
          sub="batches expiring ≤ 30 days"
          leftBorder="border-l-red-500"
          loading={batchesLoading}
          onClick={() => navigate('/heatmap')}
        />
        <StatCard
          icon={<Activity size={18} className="text-emerald-600 dark:text-emerald-400" />}
          iconBg="bg-emerald-50 dark:bg-emerald-900/30"
          label="Dispensed Today"
          value={dispensedToday}
          sub={`${todayLogs.length} transaction${todayLogs.length !== 1 ? 's' : ''}`}
          leftBorder="border-l-emerald-500"
          loading={logsLoading}
          onClick={() => navigate('/dispense')}
        />
        <StatCard
          icon={<Bell size={18} className="text-purple-600 dark:text-purple-400" />}
          iconBg="bg-purple-50 dark:bg-purple-900/30"
          label="Unread Alerts"
          value={alerts.length}
          sub="active alerts"
          leftBorder="border-l-purple-500"
          loading={alertsLoading}
          onClick={() => navigate('/alerts')}
        />
      </div>

      {/* ── Charts row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">

        {/* Bar chart (3/5) */}
        <div className="lg:col-span-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Dispenses This Week</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Units dispensed per day (last 7 days)</p>
            </div>
            {!logsLoading && (
              <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {weekTotal.toLocaleString('en-IN')} units
              </div>
            )}
          </div>
          {logsLoading ? (
            <div className="h-48 bg-slate-50 dark:bg-slate-700/40 rounded-lg animate-pulse" />
          ) : (
            <div className="h-48">
              <Bar data={barData} options={barOptions} />
            </div>
          )}
        </div>

        {/* Doughnut chart (2/5) */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Stock Status Overview</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {drugsLoading ? 'Loading…' : `Across ${drugs.length} drugs`}
            </p>
          </div>
          {drugsLoading ? (
            <div className="h-52 bg-slate-50 dark:bg-slate-700/40 rounded-lg animate-pulse" />
          ) : drugs.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-slate-400 dark:text-slate-500 text-sm">
              No drug data yet
            </div>
          ) : (
            <div className="h-52">
              <Doughnut data={doughnutData} options={doughnutOptions} />
            </div>
          )}
        </div>
      </div>

      {/* ── Activity + Alerts row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">

        {/* Recent Dispenses (3/5) */}
        <div className="lg:col-span-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Recent Dispenses</h2>
            <button
              onClick={() => navigate('/dispense')}
              className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
            >
              View All <ChevronRight size={13} />
            </button>
          </div>

          {logsLoading ? (
            <div className="p-5 space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-start gap-3 animate-pulse">
                  <div className="w-2 h-2 rounded-full bg-slate-200 dark:bg-slate-600 mt-1.5 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 bg-slate-100 dark:bg-slate-700 rounded w-3/4" />
                    <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded w-1/2" />
                  </div>
                  <div className="h-3.5 w-14 bg-slate-100 dark:bg-slate-700 rounded" />
                </div>
              ))}
            </div>
          ) : recentLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-slate-400 dark:text-slate-500">
              <Activity size={28} className="mb-2 opacity-40" />
              <p className="text-sm">No dispenses in the last 7 days</p>
              <p className="text-xs mt-1">Records appear here after dispensing</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
              {recentLogs.map(log => {
                const isLarge = (log.quantity ?? 0) > 50;
                return (
                  <div
                    key={log.id}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
                  >
                    <div
                      className={`w-2 h-2 rounded-full shrink-0 ${isLarge ? 'bg-amber-400' : 'bg-emerald-400'}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                        {log.drugName}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                        {log.dispensedBy ? `By ${log.dispensedBy} · ` : ''}{relativeTime(log.timestamp)}
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 shrink-0 tabular-nums">
                      {(log.quantity ?? 0).toLocaleString('en-IN')} units
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Active Alerts (2/5) */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Active Alerts</h2>
            <button
              onClick={() => navigate('/alerts')}
              className="flex items-center gap-1 text-xs font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
            >
              View All <ChevronRight size={13} />
            </button>
          </div>

          {alertsLoading ? (
            <div className="p-5 space-y-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="w-1 h-12 bg-slate-200 dark:bg-slate-700 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 bg-slate-100 dark:bg-slate-700 rounded w-2/3" />
                    <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={28} className="mb-2" />
              <p className="text-sm font-semibold">All clear!</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">No unread alerts</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
              {alerts.slice(0, 5).map(alert => {
                const isStock = alert.type?.toLowerCase().includes('stock') || alert.type?.toLowerCase().includes('low');
                const strip   = isStock ? 'bg-amber-400' : 'bg-red-400';
                const badge   = isStock
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                  : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';

                return (
                  <div key={alert.id} className="flex hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                    <div className={`w-1 self-stretch shrink-0 ${strip}`} />
                    <div className="flex-1 px-4 py-3 min-w-0">
                      <span className={`inline-block text-xs font-semibold px-1.5 py-0.5 rounded mb-1 ${badge}`}>
                        {alert.type ?? 'Alert'}
                      </span>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                        {alert.drugName ?? alert.message ?? alert.description ?? 'Unknown'}
                      </p>
                      {(alert.message || alert.description) && alert.drugName && (
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                          {alert.message ?? alert.description}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Low Stock Quick View ── */}
      {!drugsLoading && (lowStockDrugs.length > 0 || outOfStockDrugs.length > 0) && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Low Stock Quick View
              <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                ({lowStockDrugs.length + outOfStockDrugs.length} drugs need attention)
              </span>
            </h2>
            <button
              onClick={() => navigate('/inventory')}
              className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 transition-colors"
            >
              Manage Inventory <ChevronRight size={13} />
            </button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {[...outOfStockDrugs, ...lowStockDrugs].slice(0, 12).map(drug => {
              const pct        = drug.reorderLevel > 0 ? Math.min((drug.currentStock / drug.reorderLevel) * 100, 100) : 0;
              const isCritical = drug.currentStock === 0 || pct < 50;

              return (
                <div
                  key={drug.id}
                  onClick={() => navigate('/inventory')}
                  className="flex-shrink-0 w-44 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all"
                >
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate mb-0.5">{drug.name}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mb-3 capitalize">{drug.unit}</p>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <span className={`text-lg font-bold tabular-nums ${isCritical ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {drug.currentStock.toLocaleString('en-IN')}
                    </span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      /{drug.reorderLevel.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${isCritical ? 'bg-red-500' : 'bg-amber-400'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">
                    {drug.currentStock === 0 ? 'Out of stock' : `${Math.round(pct)}% of reorder`}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* All adequately stocked */}
      {!drugsLoading && drugs.length > 0 && lowStockDrugs.length === 0 && outOfStockDrugs.length === 0 && (
        <div className="mb-6 flex items-center gap-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl px-5 py-4">
          <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">All drugs adequately stocked</p>
            <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">
              All {drugs.length} drugs are above their reorder levels.
            </p>
          </div>
        </div>
      )}

      {/* ── Admin Seed Panel ── */}
      {isAdmin && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 max-w-lg">
          <div className="flex items-start gap-3 mb-4">
            <div className="bg-violet-100 dark:bg-violet-900/40 rounded-lg p-2 mt-0.5">
              <DatabaseZap size={18} className="text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Database Seed</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Populates Firestore with 20 Gujarat EDL drugs, 3–5 batches each,
                6 months of seasonally-weighted dispense history, and 3 test users.
              </p>
            </div>
          </div>

          {seeded === null && (
            <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-sm mb-4">
              <Loader2 size={14} className="animate-spin" />
              Checking seed status…
            </div>
          )}
          {seeded === true && !seeding && (
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-4 py-2.5 text-sm mb-4">
              <CheckCircle2 size={16} />
              Database is already seeded. Data is ready.
            </div>
          )}
          {seedError && (
            <div className="flex items-start gap-2 text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2.5 text-sm mb-4">
              <ShieldAlert size={16} className="mt-0.5 shrink-0" />
              {seedError}
            </div>
          )}
          {seeding && (
            <div className="bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg px-4 py-3 mb-4">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300 text-sm font-medium mb-1">
                <Loader2 size={14} className="animate-spin" />
                Seeding in progress…
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">{progress}</p>
            </div>
          )}
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

      {/* ── Confirm Seed Dialog ── */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3 mb-3">
              <div className="bg-amber-100 dark:bg-amber-900/40 rounded-lg p-2">
                <AlertTriangle size={20} className="text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">Confirm Seed</h3>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-5 leading-relaxed">
              This will write <strong>20 drugs</strong>, up to <strong>100 batches</strong>,
              and approximately <strong>360+ dispense records</strong> to Firestore.
              <br /><br />
              This action cannot be undone from the UI. Proceed only once.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium py-2.5 rounded-lg transition-colors"
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
