import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../config/firebase';
import type { Drug, Batch } from '../../types';
import {
  addMonths,
  differenceInDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  isToday,
  parseISO,
  startOfMonth,
  startOfToday,
  subMonths,
} from 'date-fns';
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Filter,
  Package,
  X,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────

interface FlatBatch {
  drugId: string;
  drugName: string;
  drugCategory: string;
  batchId: string;
  batchNumber: string;
  quantity: number;
  expiryDate: string;       // ISO string, e.g. "2025-10-15"
  costPerUnit: number;
  daysUntilExpiry: number;  // negative = already expired
  valueAtRisk: number;      // quantity × costPerUnit
}

type UrgencyFilter = 'all' | 'expired' | '7' | '30' | '90';

// ─── Constants ─────────────────────────────────────────────────────────────

const TODAY = startOfToday();

const URGENCY_OPTS: {
  val: UrgencyFilter;
  label: string;
  active: string;
  inactive: string;
}[] = [
  { val: 'all',     label: 'All',       active: 'bg-gray-700 text-white',     inactive: 'bg-gray-100 text-gray-600 hover:bg-gray-200' },
  { val: 'expired', label: 'Expired',   active: 'bg-red-600 text-white',      inactive: 'bg-red-50 text-red-600 hover:bg-red-100' },
  { val: '7',       label: '< 7 Days',  active: 'bg-orange-500 text-white',   inactive: 'bg-orange-50 text-orange-600 hover:bg-orange-100' },
  { val: '30',      label: '< 30 Days', active: 'bg-yellow-500 text-white',   inactive: 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100' },
  { val: '90',      label: '< 90 Days', active: 'bg-green-600 text-white',    inactive: 'bg-green-50 text-green-600 hover:bg-green-100' },
];

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const LEGEND = [
  ['bg-red-500',    'Expired / Today'],
  ['bg-orange-400', '< 7 days'],
  ['bg-yellow-300', '< 30 days'],
  ['bg-green-300',  '< 90 days'],
  ['bg-sky-200',    '> 90 days'],
] as const;

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Format a number as Indian locale integer (no decimals). */
const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

/** Monday-first leading empty cells for the month start. */
function weekPad(d: Date): number {
  const dow = d.getDay(); // 0 = Sunday
  return dow === 0 ? 6 : dow - 1;
}

/** Background class for a calendar cell based on urgency + batch count intensity. */
function cellBg(batches: FlatBatch[]): string {
  if (!batches.length) return '';
  const min = Math.min(...batches.map(b => b.daysUntilExpiry));
  const idx = Math.min(batches.length, 3) - 1; // 0 | 1 | 2

  if (min <= 0)  return ['bg-red-400',    'bg-red-500',    'bg-red-600'   ][idx];
  if (min <= 7)  return ['bg-orange-300', 'bg-orange-400', 'bg-orange-500'][idx];
  if (min <= 30) return ['bg-yellow-200', 'bg-yellow-300', 'bg-yellow-400'][idx];
  if (min <= 90) return ['bg-green-200',  'bg-green-300',  'bg-green-400' ][idx];
  return               ['bg-sky-100',    'bg-sky-200',    'bg-sky-300'   ][idx];
}

function statusInfo(days: number): { label: string; cls: string } {
  if (days <= 0)  return { label: 'EXPIRED',  cls: 'bg-red-100 text-red-700 border border-red-200' };
  if (days <= 7)  return { label: 'CRITICAL', cls: 'bg-orange-100 text-orange-700 border border-orange-200' };
  if (days <= 30) return { label: 'WARNING',  cls: 'bg-yellow-100 text-yellow-700 border border-yellow-200' };
  return               { label: 'OK',        cls: 'bg-green-100 text-green-700 border border-green-200' };
}

// ─── StatCard ──────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: ReactNode;
  label: string;
  count: number;
  sub: string;
  border: string;
  countCls: string;
}

