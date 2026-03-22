import { useState, useEffect } from 'react';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  doc,
  updateDoc,
  writeBatch,
  getDocs,
  where,
} from 'firebase/firestore';
import {
  formatDistanceToNow,
  parseISO,
  format,
  subDays,
  startOfDay,
  addDays,
  isBefore,
} from 'date-fns';
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Package,
  Clock,
  ChevronDown,
  ChevronUp,
  X,
  Bell,
  Search,
  ArrowUpDown,
  Info,
  Trash2,
  CheckCheck,
  BarChart2,
  ShieldCheck,
} from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { db } from '../../config/firebase';
import type { Alert } from '../../types';

// ── Register Chart.js components ──────────────────────────────────────────────
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// ── Types ─────────────────────────────────────────────────────────────────────
type FilterType   = 'all' | 'critical' | 'warning' | 'low_stock' | 'near_expiry' | 'unread' | 'read';
type ConfirmKind  = 'mark_all' | 'clear_read';
type SortOrder    = 'desc' | 'asc';

// ── Pure helpers ──────────────────────────────────────────────────────────────

function typeLabel(type: Alert['type']): string {
  if (type === 'low_stock')   return 'Low Stock';
  if (type === 'near_expiry') return 'Near Expiry';
  return 'Expired';
}

function typeBadgeClass(type: Alert['type']): string {
  if (type === 'low_stock')   return 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800';
  if (type === 'near_expiry') return 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800';
  return 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800';
}

function stripeClass(severity: Alert['severity']): string {
  return severity === 'critical' ? 'bg-red-500' : 'bg-amber-400';
}

function cardBgClass(severity: Alert['severity'], read: boolean): string {
  if (read) return 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700';
  return severity === 'critical'
    ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
    : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800';
}

function severityIconClass(severity: Alert['severity']): string {
  return severity === 'critical' ? 'text-red-500' : 'text-amber-500';
}

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

// ── Summary card config ────────────────────────────────────────────────────────
interface SummaryCard {
  label:    string;
  key:      FilterType;
  color:    string;
  bg:       string;
  iconBg:   string;
  icon:     React.ReactNode;
}

