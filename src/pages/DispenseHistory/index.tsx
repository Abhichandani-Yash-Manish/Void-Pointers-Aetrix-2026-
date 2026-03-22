import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { parseISO, format, isToday, subDays, isAfter } from 'date-fns';
import { ClipboardList, Search, Calendar, ArrowUpDown, ChevronRight } from 'lucide-react';
import type { DispenseLog } from '../../types';

type DateRange = 'today' | '7days' | '30days' | 'all';
type SortOrder = 'desc' | 'asc';

// dispensedByName is stored in Firestore but not in the shared DispenseLog type
type RawLog = DispenseLog & { dispensedByName?: string };

interface DispenseTransaction {
  key: string;
  drugId: string;
  drugName: string;
  dispensedByName: string;
  timestamp: string;
  totalQuantity: number;
  batches: { batchNumber: string; batchId: string; quantity: number }[];
}

function groupLogs(logs: DispenseLog[]): DispenseTransaction[] {
  const grouped = new Map<string, RawLog[]>();

  for (const log of logs) {
    // Remove milliseconds so logs from the same writeBatch share a key
    const roundedTime = log.timestamp.substring(0, 19); // "2026-03-21T14:30:00"
    const key = `${log.drugId}_${log.dispensedBy}_${roundedTime}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(log as RawLog);
  }

  return Array.from(grouped.entries()).map(([key, group]) => {
    const first = group[0];
    return {
      key,
      drugId: first.drugId,
      drugName: first.drugName,
      dispensedByName: first.dispensedByName || first.dispensedBy,
      timestamp: first.timestamp,
      totalQuantity: group.reduce((sum, l) => sum + l.quantity, 0),
      batches: group.map(l => ({
        batchNumber: l.batchNumber,
        batchId: l.batchId,
        quantity: l.quantity,
      })),
    };
  });
}

function cardBorder(qty: number) {
  if (qty > 500) return 'border-l-4 border-l-red-500';
  if (qty >= 100) return 'border-l-4 border-l-amber-400';
  return 'border-l-4 border-l-emerald-500';
}

function qtyBadgeClass(qty: number) {
  if (qty > 500) return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
  if (qty >= 100) return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400';
  return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400';
}

export default function DispenseHistoryPage() {
  const [logs, setLogs] = useState<DispenseLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // onSnapshot unchanged — raw logs come in as before
  useEffect(() => {
    const q = query(collection(db, 'dispenseLogs'), orderBy('timestamp', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DispenseLog)));
      setLoading(false);
    });
    return unsub;
  }, []);

  // Group raw logs into transactions (memoised — re-runs only when logs change)
  const transactions = useMemo(() => groupLogs(logs), [logs]);

  // Filter + sort on grouped transactions
  const filtered = useMemo(() => {
    return transactions
      .filter((tx) => {
        const q = search.toLowerCase();
        const matchesSearch =
          !search ||
          tx.drugName.toLowerCase().includes(q) ||
          tx.dispensedByName.toLowerCase().includes(q);

        let matchesDate = true;
        if (dateRange !== 'all') {
          const ts = parseISO(tx.timestamp);
          if (dateRange === 'today')   matchesDate = isToday(ts);
          if (dateRange === '7days')   matchesDate = isAfter(ts, subDays(new Date(), 7));
          if (dateRange === '30days')  matchesDate = isAfter(ts, subDays(new Date(), 30));
        }

        return matchesSearch && matchesDate;
      })
      .sort((a, b) => {
        const diff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        return sortOrder === 'desc' ? -diff : diff;
      });
  }, [transactions, search, dateRange, sortOrder]);

  // Stats — all based on grouped + filtered transactions
  const totalUnits     = filtered.reduce((sum, tx) => sum + tx.totalQuantity, 0);
  const dispensedToday = filtered.filter((tx) => isToday(parseISO(tx.timestamp))).length;
  const uniqueDrugs    = new Set(filtered.map((tx) => tx.drugName)).size;

  const dateRangeOptions: { label: string; value: DateRange }[] = [
    { label: 'Today',        value: 'today'   },
    { label: 'Last 7 Days',  value: '7days'   },
    { label: 'Last 30 Days', value: '30days'  },
    { label: 'All Time',     value: 'all'     },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-emerald-500/10 dark:bg-emerald-500/20 p-2 rounded-lg">
          <ClipboardList size={22} className="text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Dispense History</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Real-time audit trail of all dispense events</p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-slate-800 rounded-xl p-4 animate-pulse h-24" />
          ))
        ) : (
          <>
            <StatCard label="Total Dispenses"  value={filtered.length}                 color="emerald" />
            <StatCard label="Dispensed Today"  value={dispensedToday}                  color="blue"    />
            <StatCard label="Total Units"      value={totalUnits.toLocaleString()}      color="amber"   />
            <StatCard label="Unique Drugs"     value={uniqueDrugs}                      color="purple"  />
          </>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 mb-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search drug or pharmacist..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex gap-1">
            {dateRangeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDateRange(opt.value)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  dateRange === opt.value
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                }`}
              >
                <Calendar size={11} />
                {opt.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => setSortOrder((s) => (s === 'desc' ? 'asc' : 'desc'))}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
          >
            <ArrowUpDown size={11} />
            {sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}
          </button>
        </div>
      </div>

      {/* Transaction cards */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 animate-pulse">
              <div className="flex justify-between mb-3">
                <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-48" />
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-32" />
              </div>
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-40 mb-4" />
              <div className="h-px bg-slate-100 dark:bg-slate-700 mb-3" />
              <div className="space-y-2">
                <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded w-3/4" />
                <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 py-16 text-center text-slate-400 dark:text-slate-500">
          <ClipboardList size={36} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">No dispense records found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((tx) => (
            <div
              key={tx.key}
              className={`${cardBorder(tx.totalQuantity)} bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden`}
            >
              <div className="px-5 py-4">

                {/* Drug name + timestamp */}
                <div className="flex items-start justify-between gap-3 mb-1">
                  <p className="font-bold text-slate-800 dark:text-slate-100 text-base leading-snug">
                    {tx.drugName}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap shrink-0 mt-0.5">
                    {format(parseISO(tx.timestamp), 'MMM d, yyyy')} at {format(parseISO(tx.timestamp), 'h:mm a')}
                  </p>
                </div>

                {/* Dispensed by */}
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
                  Dispensed by:{' '}
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    {tx.dispensedByName}
                  </span>
                </p>

                {/* Total quantity */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">Total:</span>
                  <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${qtyBadgeClass(tx.totalQuantity)}`}>
                    {tx.totalQuantity.toLocaleString()} units
                  </span>
                </div>

                {/* Batch breakdown */}
                <div className="border-t border-slate-100 dark:border-slate-700 pt-3">
                  <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">
                    Batch Breakdown
                  </p>
                  <div className="space-y-1">
                    {tx.batches.map((b, i) => (
                      <div key={b.batchId} className="flex items-center gap-2 text-xs">
                        <span className="text-slate-300 dark:text-slate-600 font-mono shrink-0 select-none">
                          {i === tx.batches.length - 1 ? '└──' : '├──'}
                        </span>
                        <span className="font-mono text-slate-600 dark:text-slate-300 shrink-0">
                          {b.batchNumber}
                        </span>
                        <ChevronRight size={11} className="text-slate-300 dark:text-slate-600 shrink-0" />
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {b.quantity.toLocaleString()} units
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-3 text-right">
          Showing {filtered.length} transaction{filtered.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: 'emerald' | 'blue' | 'amber' | 'purple';
}) {
  const colors = {
    emerald: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20',
    blue:    'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20',
    amber:   'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20',
    purple:  'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20',
  };
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold rounded px-1 inline-block ${colors[color]}`}>{value}</p>
    </div>
  );
}