function StatCard({ icon, label, count, sub, border, countCls }: StatCardProps) {
  return (
    <div className={`bg-white dark:bg-slate-800 rounded-xl border ${border} shadow-sm p-4`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs font-medium text-gray-500 dark:text-slate-400">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${countCls}`}>{count}</p>
      <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{sub}</p>
    </div>
  );
}

// ─── MonthGrid ─────────────────────────────────────────────────────────────

interface MonthGridProps {
  monthStart: Date;
  byDay: Record<string, FlatBatch[]>;
  selectedDay: Date | null;
  onSelect: (d: Date) => void;
}

function MonthGrid({ monthStart, byDay, selectedDay, onSelect }: MonthGridProps) {
  const days = eachDayOfInterval({ start: monthStart, end: endOfMonth(monthStart) });
  const pad  = weekPad(monthStart);

  return (
    <div className="flex-1 min-w-[260px]">
      {/* Month title */}
      <h3 className="text-center text-sm font-semibold text-gray-600 dark:text-slate-300 mb-2">
        {format(monthStart, 'MMMM yyyy')}
      </h3>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DAY_LABELS.map(l => (
          <div key={l} className="text-center text-[10px] font-medium text-gray-400 dark:text-slate-500 py-1">
            {l}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-0.5">
        {/* Leading empty cells */}
        {Array.from({ length: pad }).map((_, i) => <div key={`p${i}`} />)}

        {days.map(day => {
          const key      = format(day, 'yyyy-MM-dd');
          const batches  = byDay[key] ?? [];
          const bg       = cellBg(batches);
          const selected = selectedDay ? isSameDay(day, selectedDay) : false;
          const todayDay = isToday(day);
          const totalVal = batches.reduce((s, b) => s + b.valueAtRisk, 0);

          return (
            <div key={key} className="relative group">
              <button
                onClick={() => onSelect(day)}
                className={[
                  'relative w-full aspect-square min-h-[34px] rounded-md',
                  'flex items-center justify-center text-[11px] font-medium transition-all',
                  bg || 'bg-gray-50 hover:bg-gray-100 dark:bg-slate-700 dark:hover:bg-slate-600',
                  batches.length ? 'text-gray-900 dark:text-slate-100' : 'text-gray-400 dark:text-slate-500',
                  selected ? 'ring-2 ring-blue-500 ring-offset-1 scale-105 shadow-sm' : '',
                  todayDay && !selected ? 'ring-2 ring-blue-300' : '',
                ].filter(Boolean).join(' ')}
              >
                {format(day, 'd')}
                {batches.length > 1 && (
                  <span className="absolute top-0.5 right-0.5 text-[7px] font-bold leading-none opacity-80">
                    {batches.length}
                  </span>
                )}
              </button>

              {/* Hover tooltip */}
              {batches.length > 0 && (
                <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block pointer-events-none w-max">
                  <div className="bg-gray-900 text-white rounded-lg px-3 py-2 text-xs shadow-xl">
                    <div className="font-semibold mb-0.5">{format(day, 'dd MMM yyyy')}</div>
                    <div className="text-gray-300">
                      {batches.length} batch{batches.length > 1 ? 'es' : ''} expiring
                    </div>
                    <div className="text-orange-300 font-medium">₹{inr(totalVal)} at risk</div>
                  </div>
                  <div className="w-2.5 h-2.5 bg-gray-900 rotate-45 mx-auto -mt-1.5" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function HeatmapPage() {
  const [allBatches,  setAllBatches]  = useState<FlatBatch[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [windowStart, setWindowStart] = useState(startOfMonth(TODAY));
  const [drugFilter,  setDrugFilter]  = useState('all');
  const [catFilter,   setCatFilter]   = useState('all');
  const [urgency,     setUrgency]     = useState<UrgencyFilter>('all');
  const [tableOpen,   setTableOpen]   = useState(false);
  const [sortAsc,     setSortAsc]     = useState(true);

  // ── Load data ───────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const drugSnaps = await getDocs(collection(db, 'drugs'));
        const drugs = drugSnaps.docs.map(d => ({ id: d.id, ...d.data() } as Drug));

        const flat: FlatBatch[] = [];

        await Promise.all(
          drugs.map(async drug => {
            const bSnaps = await getDocs(collection(db, 'drugs', drug.id, 'batches'));
            bSnaps.docs.forEach(bd => {
              const b = { id: bd.id, ...bd.data() } as Batch;
              if (b.quantity === 0) return; // skip depleted
              flat.push({
                drugId:          drug.id,
                drugName:        drug.name,
                drugCategory:    drug.category,
                batchId:         b.id,
                batchNumber:     b.batchNumber,
                quantity:        b.quantity,
                expiryDate:      b.expiryDate,
                costPerUnit:     b.costPerUnit,
                daysUntilExpiry: differenceInDays(parseISO(b.expiryDate), TODAY),
                valueAtRisk:     b.quantity * b.costPerUnit,
              });
            });
          })
        );

        flat.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
        setAllBatches(flat);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Derived filter options ──────────────────────────────────────────────
  const drugOptions = useMemo(() => {
    const map = new Map<string, string>();
    allBatches.forEach(b => map.set(b.drugId, b.drugName));
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [allBatches]);

  const catOptions = useMemo(
    () => [...new Set(allBatches.map(b => b.drugCategory))].sort(),
    [allBatches]
  );

  // ── Apply filters ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return allBatches.filter(b => {
      if (drugFilter !== 'all' && b.drugId !== drugFilter)         return false;
      if (catFilter  !== 'all' && b.drugCategory !== catFilter)    return false;
      if (urgency === 'expired' && b.daysUntilExpiry > 0)          return false;
      if (urgency === '7'       && b.daysUntilExpiry > 7)          return false;
      if (urgency === '30'      && b.daysUntilExpiry > 30)         return false;
      if (urgency === '90'      && b.daysUntilExpiry > 90)         return false;
      return true;
    });
  }, [allBatches, drugFilter, catFilter, urgency]);

  /** Lookup map: "yyyy-MM-dd" → FlatBatch[] (used by calendar cells) */
  const byDay = useMemo(() => {
    const m: Record<string, FlatBatch[]> = {};
    filtered.forEach(b => {
      const k = b.expiryDate.slice(0, 10);
      (m[k] ??= []).push(b);
    });
    return m;
  }, [filtered]);

  // ── Summary stats (always from unfiltered allBatches) ──────────────────
  const stats = useMemo(() => {
    const expired = allBatches.filter(b => b.daysUntilExpiry <= 0);
    const week7   = allBatches.filter(b => b.daysUntilExpiry > 0  && b.daysUntilExpiry <= 7);
    const month30 = allBatches.filter(b => b.daysUntilExpiry > 7  && b.daysUntilExpiry <= 30);
    const safe    = allBatches.filter(b => b.daysUntilExpiry > 90);
    return {
      expiredCount: expired.length,
      expiredVal:   expired.reduce((s, b) => s + b.valueAtRisk, 0),
      weekCount:    week7.length,
      weekVal:      week7.reduce((s, b) => s + b.valueAtRisk, 0),
      monthCount:   month30.length,
      monthVal:     month30.reduce((s, b) => s + b.valueAtRisk, 0),
      safeCount:    safe.length,
    };
  }, [allBatches]);

  /** Batches expiring on the selected day (respects filters). */
  const dayBatches = useMemo(() => {
    if (!selectedDay) return [];
    const key = format(selectedDay, 'yyyy-MM-dd');
    return filtered.filter(b => b.expiryDate.slice(0, 10) === key);
  }, [selectedDay, filtered]);

  const tableRows = useMemo(
    () => [...filtered].sort((a, b) =>
      sortAsc ? a.daysUntilExpiry - b.daysUntilExpiry : b.daysUntilExpiry - a.daysUntilExpiry
    ),
    [filtered, sortAsc]
  );

  const activeFilterCount = [
    drugFilter !== 'all',
    catFilter  !== 'all',
    urgency    !== 'all',
  ].filter(Boolean).length;

  const months = [windowStart, addMonths(windowStart, 1), addMonths(windowStart, 2)];

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6 space-y-5 animate-pulse">
        <div className="h-7 bg-gray-200 dark:bg-slate-700 rounded w-52" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-24 bg-gray-200 dark:bg-slate-700 rounded-xl" />)}
        </div>
        <div className="h-12 bg-gray-200 dark:bg-slate-700 rounded-xl" />
        <div className="h-80 bg-gray-200 dark:bg-slate-700 rounded-xl" />
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────
  if (!allBatches.length) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-96 text-center gap-3">
        <Package size={52} className="text-gray-200 dark:text-slate-700" />
        <p className="text-lg font-semibold text-gray-500 dark:text-slate-400">No batch data available.</p>
        <p className="text-sm text-gray-400 dark:text-slate-500">
          Ensure the database has been seeded with batch records.
        </p>
      </div>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 space-y-5">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <Calendar size={22} className="text-blue-600" />
        <h1 className="text-xl font-bold text-gray-800 dark:text-slate-100">Expiry Heatmap</h1>
        <span className="text-sm text-gray-400 dark:text-slate-500 ml-1">· {allBatches.length} batches tracked</span>
      </div>

      {/* ── Summary cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<AlertTriangle size={16} className="text-red-500" />}
          label="Expired"
          count={stats.expiredCount}
          sub={`₹${inr(stats.expiredVal)} at risk`}
          border="border-red-100"
          countCls="text-red-600"
        />
        <StatCard
          icon={<Clock size={16} className="text-orange-500" />}
          label="Expiring in 7 Days"
          count={stats.weekCount}
          sub={`₹${inr(stats.weekVal)} at risk`}
          border="border-orange-100"
          countCls="text-orange-500"
        />
        <StatCard
          icon={<Clock size={16} className="text-yellow-500" />}
          label="Expiring in 30 Days"
          count={stats.monthCount}
          sub={`₹${inr(stats.monthVal)} at risk`}
          border="border-yellow-100"
          countCls="text-yellow-600"
        />
        <StatCard
          icon={<Package size={16} className="text-green-500" />}
          label="Safe (>90 Days)"
          count={stats.safeCount}
          sub="No immediate risk"
          border="border-green-100"
          countCls="text-green-600"
        />
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={14} className="text-gray-400 dark:text-slate-500" />
          <span className="text-sm font-medium text-gray-600 dark:text-slate-300">Filters</span>
          {activeFilterCount > 0 && (
            <>
              <span className="bg-blue-600 text-white text-xs font-bold rounded-full px-2 py-0.5">
                {activeFilterCount}
              </span>
              <button
                onClick={() => { setDrugFilter('all'); setCatFilter('all'); setUrgency('all'); }}
                className="ml-auto flex items-center gap-1 text-xs text-blue-500 hover:underline"
              >
                <X size={11} /> Clear all
              </button>
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          {/* Drug dropdown */}
          <select
            value={drugFilter}
            onChange={e => setDrugFilter(e.target.value)}
            className="border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm text-gray-700 dark:text-slate-200 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            <option value="all">All Drugs</option>
            {drugOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>

          {/* Category dropdown */}
          <select
            value={catFilter}
            onChange={e => setCatFilter(e.target.value)}
            className="border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm text-gray-700 dark:text-slate-200 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            <option value="all">All Categories</option>
            {catOptions.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {/* Urgency pills */}
          <div className="flex gap-2 flex-wrap">
            {URGENCY_OPTS.map(({ val, label, active, inactive }) => (
              <button
                key={val}
                onClick={() => setUrgency(val)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  urgency === val ? active : inactive
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Calendar + Day detail panel ─────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-4">

        {/* Calendar */}
        <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm p-5">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-5">
            <button
              onClick={() => setWindowStart(prev => subMonths(prev, 1))}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-slate-400 transition"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm font-semibold text-gray-600 dark:text-slate-300">
              {format(windowStart, 'MMM yyyy')} — {format(addMonths(windowStart, 2), 'MMM yyyy')}
            </span>
            <button
              onClick={() => setWindowStart(prev => addMonths(prev, 1))}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-slate-400 transition"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Three month grids */}
          <div className="flex flex-col md:flex-row gap-6 md:gap-8">
            {months.map((m, i) => (
              <MonthGrid
                key={i}
                monthStart={m}
                byDay={byDay}
                selectedDay={selectedDay}
                onSelect={setSelectedDay}
              />
            ))}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 mt-5 pt-4 border-t border-gray-100">
            {LEGEND.map(([bg, label]) => (
              <div key={label} className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
                <div className={`w-3 h-3 rounded ${bg}`} />
                <span>{label}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
              <div className="w-3 h-3 rounded border-2 border-blue-300" />
              <span>Today</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
              <div className="w-3 h-3 rounded border-2 border-blue-500" />
              <span>Selected</span>
            </div>
          </div>
        </div>

        {/* Day detail panel */}
        {selectedDay && (
          <div className="lg:w-80 xl:w-96 bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm p-4 flex flex-col">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-gray-800 dark:text-slate-100 text-base">
                  {format(selectedDay, 'dd MMMM yyyy')}
                </h3>
                <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
                  {dayBatches.length === 0
                    ? 'No batches expiring (after filters)'
                    : `${dayBatches.length} batch${dayBatches.length > 1 ? 'es' : ''} expiring`}
                </p>
              </div>
              <button
                onClick={() => setSelectedDay(null)}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 dark:text-slate-500 shrink-0 mt-0.5 transition"
              >
                <X size={16} />
              </button>
            </div>

            {dayBatches.length === 0 ? (
              <div className="flex-1 flex items-center justify-center py-10">
                <p className="text-sm text-gray-300 dark:text-slate-600 text-center">
                  Nothing to show for this date.
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-3 flex-1 overflow-y-auto max-h-[420px] pr-1">
                  {dayBatches.map(b => {
                    const si = statusInfo(b.daysUntilExpiry);
                    return (
                      <div
                        key={b.batchId}
                        className="border border-gray-100 dark:border-slate-700 rounded-xl p-3.5 hover:border-gray-200 dark:hover:border-slate-600 transition"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <span className="text-sm font-semibold text-gray-800 dark:text-slate-100 leading-snug">
                            {b.drugName}
                          </span>
                          <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${si.cls}`}>
                            {si.label}
                          </span>
                        </div>

                        <p className="text-xs text-gray-400 dark:text-slate-500 font-mono mb-2.5">
                          #{b.batchNumber}
                        </p>

                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="bg-gray-50 dark:bg-slate-700 rounded-lg p-2">
                            <span className="text-gray-400 dark:text-slate-400 block mb-0.5">Quantity</span>
                            <span className="font-semibold text-gray-700 dark:text-slate-200">{b.quantity} units</span>
                          </div>
                          <div className="bg-gray-50 dark:bg-slate-700 rounded-lg p-2">
                            <span className="text-gray-400 dark:text-slate-400 block mb-0.5">Cost / Unit</span>
                            <span className="font-semibold text-gray-700 dark:text-slate-200">₹{b.costPerUnit}</span>
                          </div>
                        </div>

                        <div className="mt-2.5 flex items-center justify-between">
                          <span className="text-xs text-gray-500 dark:text-slate-400">Value at risk</span>
                          <span className="text-sm font-bold text-red-600">
                            ₹{inr(b.valueAtRisk)}
                          </span>
                        </div>

                        {b.daysUntilExpiry > 0 && (
                          <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
                            {b.daysUntilExpiry} day{b.daysUntilExpiry !== 1 ? 's' : ''} remaining
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Total value */}
                <div className="border-t border-gray-100 dark:border-slate-700 pt-3 mt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">
                      Total Value at Risk
                    </span>
                    <span className="text-base font-bold text-red-600">
                      ₹{inr(dayBatches.reduce((s, b) => s + b.valueAtRisk, 0))}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Expiry Timeline Table (collapsible) ─────────────────────────── */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden">
        <button
          onClick={() => setTableOpen(o => !o)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-slate-700 transition"
        >
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-gray-400 dark:text-slate-500" />
            <span className="font-semibold text-gray-700 dark:text-slate-200">Expiry Timeline</span>
            <span className="text-xs text-gray-400 dark:text-slate-500 font-normal">
              · {filtered.length} batch{filtered.length !== 1 ? 'es' : ''}
            </span>
          </div>
          {tableOpen
            ? <ChevronUp size={18} className="text-gray-400 dark:text-slate-500" />
            : <ChevronDown size={18} className="text-gray-400 dark:text-slate-500" />
          }
        </button>

        {tableOpen && (
          <div className="overflow-x-auto border-t border-gray-100 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-700">
                <tr>
                  {['Drug Name', 'Batch #', 'Qty', 'Expiry Date'].map(h => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap">
                    <button
                      className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-slate-300 transition"
                      onClick={() => setSortAsc(a => !a)}
                    >
                      Days Left
                      {sortAsc
                        ? <ChevronUp size={11} />
                        : <ChevronDown size={11} />
                      }
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide whitespace-nowrap">
                    Value at Risk (₹)
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                    Status
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-50 dark:divide-slate-700">
                {tableRows.map(b => {
                  const si = statusInfo(b.daysUntilExpiry);
                  return (
                    <tr
                      key={b.batchId}
                      className="hover:bg-blue-50 dark:hover:bg-slate-700 cursor-pointer transition group"
                      onClick={() => {
                        setSelectedDay(parseISO(b.expiryDate));
                        setTableOpen(false);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      <td className="px-4 py-3 font-medium text-gray-800 dark:text-slate-100 group-hover:text-blue-600 transition">
                        {b.drugName}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-slate-400">
                        {b.batchNumber}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-slate-300">{b.quantity}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-slate-400 whitespace-nowrap">
                        {format(parseISO(b.expiryDate), 'dd MMM yyyy')}
                      </td>
                      <td className="px-4 py-3 font-medium whitespace-nowrap">
                        {b.daysUntilExpiry <= 0
                          ? <span className="text-red-500">Expired</span>
                          : <span className="text-gray-700 dark:text-slate-300">{b.daysUntilExpiry}d</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-700 dark:text-slate-200">
                        ₹{inr(b.valueAtRisk)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${si.cls}`}>
                          {si.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