// ── Batch write helper (chunked at 490) ────────────────────────────────────────
async function batchChunked(
  docs: { ref: import('firebase/firestore').DocumentReference }[],
  op: 'update' | 'delete',
  updateData?: Record<string, unknown>,
) {
  const CHUNK = 490;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const chunk = docs.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    chunk.forEach(d => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (op === 'update' && updateData) batch.update(d.ref, updateData as unknown as Record<string, any>);
      else batch.delete(d.ref);
    });
    await batch.commit();
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AlertsPage() {
  const [alerts, setAlerts]         = useState<Alert[]>([]);
  const [loading, setLoading]       = useState(true);

  const [filter, setFilter]         = useState<FilterType>('all');
  const [search, setSearch]         = useState('');
  const [sortOrder, setSortOrder]   = useState<SortOrder>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
  const [processing, setProcessing]   = useState(false);
  const [showStats, setShowStats]     = useState(false);

  // ── Real-time listener ─────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'alerts'), orderBy('createdAt', 'desc')),
      snap => {
        setAlerts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Alert)));
        setLoading(false);
      },
      err => {
        console.error(err);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  // ── Derived counts ─────────────────────────────────────────────────────────
  const unread     = alerts.filter(a => !a.read);
  const critical   = alerts.filter(a => a.severity === 'critical');
  const lowStock   = alerts.filter(a => a.type === 'low_stock');
  const nearExpiry = alerts.filter(a => a.type === 'near_expiry');

  const summaryCards: SummaryCard[] = [
    {
      label:  'Unread',
      key:    'unread',
      color:  'text-blue-700 dark:text-blue-300',
      bg:     'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800',
      iconBg: 'bg-blue-100 dark:bg-blue-900/40',
      icon:   <Bell size={18} className="text-blue-600 dark:text-blue-400" />,
    },
    {
      label:  'Critical',
      key:    'critical',
      color:  'text-red-700 dark:text-red-300',
      bg:     'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800',
      iconBg: 'bg-red-100 dark:bg-red-900/40',
      icon:   <AlertTriangle size={18} className="text-red-600 dark:text-red-400" />,
    },
    {
      label:  'Low Stock',
      key:    'low_stock',
      color:  'text-orange-700 dark:text-orange-300',
      bg:     'bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800',
      iconBg: 'bg-orange-100 dark:bg-orange-900/40',
      icon:   <Package size={18} className="text-orange-600 dark:text-orange-400" />,
    },
    {
      label:  'Near Expiry',
      key:    'near_expiry',
      color:  'text-yellow-700 dark:text-yellow-300',
      bg:     'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800',
      iconBg: 'bg-yellow-100 dark:bg-yellow-900/40',
      icon:   <Clock size={18} className="text-yellow-600 dark:text-yellow-400" />,
    },
  ];

  const countFor = (key: FilterType) => {
    if (key === 'unread')      return unread.length;
    if (key === 'critical')    return critical.length;
    if (key === 'low_stock')   return lowStock.length;
    if (key === 'near_expiry') return nearExpiry.length;
    return 0;
  };

  // ── Filtered + sorted list ─────────────────────────────────────────────────
  const filtered = alerts
    .filter(a => {
      if (filter === 'critical')    return a.severity === 'critical';
      if (filter === 'warning')     return a.severity === 'warning';
      if (filter === 'low_stock')   return a.type === 'low_stock';
      if (filter === 'near_expiry') return a.type === 'near_expiry';
      if (filter === 'unread')      return !a.read;
      if (filter === 'read')        return a.read;
      return true;
    })
    .filter(a =>
      !search || a.drugName.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      const diff = a.createdAt.localeCompare(b.createdAt);
      return sortOrder === 'desc' ? -diff : diff;
    });

  // ── Single mark-read ───────────────────────────────────────────────────────
  async function markRead(id: string) {
    await updateDoc(doc(db, 'alerts', id), { read: true });
  }

  // ── Bulk mark all read (chunked at 490) ────────────────────────────────────
  async function markAllRead() {
    setProcessing(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'alerts'), where('read', '==', false)),
      );
      if (snap.empty) { setConfirmKind(null); setProcessing(false); return; }
      await batchChunked(snap.docs, 'update', { read: true });
    } catch (err) {
      console.error(err);
    } finally {
      setConfirmKind(null);
      setProcessing(false);
    }
  }

  // ── Clear read alerts (chunked at 490) ────────────────────────────────────
  async function clearRead() {
    setProcessing(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'alerts'), where('read', '==', true)),
      );
      if (snap.empty) { setConfirmKind(null); setProcessing(false); return; }
      await batchChunked(snap.docs, 'delete');
    } catch (err) {
      console.error(err);
    } finally {
      setConfirmKind(null);
      setProcessing(false);
    }
  }

  function handleConfirm() {
    if (confirmKind === 'mark_all')        markAllRead();
    else if (confirmKind === 'clear_read') clearRead();
  }

  // ── Chart data (last 7 days) ───────────────────────────────────────────────
  const today    = new Date();
  const last7    = Array.from({ length: 7 }, (_, i) => subDays(today, 6 - i));
  const chartLabels = last7.map(d => format(d, 'dd MMM'));

  function countForDay(day: Date, sev: Alert['severity']) {
    const dayStart = startOfDay(day);
    const dayEnd   = startOfDay(addDays(day, 1));
    return alerts.filter(a => {
      try {
        const t = parseISO(a.createdAt);
        return a.severity === sev && !isBefore(t, dayStart) && isBefore(t, dayEnd);
      } catch { return false; }
    }).length;
  }

  const chartData = {
    labels: chartLabels,
    datasets: [
      {
        label: 'Critical',
        data:  last7.map(d => countForDay(d, 'critical')),
        backgroundColor: 'rgba(239, 68, 68, 0.7)',
        borderRadius: 4,
      },
      {
        label: 'Warning',
        data:  last7.map(d => countForDay(d, 'warning')),
        backgroundColor: 'rgba(245, 158, 11, 0.65)',
        borderRadius: 4,
      },
    ],
  };

  const chartOptions = {
    responsive:          true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' as const, labels: { font: { size: 12 } } },
      title:  { display: false },
    },
    scales: {
      y: { beginAtZero: true, ticks: { stepSize: 1 } },
    },
  };

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="h-8 w-40 bg-slate-200 dark:bg-slate-700 rounded-lg animate-pulse mb-6" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-5xl mx-auto">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Alert Centre</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
            Real-time inventory alerts — {unread.length} unread
          </p>
        </div>

        {/* Bulk actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setConfirmKind('mark_all')}
            disabled={unread.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <CheckCheck size={15} /> Mark All Read
          </button>
          <button
            onClick={() => setConfirmKind('clear_read')}
            disabled={alerts.filter(a => a.read).length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Trash2 size={15} /> Clear Read
          </button>
        </div>
      </div>

      {/* ── Summary Cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {summaryCards.map(card => (
          <button
            key={card.key}
            onClick={() => setFilter(f => f === card.key ? 'all' : card.key)}
            className={`text-left p-4 rounded-xl transition-all shadow-sm ${card.bg} ${
              filter === card.key ? 'ring-2 ring-offset-1 ring-blue-400' : 'hover:shadow-md'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className={`p-2 rounded-lg ${card.iconBg}`}>{card.icon}</div>
              {filter === card.key && (
                <span className="text-[10px] font-bold text-blue-600 bg-blue-100 dark:bg-blue-900/40 dark:text-blue-300 px-1.5 py-0.5 rounded-full">
                  ACTIVE
                </span>
              )}
            </div>
            <p className={`text-2xl font-bold ${card.color}`}>{countFor(card.key)}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{card.label}</p>
          </button>
        ))}
      </div>

      {/* ── Smart Throttling Banner ───────────────────────────────────────── */}
      <div className="mb-5 flex items-start gap-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-3">
        <ShieldCheck size={17} className="text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
        <div>
          <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">Smart Throttling Active</span>
          <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5 leading-relaxed">
            Only critical alerts (expiry ≤ 7 days or stock ≤ 50% of reorder level) trigger
            immediate push notifications. Routine warnings are batched into a daily digest to
            reduce alert fatigue.
          </p>
        </div>
      </div>

      {/* ── Filter + Search + Sort bar ────────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 mb-4 shadow-sm">
        {/* Filter pills */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {(
            [
              { key: 'all',         label: 'All' },
              { key: 'critical',    label: 'Critical' },
              { key: 'warning',     label: 'Warning' },
              { key: 'low_stock',   label: 'Low Stock' },
              { key: 'near_expiry', label: 'Near Expiry' },
              { key: 'unread',      label: 'Unread' },
              { key: 'read',        label: 'Read' },
            ] as { key: FilterType; label: string }[]
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors border ${
                filter === key
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 hover:bg-slate-50 dark:hover:bg-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search + sort */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by drug name…"
              className="w-full pl-8 pr-4 py-2 text-sm border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <button
            onClick={() => setSortOrder(o => o === 'desc' ? 'asc' : 'desc')}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shrink-0"
          >
            <ArrowUpDown size={13} />
            {sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}
          </button>
          <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">
            {filtered.length} alert{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* ── Alert List ───────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-12 text-center shadow-sm">
          {alerts.length === 0 ? (
            <>
              <div className="flex justify-center mb-4">
                <div className="p-4 bg-green-100 dark:bg-green-900/40 rounded-full">
                  <CheckCircle2 size={36} className="text-green-500 dark:text-green-400" />
                </div>
              </div>
              <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200 mb-2">All clear!</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm max-w-sm mx-auto">
                No alerts at the moment. Alerts are automatically generated when stock is
                low or batches are near expiry.
              </p>
            </>
          ) : (
            <>
              <Info size={28} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
              <p className="text-slate-500 dark:text-slate-400 text-sm">No alerts match the current filter.</p>
              <button
                onClick={() => { setFilter('all'); setSearch(''); }}
                className="mt-3 text-blue-600 dark:text-blue-400 text-sm hover:underline"
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map(alert => {
            const isExpanded = expandedId === alert.id;

            return (
              <div
                key={alert.id}
                className={`rounded-xl overflow-hidden shadow-sm transition-all ${cardBgClass(alert.severity, alert.read)} ${alert.read ? 'opacity-75' : ''}`}
              >
                {/* Main row */}
                <div
                  className="flex items-start gap-0 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : alert.id)}
                >
                  {/* Severity stripe */}
                  <div className={`w-1 self-stretch shrink-0 rounded-l-xl ${stripeClass(alert.severity)}`} />

                  <div className="flex-1 px-4 py-3.5 min-w-0">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        {/* Icon */}
                        <div className="mt-0.5 shrink-0">
                          {alert.severity === 'critical'
                            ? <AlertTriangle size={17} className={severityIconClass(alert.severity)} />
                            : <AlertCircle   size={17} className={severityIconClass(alert.severity)} />}
                        </div>

                        <div className="min-w-0 flex-1">
                          {/* Top row: type badge + drug name + NEW badge */}
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${typeBadgeClass(alert.type)}`}>
                              {typeLabel(alert.type)}
                            </span>
                            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                              {alert.drugName}
                            </span>
                            {!alert.read && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500 text-white shrink-0">
                                NEW
                              </span>
                            )}
                          </div>

                          {/* Message */}
                          <p className={`text-xs text-slate-600 dark:text-slate-400 leading-relaxed ${!isExpanded ? 'truncate' : ''}`}>
                            {alert.message}
                          </p>
                        </div>
                      </div>

                      {/* Right: time + expand chevron */}
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">
                          {relativeTime(alert.createdAt)}
                        </span>
                        {isExpanded
                          ? <ChevronUp size={15} className="text-slate-400 dark:text-slate-500" />
                          : <ChevronDown size={15} className="text-slate-400 dark:text-slate-500" />}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded detail panel */}
                {isExpanded && (
                  <div className="border-t border-slate-200/70 dark:border-slate-700 bg-white/60 dark:bg-slate-800/60 px-5 py-4 ml-1">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4 text-xs">
                      <div>
                        <p className="text-slate-400 dark:text-slate-500 mb-0.5">Drug</p>
                        <p className="font-semibold text-slate-700 dark:text-slate-200">{alert.drugName}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 dark:text-slate-500 mb-0.5">Severity</p>
                        <p className={`font-semibold capitalize ${
                          alert.severity === 'critical' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
                        }`}>
                          {alert.severity}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-400 dark:text-slate-500 mb-0.5">Created</p>
                        <p className="font-semibold text-slate-700 dark:text-slate-200">
                          {format(parseISO(alert.createdAt), 'dd MMM yyyy, HH:mm')}
                        </p>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-600 rounded-lg px-3 py-2 mb-4 leading-relaxed">
                      {alert.message}
                    </p>

                    <div className="flex items-center gap-2 flex-wrap">
                      {!alert.read && (
                        <button
                          onClick={e => { e.stopPropagation(); markRead(alert.id); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                          <CheckCheck size={13} /> Mark as Read
                        </button>
                      )}
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          markRead(alert.id);
                          setExpandedId(null);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                      >
                        <X size={13} /> Dismiss
                      </button>
                      {alert.read && (
                        <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 size={13} /> Read
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Alert Statistics (collapsible) ───────────────────────────────── */}
      <div className="mt-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden">
        <button
          onClick={() => setShowStats(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <BarChart2 size={16} className="text-slate-400 dark:text-slate-500" />
            Alert History — Last 7 Days
          </div>
          {showStats
            ? <ChevronUp size={16} className="text-slate-400 dark:text-slate-500" />
            : <ChevronDown size={16} className="text-slate-400 dark:text-slate-500" />}
        </button>

        {showStats && (
          <div className="px-5 pb-5 border-t border-slate-100 dark:border-slate-700">
            {alerts.length === 0 ? (
              <p className="text-slate-400 dark:text-slate-500 text-sm py-6 text-center">No alert data yet.</p>
            ) : (
              <div className="h-52 mt-4">
                <Bar key={alerts.length} data={chartData} options={chartOptions} />
              </div>
            )}

            {/* Summary table below chart */}
            <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Total (7d)',    value: last7.reduce((s, d) => s + countForDay(d, 'critical') + countForDay(d, 'warning'), 0), color: 'text-slate-700 dark:text-slate-200' },
                { label: 'Critical (7d)', value: last7.reduce((s, d) => s + countForDay(d, 'critical'), 0), color: 'text-red-600 dark:text-red-400' },
                { label: 'Warning (7d)',  value: last7.reduce((s, d) => s + countForDay(d, 'warning'),  0), color: 'text-amber-600 dark:text-amber-400' },
                { label: 'Auto-resolved', value: alerts.filter(a => a.read).length, color: 'text-emerald-600 dark:text-emerald-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3 text-center">
                  <p className={`text-xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Confirmation Modal ────────────────────────────────────────────── */}
      {confirmKind && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-amber-100 dark:bg-amber-900/40 p-2 rounded-lg">
                <AlertTriangle size={20} className="text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                {confirmKind === 'mark_all' ? 'Mark All Alerts as Read?' : 'Delete All Read Alerts?'}
              </h3>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-5 leading-relaxed">
              {confirmKind === 'mark_all'
                ? `This will mark all ${unread.length} unread alert${unread.length !== 1 ? 's' : ''} as read. This cannot be undone.`
                : `This will permanently delete ${alerts.filter(a => a.read).length} read alert${alerts.filter(a => a.read).length !== 1 ? 's' : ''}. This cannot be undone.`}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmKind(null)}
                disabled={processing}
                className="flex-1 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={processing}
                className={`flex-1 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50 ${
                  confirmKind === 'clear_read'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {processing ? 'Processing…' : confirmKind === 'mark_all' ? 'Mark All Read' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
