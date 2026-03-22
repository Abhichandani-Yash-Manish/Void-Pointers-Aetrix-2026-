import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { parseISO, format, isToday, subDays, isAfter } from 'date-fns';
import { ClipboardList, Search, Calendar, ArrowUpDown } from 'lucide-react';
import type { DispenseLog } from '../../types';

type DateRange = 'today' | '7days' | '30days' | 'all';
type SortOrder = 'desc' | 'asc';

export default function DispenseHistoryPage() {
  const [logs, setLogs] = useState<DispenseLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  useEffect(() => {
    const q = query(collection(db, 'dispenseLogs'), orderBy('timestamp', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DispenseLog)));
      setLoading(false);
    });
    return unsub;
  }, []);

  const filtered = logs
    .filter((log) => {
      const searchLower = search.toLowerCase();
      const matchesSearch =
        !search ||
        log.drugName.toLowerCase().includes(searchLower) ||
        log.dispensedBy.toLowerCase().includes(searchLower);

      let matchesDate = true;
      if (dateRange !== 'all') {
        const ts = parseISO(log.timestamp);
        if (dateRange === 'today') matchesDate = isToday(ts);
        else if (dateRange === '7days') matchesDate = isAfter(ts, subDays(new Date(), 7));
        else if (dateRange === '30days') matchesDate = isAfter(ts, subDays(new Date(), 30));
      }

      return matchesSearch && matchesDate;
    })
    .sort((a, b) => {
      const diff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return sortOrder === 'desc' ? -diff : diff;
    });

  const totalUnits = filtered.reduce((sum, l) => sum + l.quantity, 0);
  const dispensedToday = filtered.filter((l) => isToday(parseISO(l.timestamp))).length;
  const uniqueDrugs = new Set(filtered.map((l) => l.drugName)).size;

  const rowBorder = (qty: number) => {
    if (qty > 500) return 'border-l-4 border-l-red-500';
    if (qty >= 100) return 'border-l-4 border-l-amber-400';
    return 'border-l-4 border-l-emerald-500';
  };

  const dateRangeOptions: { label: string; value: DateRange }[] = [
    { label: 'Today', value: 'today' },
    { label: 'Last 7 Days', value: '7days' },
    { label: 'Last 30 Days', value: '30days' },
    { label: 'All Time', value: 'all' },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
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
            <StatCard label="Total Dispenses" value={filtered.length} color="emerald" />
            <StatCard label="Dispensed Today" value={dispensedToday} color="blue" />
            <StatCard label="Total Units" value={totalUnits.toLocaleString()} color="amber" />
            <StatCard label="Unique Drugs" value={uniqueDrugs} color="purple" />
          </>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 mb-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        {/* Search */}
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
          {/* Date range pills */}
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

          {/* Sort toggle */}
          <button
            onClick={() => setSortOrder((s) => (s === 'desc' ? 'asc' : 'desc'))}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
          >
            <ArrowUpDown size={11} />
            {sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-4 px-5 py-4 animate-pulse">
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-32" />
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-24" />
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-20" />
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-16" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-400 dark:text-slate-500">
            <ClipboardList size={36} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">No dispense records found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Drug</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Batch</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Qty</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Dispensed By</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {filtered.map((log) => (
                  <tr
                    key={log.id}
                    className={`${rowBorder(log.quantity)} hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors`}
                  >
                    <td className="px-5 py-3.5 font-medium text-slate-800 dark:text-slate-100">{log.drugName}</td>
                    <td className="px-5 py-3.5 text-slate-500 dark:text-slate-400 font-mono text-xs">{log.batchNumber}</td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                          log.quantity > 500
                            ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                            : log.quantity >= 100
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                            : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {log.quantity}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-600 dark:text-slate-300">{log.dispensedBy}</td>
                    <td className="px-5 py-3.5 text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
                      {format(parseISO(log.timestamp), 'dd MMM yyyy, hh:mm a')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && filtered.length > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 text-right">
          Showing {filtered.length} record{filtered.length !== 1 ? 's' : ''}
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
    blue: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20',
    amber: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20',
    purple: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20',
  };
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold rounded px-1 inline-block ${colors[color]}`}>{value}</p>
    </div>
  );
}
