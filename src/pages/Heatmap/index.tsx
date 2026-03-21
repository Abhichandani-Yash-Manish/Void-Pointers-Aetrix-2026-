import { useState, useEffect, useMemo } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  differenceInDays,
  addMonths,
  subMonths,
  parseISO,
  isToday,
  getDay,
} from 'date-fns';
import {
  Calendar,
  AlertTriangle,
  Clock,
  Package,
  IndianRupee,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Filter,
  X,
} from 'lucide-react';
import { db } from '../../config/firebase';
import type { Drug, Batch } from '../../types';

// ── Local types ───────────────────────────────────────────────────────────────

interface FlatBatch {
  drugId:          string;
  drugName:        string;
  drugCategory:    string;
  batchNumber:     string;
  quantity:        number;
  expiryDate:      string;   // 'YYYY-MM-DD'
  costPerUnit:     number;
  daysUntilExpiry: number;   // negative = already expired
  valueAtRisk:     number;   // quantity × costPerUnit
}

type UrgencyFilter = 'all' | 'expired' | '7' | '30' | '90';

// ── Pure helpers ──────────────────────────────────────────────────────────────

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

function calcDays(expiryDate: string): number {
  try {
    return differenceInDays(parseISO(expiryDate), TODAY);
  } catch {
    return 9999;
  }
}

/** Left-pad days to align week to Mon=0 … Sun=6 */
function weekPad(monthStart: Date): number {
  const d = getDay(monthStart); // 0=Sun … 6=Sat
  return d === 0 ? 6 : d - 1;
}

/** Cell background colour driven by urgency of the nearest-expiring batch. */
function cellBg(batches: FlatBatch[]): string {
  if (batches.length === 0) return '';
  const min  = Math.min(...batches.map(b => b.daysUntilExpiry));
  const rank = Math.min(batches.length, 3); // 1, 2 or 3+

  const shades: Record<string, string[]> = {
    red:    ['bg-red-400',    'bg-red-500',    'bg-red-600'],
    orange: ['bg-orange-300', 'bg-orange-400', 'bg-orange-500'],
    yellow: ['bg-yellow-300', 'bg-yellow-400', 'bg-yellow-500'],
    green:  ['bg-green-300',  'bg-green-400',  'bg-green-500'],
  };

  const key = min <= 0 ? 'red' : min < 7 ? 'orange' : min < 30 ? 'yellow' : 'green';
  return shades[key][rank - 1];
}

/** Text colour for urgency labels. */
function urgencyTextColor(days: number): string {
  if (days < 0)  return 'text-red-600';
  if (days < 7)  return 'text-orange-600';
  if (days < 30) return 'text-yellow-600';
  if (days < 90) return 'text-green-600';
  return 'text-slate-500';
}

/** Badge classes for table status column. */
function statusBadge(days: number): string {
  if (days < 0)  return 'bg-red-100 text-red-700 border border-red-200';
  if (days < 7)  return 'bg-orange-100 text-orange-700 border border-orange-200';
  if (days < 30) return 'bg-yellow-100 text-yellow-700 border border-yellow-200';
  return 'bg-green-100 text-green-700 border border-green-200';
}

function statusLabel(days: number): string {
  if (days < 0)  return 'EXPIRED';
  if (days < 7)  return 'CRITICAL';
  if (days < 30) return 'WARNING';
  return 'OK';
}

