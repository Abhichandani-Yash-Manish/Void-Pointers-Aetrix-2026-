import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { startOfWeek, format, parseISO, subMonths, isAfter } from 'date-fns';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Package,
  Activity,
  RefreshCw,
  ChevronDown,
  Loader2,
  Terminal,
  CheckCircle2,
  BarChart2,
} from 'lucide-react';
import { db } from '../../config/firebase';
import { API_BASE } from '../../config/api';
import type { Drug, DispenseLog } from '../../types';

// ── Chart.js registration ─────────────────────────────────────────────────────
ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Title, Tooltip, Legend, Filler,
);

// ── Constants ─────────────────────────────────────────────────────────────────
const FETCH_TIMEOUT = 5000; // ms before marking backend unreachable
const MAX_RETRIES   = 6;    // 6 × 10 s = 60 s max wait for Render cold start

// ── Local types ───────────────────────────────────────────────────────────────

interface WeeklyPoint {
  date:     string;   // 'YYYY-MM-DD'
  quantity: number;
}

interface PredictionMetrics {
  r2_score:           number;
  mape:               number;
  trend:              'increasing' | 'decreasing' | 'stable';
  slope:              number;
  intercept:          number;
  mae?:               number;
  smape?:             number;
  relative_slope_pct?: number;
  avg_weekly_demand?: number;
}

interface ReorderSuggestion {
  should_reorder:      boolean;
  suggested_quantity:  number;
  days_until_stockout: number;
  reason:              string;
}

interface PredictionResult {
  drugId:              string;
  drugName:            string;
  predictions:         { date: string; predicted_quantity: number }[];
  metrics:             PredictionMetrics;
  reorder_suggestion:  ReorderSuggestion;
}

interface PredictionError {
  drugId: string;
  error:  string;
}

type PredictionItem = PredictionResult | PredictionError;

function isPredictionResult(item: PredictionItem): item is PredictionResult {
  return !('error' in item);
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Aggregate raw dispense logs into weekly totals per drug (last 6 months). */
function aggregateWeekly(logs: DispenseLog[]): Map<string, WeeklyPoint[]> {
  const cutoff = subMonths(new Date(), 6);

  // Group: drugId → weekStart → total quantity
  const map = new Map<string, Map<string, number>>();

  for (const log of logs) {
    try {
      const ts = parseISO(log.timestamp);
      if (!isAfter(ts, cutoff)) continue;
      const week = format(startOfWeek(ts, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      if (!map.has(log.drugId)) map.set(log.drugId, new Map());
      const wm = map.get(log.drugId)!;
      wm.set(week, (wm.get(week) ?? 0) + log.quantity);
    } catch {
      // skip malformed timestamps
    }
  }

  // Convert to sorted arrays
  const result = new Map<string, WeeklyPoint[]>();
  for (const [drugId, wm] of map) {
    result.set(
      drugId,
      Array.from(wm.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, quantity]) => ({ date, quantity })),
    );
  }
  return result;
}

/** Classify urgency for display / sorting. */
function urgency(dos: number): 'critical' | 'soon' | 'monitor' | 'ok' {
  if (dos <  7) return 'critical';
  if (dos < 14) return 'soon';
  if (dos < 30) return 'monitor';
  return 'ok';
}

/** Tailwind classes for urgency badge. */
const URGENCY_BADGE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 border border-red-200',
  soon:     'bg-yellow-100 text-yellow-700 border border-yellow-200',
  monitor:  'bg-orange-100 text-orange-700 border border-orange-200',
  ok:       'bg-green-100 text-green-700 border border-green-200',
};

/** Human-readable urgency label. */
const URGENCY_LABEL: Record<string, string> = {
  critical: 'Critical',
  soon:     'Soon',
  monitor:  'Monitor',
  ok:       'OK',
};

/** Left-border colour for urgency card. */
function dosCardClass(dos: number | null): string {
  if (dos === null)  return 'border-slate-200';
  if (dos < 7)       return 'border-red-400';
  if (dos < 14)      return 'border-yellow-400';
  return 'border-green-300';
}

/** r2 badge colour. */
function r2Color(r2: number): string {
  if (r2 > 0.7)  return 'bg-green-100 text-green-700';
  if (r2 > 0.4)  return 'bg-yellow-100 text-yellow-700';
  return 'bg-red-100 text-red-700';
}

/** MAPE badge colour. */
function mapeColor(mape: number): string {
  if (mape < 10)  return 'bg-green-100 text-green-700';
  if (mape < 20)  return 'bg-yellow-100 text-yellow-700';
  return 'bg-red-100 text-red-700';
}

/** Days-until-stockout badge colour. */
function dosColor(dos: number): string {
  if (dos < 14) return 'text-red-600';
  if (dos < 30) return 'text-yellow-600';
  return 'text-green-600';
}

// ── SparklineCard ──────────────────────────────────────────────────────────────

interface SparklineCardProps {
  drug:       Drug;
  history:    WeeklyPoint[];
  prediction: PredictionResult | null;
  onClick:    () => void;
}

function SparklineCard({ drug, history, prediction, onClick }: SparklineCardProps) {
  const dos   = prediction?.reorder_suggestion.days_until_stockout ?? null;
  const trend = prediction?.metrics.trend ?? null;

  const last8      = history.slice(-8);
  const lineColor  = dos !== null && dos < 14
    ? 'rgb(239, 68, 68)'
    : 'rgb(59, 130, 246)';

  const sparkData = {
    labels:   last8.map(h => h.date),
    datasets: [{
      data:        last8.map(h => h.quantity),
      borderColor: lineColor,
      borderWidth: 1.5,
      pointRadius: 0,
      fill:        false,
      tension:     0.3,
    }],
  };

  const sparkOpts = {
    responsive:          true,
    maintainAspectRatio: false,
    animation:           { duration: 0 },
    plugins: {
      legend:  { display: false },
      tooltip: { enabled: false },
    },
    scales: {
      x: { display: false },
      y: { display: false, beginAtZero: false },
    },
  };

  const TrendIcon = trend === 'increasing' ? TrendingUp
    : trend === 'decreasing'              ? TrendingDown
    : Minus;
  const trendColor = trend === 'increasing' ? 'text-green-500'
    : trend === 'decreasing'               ? 'text-red-500'
    : 'text-slate-400';

  return (
    <button
      onClick={onClick}
      className={`text-left p-4 bg-white rounded-xl border-2 shadow-sm hover:shadow-md transition-all active:scale-[0.98] ${dosCardClass(dos)}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800 truncate leading-tight">{drug.name}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">{drug.category}</p>
        </div>
        <TrendIcon size={15} className={`shrink-0 mt-0.5 ${trendColor}`} />
      </div>

      {/* Sparkline */}
      <div className="h-14 mb-2">
        {last8.length > 1 ? (
          <Line data={sparkData as any} options={sparkOpts as any} />
        ) : (
          <div className="h-full flex items-center justify-center text-[11px] text-slate-300">
            No history
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-500">
          {drug.currentStock} <span className="text-slate-400">{drug.unit}</span>
        </span>
        {dos !== null ? (
          <span className={`font-bold ${dosColor(dos)}`}>
            {dos > 999 ? '∞' : `~${dos}d`}
          </span>
        ) : (
          <span className="text-slate-300 italic">no forecast</span>
        )}
      </div>
    </button>
  );
}

// ── Loading skeleton ────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-100 rounded-lg ${className ?? ''}`} />;
}

function LoadingSkeleton() {
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Skeleton className="h-8 w-56 mb-2" />
      <Skeleton className="h-4 w-80 mb-6" />
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16" />)}
      </div>
      <Skeleton className="h-10 w-64 mb-6" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40" />)}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ForecastPage() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [drugs, setDrugs]                 = useState<Drug[]>([]);
  const [loading, setLoading]             = useState(true);
  const [backendStatus, setBackendStatus] = useState<'checking' | 'retrying' | 'connected' | 'failed'>('checking');
  const [retryCount, setRetryCount]       = useState(0);
  const [countdown, setCountdown]         = useState(10);
  const [showConnected, setShowConnected] = useState(false);
  const [retryKey, setRetryKey]           = useState(0);
  const retryAttemptRef                   = useRef(0);

  const [weeklyHistory, setWeeklyHistory] = useState<Map<string, WeeklyPoint[]>>(new Map());
  const [predMap, setPredMap]             = useState<Map<string, PredictionResult>>(new Map());

  const [selectedId, setSelectedId]       = useState<string | null>(null); // null = overview
  const [reorderOnly, setReorderOnly]     = useState(false);

  // ── Data loading effect ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBackendStatus('checking');

    async function load() {
      try {
        // 1. Fetch drugs + dispense logs in parallel
        const [drugsSnap, logsSnap] = await Promise.all([
          getDocs(collection(db, 'drugs')),
          getDocs(collection(db, 'dispenseLogs')),
        ]);

        if (cancelled) return;

        const drugList: Drug[] = drugsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Drug));
        drugList.sort((a, b) => a.name.localeCompare(b.name));
        setDrugs(drugList);

        const logList: DispenseLog[] = logsSnap.docs.map(d => ({ id: d.id, ...d.data() } as DispenseLog));

        // 2. Aggregate weekly history per drug
        const weekly = aggregateWeekly(logList);
        if (cancelled) return;
        setWeeklyHistory(weekly);

        // 3. Build payload for Flask API
        const payload = {
          drugs: drugList.map(drug => ({
            drugId:       drug.id,
            drugName:     drug.name,
            currentStock: drug.currentStock,
            reorderLevel: drug.reorderLevel,
            history:      weekly.get(drug.id) ?? [],
          })),
        };

        // 4. Call Flask with timeout
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

        const res = await fetch(`${API_BASE}/api/predict-all`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
          signal:  controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) throw new Error(`Backend returned ${res.status}`);

        const items: PredictionItem[] = await res.json();
        if (cancelled) return;

        const newMap = new Map<string, PredictionResult>();
        for (const item of items) {
          if (isPredictionResult(item)) newMap.set(item.drugId, item);
        }
        setPredMap(newMap);
        retryAttemptRef.current = 0;
        setBackendStatus('connected');
      } catch (err) {
        if (cancelled) return;
        console.warn('Forecast backend unreachable:', err);
        retryAttemptRef.current += 1;
        if (retryAttemptRef.current > MAX_RETRIES) {
          setBackendStatus('failed');
        } else {
          setRetryCount(retryAttemptRef.current);
          setBackendStatus('retrying');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [retryKey]);

  // ── Auto-retry countdown ───────────────────────────────────────────────────
  useEffect(() => {
    if (backendStatus !== 'retrying') return;
    setCountdown(10);
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          setRetryKey(k => k + 1);
          return 10;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [backendStatus]);

  // ── Flash "connected" banner for 2 s then dismiss ─────────────────────────
  useEffect(() => {
    if (backendStatus !== 'connected') return;
    setShowConnected(true);
    const t = setTimeout(() => setShowConnected(false), 2000);
    return () => clearTimeout(t);
  }, [backendStatus]);

  // ── Derived / computed values ──────────────────────────────────────────────
  const selectedDrug = useMemo(
    () => drugs.find(d => d.id === selectedId) ?? null,
    [drugs, selectedId],
  );
  const selectedPred = selectedId ? predMap.get(selectedId) ?? null : null;
  const selectedHistory = selectedId ? (weeklyHistory.get(selectedId) ?? []) : [];

  // Overview summary counts
  const needsReorder   = [...predMap.values()].filter(p => p.reorder_suggestion.should_reorder).length;
  const trendingUp     = [...predMap.values()].filter(p => p.metrics.trend === 'increasing').length;
  const trendingStable = [...predMap.values()].filter(p => p.metrics.trend === 'stable').length;

  // Reorder table data — all drugs sorted by urgency
  const reorderRows = useMemo(() => {
    return drugs
      .map(drug => {
        const pred = predMap.get(drug.id) ?? null;
        const dos  = pred?.reorder_suggestion.days_until_stockout ?? 9999;
        const pred30 = pred
          ? Math.round(pred.predictions.reduce((s, p) => s + p.predicted_quantity, 0))
          : null;
        return { drug, pred, dos, pred30 };
      })
      .filter(row => !reorderOnly || (row.pred?.reorder_suggestion.should_reorder === true))
      .sort((a, b) => a.dos - b.dos);
  }, [drugs, predMap, reorderOnly]);

  // ── Hero chart data ────────────────────────────────────────────────────────
  const heroChartData = useMemo(() => {
    if (!selectedPred || selectedHistory.length === 0) return null;

    const histDates = selectedHistory.map(h => h.date);
    const predDates = selectedPred.predictions.map(p => p.date);
    const allDates  = [...histDates, ...predDates];
    const labels    = allDates.map(d => format(parseISO(d), 'dd MMM'));

    const n = selectedHistory.length;
    const { slope, intercept } = selectedPred.metrics;

    // Dataset 1: historical scatter points (null for prediction weeks)
    const histPoints = allDates.map(d =>
      histDates.includes(d)
        ? selectedHistory.find(h => h.date === d)!.quantity
        : null,
    );

    // Dataset 2: regression trend line — two endpoints spanning the historical period
    // Uses slope/intercept from the Flask model (week-index x-axis: 0, 1, …, n-1)
    const trendLine = allDates.map((_, i) =>
      i < n ? +(intercept + slope * i).toFixed(2) : null,
    );

    // Dataset 3: prediction points (null for historical weeks)
    const predPoints = allDates.map(d => {
      const p = selectedPred.predictions.find(x => x.date === d);
      return p ? p.predicted_quantity : null;
    });

    const datasets: any[] = [
      {
        // Scatter dots for historical data — no connecting line
        label:                'Historical demand',
        data:                 histPoints,
        showLine:             false,
        pointRadius:          4,
        pointHoverRadius:     6,
        pointBackgroundColor: 'rgb(59, 130, 246)',
        pointBorderColor:     'rgb(59, 130, 246)',
        spanGaps:             false,
      },
      {
        // Thin trend line through the historical period (slope from ML model)
        label:       'Trend',
        data:        trendLine,
        borderColor: 'rgba(59, 130, 246, 0.3)',
        borderWidth: 1.5,
        pointRadius: 0,
        fill:        false,
        spanGaps:    false,
        tension:     0,
      },
      {
        // Dashed prediction line with amber dots
        label:                'Predicted demand',
        data:                 predPoints,
        borderColor:          'rgb(245, 158, 11)',
        backgroundColor:      'rgba(245, 158, 11, 0.1)',
        borderDash:           [6, 4],
        borderWidth:          2,
        pointRadius:          5,
        pointHoverRadius:     7,
        pointBackgroundColor: 'rgb(245, 158, 11)',
        pointBorderColor:     'rgb(245, 158, 11)',
        fill:                 false,
        spanGaps:             false,
        tension:              0,
      },
    ];

    return { labels, datasets };
  }, [selectedPred, selectedHistory]);

  const heroChartOptions: any = useMemo(() => ({
    responsive:          true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display:  true,
        position: 'top' as const,
        labels: {
          usePointStyle: true,
          font:          { size: 12 },
          color:         '#475569',
          padding:       16,
        },
      },
      title: {
        display: true,
        text:    selectedDrug ? `${selectedDrug.name} — Demand Forecast` : '',
        font:    { size: 14, weight: 'bold' as const },
        color:   '#1e293b',
        padding: { bottom: 12 },
      },
      tooltip: {
        mode:      'nearest' as const,
        intersect: true,
        callbacks: {
          label: (ctx: any) => {
            const v = ctx.parsed.y;
            if (v === null || v === undefined) return '';
            if (ctx.dataset.label === 'Historical demand')
              return `Week of ${ctx.label}: ${v} units`;
            if (ctx.dataset.label === 'Predicted demand')
              return `Predicted: ${v.toFixed(1)} units`;
            // Trend line tooltip — shown on hover but kept minimal
            return `Trend: ${v.toFixed(1)} units`;
          },
        },
      },
    },
    scales: {
      x: {
        grid:   { display: false },
        ticks:  { maxTicksLimit: 12, font: { size: 11 }, color: '#94a3b8' },
        border: { display: false },
        title:  { display: true, text: 'Week', font: { size: 11 }, color: '#94a3b8' },
      },
      y: {
        beginAtZero: true,
        grid:        { color: 'rgba(0,0,0,0.05)' },
        ticks:       { font: { size: 11 }, color: '#94a3b8' },
        border:      { display: false },
        title:       { display: true, text: 'Units dispensed', font: { size: 11 }, color: '#94a3b8' },
      },
    },
  }), [selectedDrug]);

  // ── Render states ──────────────────────────────────────────────────────────
  // Show skeleton only on initial mount (before any drugs are loaded).
  // On retries, keep the page structure visible so the banner is readable.
  if (loading && drugs.length === 0) return <LoadingSkeleton />;

  // ── Backend status banner (replaces static error message) ─────────────────
  const BackendBanner = (() => {
    if (backendStatus === 'retrying') return (
      <div className="mb-5 flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3.5">
        <Loader2 size={17} className="text-amber-500 dark:text-amber-400 mt-0.5 shrink-0 animate-spin" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            ML Backend is starting up…
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
            Render.com free tier has a 30–50 s cold start. Retrying in{' '}
            <span className="font-bold tabular-nums">{countdown}s</span>
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
            Attempt {retryCount} of {MAX_RETRIES} — historical data shown below while waiting
          </p>
        </div>
      </div>
    );
    if (showConnected) return (
      <div className="mb-5 flex items-center gap-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3.5">
        <CheckCircle2 size={17} className="text-green-500 dark:text-green-400 shrink-0" />
        <p className="text-sm font-semibold text-green-800 dark:text-green-300">
          Backend connected! Loading predictions…
        </p>
      </div>
    );
    if (backendStatus === 'failed') return (
      <div className="mb-5 flex items-start gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3.5">
        <Terminal size={17} className="text-red-500 dark:text-red-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-red-700 dark:text-red-300">
            ML Backend could not be reached
          </p>
          <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
            Please ensure the backend is running and refresh the page. Historical data is shown below.
          </p>
        </div>
        <button
          onClick={() => {
            retryAttemptRef.current = 0;
            setRetryCount(0);
            setRetryKey(k => k + 1);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors shrink-0"
        >
          <RefreshCw size={13} /> Retry
        </button>
      </div>
    );
    return null;
  })();

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-6xl mx-auto">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-800">Demand Forecast</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          ML-powered weekly demand predictions via LinearRegression
        </p>
      </div>

      {BackendBanner}

      {/* ── Summary banner (overview only) ───────────────────────────────── */}
      {selectedId === null && backendStatus === 'connected' && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { icon: <AlertTriangle size={16} className="text-red-500" />,   bg: 'bg-red-50 border-red-200',    label: 'Needs Reorder',   value: needsReorder },
            { icon: <TrendingUp    size={16} className="text-green-600" />, bg: 'bg-green-50 border-green-200',label: 'Trending Up',     value: trendingUp },
            { icon: <Minus         size={16} className="text-slate-500" />, bg: 'bg-slate-50 border-slate-200',label: 'Stable Demand',   value: trendingStable },
          ].map(({ icon, bg, label, value }) => (
            <div key={label} className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${bg}`}>
              {icon}
              <div>
                <p className="text-lg font-bold text-slate-800 leading-none">{value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Drug selector + detail strip ─────────────────────────────────── */}
      <div className="flex items-center gap-4 flex-wrap mb-5">
        <div className="relative">
          <select
            value={selectedId ?? 'overview'}
            onChange={e => setSelectedId(e.target.value === 'overview' ? null : e.target.value)}
            className="appearance-none pl-4 pr-10 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm min-w-52 cursor-pointer"
          >
            <option value="overview">All Drugs Overview</option>
            {drugs.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>

        {/* Drug info strip when a drug is selected */}
        {selectedDrug && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
              {selectedDrug.category}
            </span>
            <span className="flex items-center gap-1 text-sm text-slate-600">
              <Package size={14} className="text-slate-400" />
              {selectedDrug.currentStock} {selectedDrug.unit} in stock
            </span>
            <span className="text-xs text-slate-400">
              Reorder at {selectedDrug.reorderLevel} {selectedDrug.unit}
            </span>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          OVERVIEW MODE — sparkline grid
      ════════════════════════════════════════════════════════════════════ */}
      {selectedId === null && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {drugs.map(drug => (
            <SparklineCard
              key={drug.id}
              drug={drug}
              history={weeklyHistory.get(drug.id) ?? []}
              prediction={predMap.get(drug.id) ?? null}
              onClick={() => setSelectedId(drug.id)}
            />
          ))}
          {drugs.length === 0 && (
            <div className="col-span-3 py-16 text-center text-slate-400 text-sm">
              No drugs found. Please seed the database from the Dashboard.
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          SINGLE DRUG DETAIL VIEW
      ════════════════════════════════════════════════════════════════════ */}
      {selectedId !== null && selectedDrug && (
        <div className="mb-8">

          {/* No prediction for this drug */}
          {!selectedPred && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 mb-5 flex items-start gap-3">
              <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-800">No ML prediction available</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  {backendStatus === 'failed'
                    ? 'Start the backend to generate predictions.'
                    : 'This drug may have fewer than 4 weeks of dispense history.'}
                </p>
              </div>
            </div>
          )}

          {/* ── Hero Line Chart ─────────────────────────────────────────── */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-4">
            {heroChartData ? (
              <div className="h-72">
                <Line
                  key={selectedId}
                  data={heroChartData as any}
                  options={heroChartOptions}
                />
              </div>
            ) : selectedHistory.length > 0 ? (
              /* History only — no predictions */
              <div className="h-72">
                <Line
                  key={selectedId + '-hist'}
                  data={{
                    labels:   selectedHistory.map(h => format(parseISO(h.date), 'dd MMM')),
                    datasets: [{
                      label:                'Historical demand',
                      data:                 selectedHistory.map(h => h.quantity),
                      showLine:             false,
                      pointRadius:          4,
                      pointHoverRadius:     6,
                      pointBackgroundColor: 'rgb(59, 130, 246)',
                      pointBorderColor:     'rgb(59, 130, 246)',
                      spanGaps:             false,
                    }],
                  } as any}
                  options={{
                    ...heroChartOptions,
                    plugins: {
                      ...heroChartOptions.plugins,
                      title: {
                        ...heroChartOptions.plugins.title,
                        text: `${selectedDrug.name} — Historical Demand`,
                      },
                    },
                  }}
                />
              </div>
            ) : (
              <div className="h-72 flex items-center justify-center text-slate-400">
                <div className="text-center">
                  <BarChart2 size={36} className="mx-auto mb-3 text-slate-200" />
                  <p className="text-sm">No dispense history for this drug</p>
                </div>
              </div>
            )}
          </div>

          {/* ── Metrics Cards ────────────────────────────────────────────── */}
          {selectedPred && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              {/* R² Score */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <p className="text-xs text-slate-400 mb-1.5">R² Score</p>
                <span className={`inline-block text-sm font-bold px-2 py-0.5 rounded-full ${r2Color(selectedPred.metrics.r2_score)}`}>
                  {selectedPred.metrics.r2_score.toFixed(3)}
                </span>
                <p className="text-[11px] text-slate-400 mt-1.5">Model fit quality</p>
              </div>

              {/* SMAPE / MAPE */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <p className="text-xs text-slate-400 mb-1.5">
                  {selectedPred.metrics.smape !== undefined ? 'SMAPE' : 'MAPE'}
                </p>
                <span className={`inline-block text-sm font-bold px-2 py-0.5 rounded-full ${mapeColor(selectedPred.metrics.smape ?? selectedPred.metrics.mape)}`}>
                  {(selectedPred.metrics.smape ?? selectedPred.metrics.mape).toFixed(1)}%
                </span>
                <p className="text-[11px] text-slate-400 mt-1.5">
                  {selectedPred.metrics.mae !== undefined
                    ? `MAE: ${selectedPred.metrics.mae.toFixed(1)} units/wk`
                    : 'Mean abs % error'}
                </p>
              </div>

              {/* Trend */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <p className="text-xs text-slate-400 mb-1.5">Trend</p>
                <div className="flex items-center gap-1.5">
                  {selectedPred.metrics.trend === 'increasing' && <TrendingUp  size={16} className="text-green-500" />}
                  {selectedPred.metrics.trend === 'decreasing' && <TrendingDown size={16} className="text-red-500" />}
                  {selectedPred.metrics.trend === 'stable'     && <Minus        size={16} className="text-slate-400" />}
                  <span className={`text-sm font-bold capitalize ${
                    selectedPred.metrics.trend === 'increasing' ? 'text-green-600'
                    : selectedPred.metrics.trend === 'decreasing' ? 'text-red-600'
                    : 'text-slate-500'
                  }`}>
                    {selectedPred.metrics.trend}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Slope: {selectedPred.metrics.slope > 0 ? '+' : ''}{selectedPred.metrics.slope.toFixed(2)} /day
                </p>
              </div>

              {/* Days Until Stockout */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <p className="text-xs text-slate-400 mb-1.5">Days Until Stockout</p>
                <p className={`text-2xl font-bold leading-none ${dosColor(selectedPred.reorder_suggestion.days_until_stockout)}`}>
                  {selectedPred.reorder_suggestion.days_until_stockout > 999
                    ? '∞'
                    : selectedPred.reorder_suggestion.days_until_stockout}
                </p>
                <p className="text-[11px] text-slate-400 mt-1.5">At current demand</p>
              </div>
            </div>
          )}

          {/* ── Reorder Suggestion ───────────────────────────────────────── */}
          {selectedPred && (
            <div className={`rounded-xl border p-4 ${
              selectedPred.reorder_suggestion.should_reorder
                ? 'bg-amber-50 border-amber-300'
                : 'bg-green-50 border-green-200'
            }`}>
              <div className="flex items-start gap-3">
                {selectedPred.reorder_suggestion.should_reorder
                  ? <AlertTriangle size={18} className="text-amber-600 mt-0.5 shrink-0" />
                  : <CheckCircle2  size={18} className="text-green-600 mt-0.5 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${
                    selectedPred.reorder_suggestion.should_reorder ? 'text-amber-800' : 'text-green-800'
                  }`}>
                    {selectedPred.reorder_suggestion.should_reorder
                      ? 'Reorder Recommended'
                      : 'Stock Sufficient'}
                  </p>
                  <p className={`text-xs mt-0.5 ${
                    selectedPred.reorder_suggestion.should_reorder ? 'text-amber-700' : 'text-green-700'
                  }`}>
                    {selectedPred.reorder_suggestion.reason}
                  </p>
                  {selectedPred.reorder_suggestion.should_reorder && (
                    <div className="mt-2 flex items-center gap-4 flex-wrap text-xs">
                      <span className="font-semibold text-amber-800">
                        Suggested qty:{' '}
                        <span className="text-lg font-bold">
                          {selectedPred.reorder_suggestion.suggested_quantity}
                        </span>{' '}
                        {selectedDrug.unit}
                      </span>
                      <span className="text-amber-700">
                        (30-day demand × 1.2 safety buffer)
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          REORDER TABLE — always visible
      ════════════════════════════════════════════════════════════════════ */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {/* Table header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">Reorder Priority Table</h2>
            <span className="text-xs text-slate-400 ml-1">
              ({reorderRows.length} drug{reorderRows.length !== 1 ? 's' : ''})
            </span>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={reorderOnly}
              onChange={e => setReorderOnly(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            Needs Reorder Only
          </label>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Drug</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Current Stock</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Predicted 30d</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Suggested Qty</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Days to Stockout</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Urgency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {reorderRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">
                    {reorderOnly ? 'No drugs currently need reordering.' : 'No drug data available.'}
                  </td>
                </tr>
              ) : reorderRows.map(({ drug, pred, dos, pred30 }) => {
                const urg = pred ? urgency(dos) : 'ok';
                const isSelected = drug.id === selectedId;

                return (
                  <tr
                    key={drug.id}
                    onClick={() => setSelectedId(drug.id)}
                    className={`hover:bg-slate-50 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800 truncate max-w-[180px]">{drug.name}</p>
                      <p className="text-[11px] text-slate-400">{drug.category}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-700">
                      {drug.currentStock}
                      <span className="text-slate-400 text-xs ml-1">{drug.unit}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {pred30 !== null
                        ? <span className="font-medium text-slate-700">{pred30} <span className="text-slate-400 text-xs">{drug.unit}</span></span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {pred?.reorder_suggestion.should_reorder ? (
                        <span className="font-semibold text-amber-700">
                          {pred.reorder_suggestion.suggested_quantity}{' '}
                          <span className="font-normal text-xs text-slate-400">{drug.unit}</span>
                        </span>
                      ) : pred ? (
                        <span className="text-green-600 text-xs">—</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {pred ? (
                        <span className={`font-semibold ${dosColor(dos)}`}>
                          {dos > 999 ? '∞' : dos}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {pred ? (
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${URGENCY_BADGE[urg]}`}>
                          {URGENCY_LABEL[urg]}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-300 italic">No data</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Backend status footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2">
          {backendStatus === 'checking' && (
            <><Loader2 size={13} className="animate-spin text-blue-500" />
              <span className="text-xs text-slate-500">Checking ML backend…</span></>
          )}
          {backendStatus === 'retrying' && (
            <><Loader2 size={13} className="animate-spin text-amber-500" />
              <span className="text-xs text-slate-500">
                Backend starting up — retrying in {countdown}s (attempt {retryCount}/{MAX_RETRIES})
              </span></>
          )}
          {backendStatus === 'connected' && (
            <><CheckCircle2 size={13} className="text-green-500" />
              <span className="text-xs text-slate-500">ML predictions loaded — LinearRegression model</span></>
          )}
          {backendStatus === 'failed' && (
            <><AlertTriangle size={13} className="text-red-500" />
              <span className="text-xs text-slate-500">
                Showing historical data only.{' '}
                <button
                  onClick={() => {
                    retryAttemptRef.current = 0;
                    setRetryCount(0);
                    setRetryKey(k => k + 1);
                  }}
                  className="text-blue-600 hover:underline font-medium"
                >
                  Retry backend
                </button>
              </span></>
          )}
        </div>
      </div>
    </div>
  );
}