function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-100 rounded-lg ${className ?? ''}`} />;
}

function PageSkeleton() {
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Skeleton className="h-8 w-56 mb-2" />
      <Skeleton className="h-4 w-72 mb-6" />
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}
      </div>
      <Skeleton className="h-12 mb-4" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-64" />)}
      </div>
    </div>
  );
}

// ── Month calendar grid ────────────────────────────────────────────────────────

interface MonthGridProps {
  month:          Date;
  batchesByDay:   Map<string, FlatBatch[]>;
  selectedDate:   Date | null;
  onSelectDate:   (d: Date) => void;
}

function MonthGrid({ month, batchesByDay, selectedDate, onSelectDate }: MonthGridProps) {
  const days    = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
  const padCells = weekPad(days[0]);
  const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      {/* Month name */}
      <h3 className="text-sm font-semibold text-slate-700 mb-3 text-center">
        {format(month, 'MMMM yyyy')}
      </h3>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 mb-1">
        {DOW_LABELS.map(d => (
          <div key={d} className="text-center text-[10px] font-semibold text-slate-400 py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-0.5">
        {/* Pad empty cells before the 1st */}
        {[...Array(padCells)].map((_, i) => <div key={`pad-${i}`} />)}

        {days.map(day => {
          const key      = format(day, 'yyyy-MM-dd');
          const dayBatch = batchesByDay.get(key) ?? [];
          const bg       = cellBg(dayBatch);
          const isSelected = selectedDate && isSameDay(day, selectedDate);
          const todayDay   = isToday(day);
          const totalVal   = dayBatch.reduce((s, b) => s + b.valueAtRisk, 0);

          return (
            <div key={key} className="group relative">
              <button
                onClick={() => onSelectDate(day)}
                className={[
                  'w-full aspect-square flex items-center justify-center rounded-md text-xs font-medium transition-all',
                  bg || 'hover:bg-slate-100',
                  bg ? 'text-white hover:brightness-90' : 'text-slate-600',
                  isSelected  ? 'ring-2 ring-blue-500 ring-offset-1' : '',
                  todayDay    ? 'ring-2 ring-slate-400 ring-offset-1' : '',
                ].filter(Boolean).join(' ')}
              >
                {format(day, 'd')}
                {dayBatch.length > 1 && (
                  <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-white/70" />
                )}
              </button>

              {/* Hover tooltip */}
              {dayBatch.length > 0 && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-30 hidden group-hover:block pointer-events-none">
                  <div className="bg-slate-800 text-white text-[10px] rounded-lg px-2.5 py-1.5 whitespace-nowrap shadow-lg">
                    <p className="font-semibold">{format(day, 'dd MMM')}</p>
                    <p>{dayBatch.length} batch{dayBatch.length !== 1 ? 'es' : ''} expiring</p>
                    {totalVal > 0 && <p className="text-yellow-300">{formatRupees(totalVal)} at risk</p>}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function HeatmapPage() {

  // ── State ──────────────────────────────────────────────────────────────────
  const [allBatches, setAllBatches] = useState<FlatBatch[]>([]);
  const [loading, setLoading]       = useState(true);

  const [viewMonth, setViewMonth]   = useState<Date>(startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const [filterDrug,     setFilterDrug]     = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterUrgency,  setFilterUrgency]  = useState<UrgencyFilter>('all');

  const [showTable, setShowTable]   = useState(false);
  const [tableSortAsc, setTableSortAsc] = useState(true);

  // ── Data loading ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const drugsSnap = await getDocs(collection(db, 'drugs'));
        const drugs: Drug[] = drugsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Drug));

        // Fetch all batch subcollections in parallel
        const batchResults = await Promise.all(
          drugs.map(async drug => {
            const snap = await getDocs(collection(db, 'drugs', drug.id, 'batches'));
            return snap.docs.map(d => {
              const b = { id: d.id, ...d.data() } as Batch & { id: string };
              return {
                drugId:          drug.id,
                drugName:        drug.name,
                drugCategory:    drug.category,
                batchNumber:     b.batchNumber,
                quantity:        b.quantity,
                expiryDate:      b.expiryDate,
                costPerUnit:     b.costPerUnit,
                daysUntilExpiry: calcDays(b.expiryDate),
                valueAtRisk:     Math.round(b.quantity * b.costPerUnit),
              } satisfies FlatBatch;
            });
          }),
        );

        if (cancelled) return;

        const flat = batchResults.flat()
          .filter(b => b.quantity > 0)           // skip depleted
          .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

        setAllBatches(flat);
      } catch (err) {
        console.error('Heatmap load error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // ── Derived filter options ─────────────────────────────────────────────────
  const drugs      = useMemo(() => {
    const seen = new Map<string, string>();
    allBatches.forEach(b => seen.set(b.drugId, b.drugName));
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [allBatches]);

  const categories = useMemo(() => {
    const s = new Set(allBatches.map(b => b.drugCategory));
    return [...s].sort();
  }, [allBatches]);

  // ── Filtered batches ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return allBatches.filter(b => {
      if (filterDrug !== 'all' && b.drugId !== filterDrug) return false;
      if (filterCategory !== 'all' && b.drugCategory !== filterCategory) return false;
      if (filterUrgency === 'expired' && b.daysUntilExpiry >= 0) return false;
      if (filterUrgency === '7'       && (b.daysUntilExpiry < 0 || b.daysUntilExpiry >= 7))  return false;
      if (filterUrgency === '30'      && (b.daysUntilExpiry < 0 || b.daysUntilExpiry >= 30)) return false;
      if (filterUrgency === '90'      && (b.daysUntilExpiry < 0 || b.daysUntilExpiry >= 90)) return false;
      return true;
    });
  }, [allBatches, filterDrug, filterCategory, filterUrgency]);

  const activeFilterCount = [
    filterDrug !== 'all',
    filterCategory !== 'all',
    filterUrgency !== 'all',
  ].filter(Boolean).length;

  // ── Batches grouped by day (for calendar) ─────────────────────────────────
  const batchesByDay = useMemo(() => {
    const map = new Map<string, FlatBatch[]>();
    for (const b of filtered) {
      if (!map.has(b.expiryDate)) map.set(b.expiryDate, []);
      map.get(b.expiryDate)!.push(b);
    }
    return map;
  }, [filtered]);

  // ── Summary stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const expired = filtered.filter(b => b.daysUntilExpiry <  0);
    const in7     = filtered.filter(b => b.daysUntilExpiry >= 0 && b.daysUntilExpiry < 7);
    const in30    = filtered.filter(b => b.daysUntilExpiry >= 7 && b.daysUntilExpiry < 30);
    const safe    = filtered.filter(b => b.daysUntilExpiry >= 90);
    const sum     = (arr: FlatBatch[]) => arr.reduce((s, b) => s + b.valueAtRisk, 0);
    return { expired, in7, in30, safe, sum };
  }, [filtered]);

  // ── Selected day batches ───────────────────────────────────────────────────
  const selectedBatches = useMemo(() => {
    if (!selectedDate) return [];
    const key = format(selectedDate, 'yyyy-MM-dd');
    return batchesByDay.get(key) ?? [];
  }, [selectedDate, batchesByDay]);

  // ── Table data ─────────────────────────────────────────────────────────────
  const tableRows = useMemo(() => {
    return [...filtered].sort((a, b) =>
      tableSortAsc
        ? a.daysUntilExpiry - b.daysUntilExpiry
        : b.daysUntilExpiry - a.daysUntilExpiry,
    );
  }, [filtered, tableSortAsc]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return <PageSkeleton />;

  // ── Empty state ────────────────────────────────────────────────────────────
  if (allBatches.length === 0) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Expiry Heatmap</h1>
        <div className="mt-16 text-center">
          <Calendar size={48} className="mx-auto text-slate-200 mb-4" />
          <p className="text-slate-500">No batch data available.</p>
          <p className="text-slate-400 text-sm mt-1">Ensure the database has been seeded from the Dashboard.</p>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const months = [viewMonth, addMonths(viewMonth, 1), addMonths(viewMonth, 2)];

  return (
    <div className="p-6 max-w-6xl mx-auto">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Expiry Heatmap</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Calendar view of batch expiry dates — identify waste risk at a glance
          </p>
        </div>
        {/* Legend */}
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          {[
            { bg: 'bg-red-400',    label: 'Expired / Today' },
            { bg: 'bg-orange-400', label: '< 7 days' },
            { bg: 'bg-yellow-400', label: '< 30 days' },
            { bg: 'bg-green-400',  label: '< 90 days' },
          ].map(({ bg, label }) => (
            <span key={label} className="flex items-center gap-1 text-slate-600">
              <span className={`w-3 h-3 rounded-sm ${bg}`} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* ── Summary cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {[
          {
            label:   'Expired',
            count:   stats.expired.length,
            value:   stats.sum(stats.expired),
            bg:      'bg-red-50 border-red-200',
            iconBg:  'bg-red-100',
            icon:    <AlertTriangle size={17} className="text-red-500" />,
            numCls:  'text-red-700',
          },
          {
            label:   'Expiring < 7 Days',
            count:   stats.in7.length,
            value:   stats.sum(stats.in7),
            bg:      'bg-orange-50 border-orange-200',
            iconBg:  'bg-orange-100',
            icon:    <Clock size={17} className="text-orange-500" />,
            numCls:  'text-orange-700',
          },
          {
            label:   'Expiring < 30 Days',
            count:   stats.in30.length,
            value:   stats.sum(stats.in30),
            bg:      'bg-yellow-50 border-yellow-200',
            iconBg:  'bg-yellow-100',
            icon:    <Clock size={17} className="text-yellow-600" />,
            numCls:  'text-yellow-700',
          },
          {
            label:   'Safe (> 90 Days)',
            count:   stats.safe.length,
            value:   null,
            bg:      'bg-green-50 border-green-200',
            iconBg:  'bg-green-100',
            icon:    <Package size={17} className="text-green-600" />,
            numCls:  'text-green-700',
          },
        ].map(({ label, count, value, bg, iconBg, icon, numCls }) => (
          <div key={label} className={`rounded-xl border p-4 shadow-sm ${bg}`}>
            <div className="flex items-center justify-between mb-2">
              <div className={`p-2 rounded-lg ${iconBg}`}>{icon}</div>
            </div>
            <p className={`text-2xl font-bold ${numCls}`}>{count}</p>
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
            {value !== null && value > 0 && (
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-0.5">
                <IndianRupee size={10} />{value.toLocaleString('en-IN')} at risk
              </p>
            )}
          </div>
        ))}
      </div>

      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5 shadow-sm">
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <Filter size={13} />
            Filters
            {activeFilterCount > 0 && (
              <span className="bg-blue-600 text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold">
                {activeFilterCount}
              </span>
            )}
          </div>

          {/* Drug dropdown */}
          <select
            value={filterDrug}
            onChange={e => setFilterDrug(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
          >
            <option value="all">All Drugs</option>
            {drugs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>

          {/* Category dropdown */}
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
          >
            <option value="all">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Reset */}
          {activeFilterCount > 0 && (
            <button
              onClick={() => { setFilterDrug('all'); setFilterCategory('all'); setFilterUrgency('all'); }}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 transition-colors"
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>

        {/* Urgency pills */}
        <div className="flex items-center gap-2 flex-wrap">
          {(
            [
              { key: 'all',     label: 'All' },
              { key: 'expired', label: 'Expired' },
              { key: '7',       label: '< 7 days' },
              { key: '30',      label: '< 30 days' },
              { key: '90',      label: '< 90 days' },
            ] as { key: UrgencyFilter; label: string }[]
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilterUrgency(key)}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                filterUrgency === key
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
          <span className="text-xs text-slate-400 ml-auto">
            {filtered.length} batch{filtered.length !== 1 ? 'es' : ''} shown
          </span>
        </div>
      </div>

      {/* ── Calendar + Detail panel ────────────────────────────────────────── */}
      <div className="mb-5">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setViewMonth(m => subMonths(m, 1))}
            className="flex items-center gap-1 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <ChevronLeft size={15} /> Prev
          </button>
          <span className="text-sm font-medium text-slate-600">
            {format(viewMonth, 'MMM yyyy')} — {format(addMonths(viewMonth, 2), 'MMM yyyy')}
          </span>
          <button
            onClick={() => setViewMonth(m => addMonths(m, 1))}
            className="flex items-center gap-1 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Next <ChevronRight size={15} />
          </button>
        </div>

        {/* 3-month grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {months.map(m => (
            <MonthGrid
              key={format(m, 'yyyy-MM')}
              month={m}
              batchesByDay={batchesByDay}
              selectedDate={selectedDate}
              onSelectDate={d => setSelectedDate(prev => prev && isSameDay(prev, d) ? null : d)}
            />
          ))}
        </div>

        {/* ── Day detail panel ────────────────────────────────────────────── */}
        {selectedDate && (
          <div className="mt-4 bg-white border border-blue-200 rounded-xl shadow-sm overflow-hidden">
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-3 bg-blue-50 border-b border-blue-200">
              <div className="flex items-center gap-2">
                <Calendar size={15} className="text-blue-600" />
                <span className="text-sm font-semibold text-blue-800">
                  {format(selectedDate, 'EEEE, dd MMMM yyyy')}
                </span>
                <span className="text-xs text-blue-600">
                  — {selectedBatches.length} batch{selectedBatches.length !== 1 ? 'es' : ''} expiring
                </span>
              </div>
              <button
                onClick={() => setSelectedDate(null)}
                className="text-blue-400 hover:text-blue-600 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {selectedBatches.length === 0 ? (
              <div className="px-5 py-8 text-center text-slate-400 text-sm">
                No batches expire on this date.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {selectedBatches.map(b => (
                  <div key={b.batchNumber + b.drugId} className="px-5 py-4 flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{b.drugName}</p>
                      <p className="text-xs text-slate-400 mt-0.5">Batch: {b.batchNumber}</p>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500 flex-wrap">
                        <span>Qty: <strong className="text-slate-700">{b.quantity}</strong></span>
                        <span>Cost/unit: <strong className="text-slate-700">₹{b.costPerUnit}</strong></span>
                        <span className={`font-semibold ${urgencyTextColor(b.daysUntilExpiry)}`}>
                          {b.daysUntilExpiry < 0
                            ? `Expired ${Math.abs(b.daysUntilExpiry)}d ago`
                            : b.daysUntilExpiry === 0
                            ? 'Expires today!'
                            : `${b.daysUntilExpiry} days left`}
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="flex items-center gap-1 justify-end font-semibold text-slate-700 text-sm">
                        <IndianRupee size={13} />
                        {b.valueAtRisk.toLocaleString('en-IN')}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">value at risk</p>
                    </div>
                  </div>
                ))}

                {/* Total */}
                <div className="px-5 py-3 bg-slate-50 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                    Total Value at Risk
                  </span>
                  <div className="flex items-center gap-1 text-base font-bold text-red-600">
                    <IndianRupee size={15} />
                    {selectedBatches.reduce((s, b) => s + b.valueAtRisk, 0).toLocaleString('en-IN')}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Expiry Timeline Table ─────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <button
          onClick={() => setShowTable(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <AlertTriangle size={15} className="text-slate-400" />
            Expiry Timeline — All Batches
            <span className="text-xs font-normal text-slate-400">({tableRows.length})</span>
          </div>
          {showTable ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>

        {showTable && (
          <div className="border-t border-slate-100 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Drug</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Batch #</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Qty</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Expiry Date</th>
                  <th
                    className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right cursor-pointer select-none hover:text-blue-600 transition-colors"
                    onClick={() => setTableSortAsc(v => !v)}
                  >
                    Days Left {tableSortAsc ? '↑' : '↓'}
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Value at Risk</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {tableRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">
                      No batches match the current filters.
                    </td>
                  </tr>
                ) : tableRows.map(b => (
                  <tr
                    key={b.drugId + b.batchNumber}
                    className="hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => {
                      try {
                        const d = parseISO(b.expiryDate);
                        setSelectedDate(d);
                        setViewMonth(startOfMonth(d));
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      } catch { /* ignore */ }
                    }}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800 truncate max-w-[160px]">{b.drugName}</p>
                      <p className="text-[11px] text-slate-400">{b.drugCategory}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600 font-mono text-xs">{b.batchNumber}</td>
                    <td className="px-4 py-3 text-right text-slate-700 font-medium">{b.quantity}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs whitespace-nowrap">
                      {format(parseISO(b.expiryDate), 'dd MMM yyyy')}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${urgencyTextColor(b.daysUntilExpiry)}`}>
                      {b.daysUntilExpiry < 0
                        ? `−${Math.abs(b.daysUntilExpiry)}`
                        : b.daysUntilExpiry === 0
                        ? 'Today'
                        : b.daysUntilExpiry}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="flex items-center justify-end gap-0.5 text-slate-700 font-medium">
                        <IndianRupee size={11} />{b.valueAtRisk.toLocaleString('en-IN')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${statusBadge(b.daysUntilExpiry)}`}>
                        {statusLabel(b.daysUntilExpiry)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* Table footer — total value */}
              {tableRows.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50">
                    <td colSpan={5} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Total Value at Risk
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="flex items-center justify-end gap-0.5 font-bold text-red-600">
                        <IndianRupee size={13} />
                        {tableRows.reduce((s, b) => s + b.valueAtRisk, 0).toLocaleString('en-IN')}
                      </span>
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
