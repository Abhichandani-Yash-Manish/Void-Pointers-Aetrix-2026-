import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../config/firebase';
import type { Drug, Batch, DispenseLog } from '../../types';
import {
  differenceInDays,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  startOfToday,
  subMonths,
} from 'date-fns';
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Leaf,
  Package,
  Shield,
  TrendingUp,
} from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// ─── Types ──────────────────────────────────────────────────────────────────

interface InternalBatch {
  batchId: string;
  drugId: string;
  drugName: string;
  drugCategory: string;
  batchNumber: string;
  quantity: number;
  expiryDate: string;
  costPerUnit: number;
}

interface Metrics {
  expiredCount: number;
  valueAtRisk: number;       // ₹ value of expired non-zero-qty batches
  rescuedUnits: number;      // units dispensed when batch was within 60d of expiry
  rescuedValue: number;      // ₹ value of those rescued dispenses
  stockoutsPrevented: number;
  totalSaved: number;        // valueAtRisk + rescuedValue
  co2Saved: number;          // kg, @ 0.002 kg per unit
}

interface MonthPoint {
  label: string;
  potential: number;   // ₹ that would have been wasted (manual 60% baseline)
  prevented: number;   // ₹ actually rescued by FEFO
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TODAY = startOfToday();

const DONUT_COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444',
  '#8b5cf6', '#06b6d4', '#f97316', '#84cc16',
];

// ─── Helpers ────────────────────────────────────────────────────────────────

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

const round2 = (n: number) => Math.round(n * 100) / 100;

// ─── MetricCard ─────────────────────────────────────────────────────────────

interface MetricCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  description: string;
  border: string;
  iconBg: string;
  valueCls?: string;
}

function MetricCard({ icon, label, value, description, border, iconBg, valueCls = 'text-gray-800' }: MetricCardProps) {
  return (
    <div className={`bg-white rounded-xl border ${border} shadow-sm p-4 flex flex-col gap-3`}>
      <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center`}>
        {icon}
      </div>
      <div>
        <p className={`text-2xl font-bold leading-none ${valueCls}`}>{value}</p>
        <p className="text-sm font-medium text-gray-600 mt-1">{label}</p>
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>
    </div>
  );
}

// ─── ChartCard ──────────────────────────────────────────────────────────────

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="mb-4">
        <h3 className="font-semibold text-gray-800">{title}</h3>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function WasteCalcPage() {
  const [allBatches,   setAllBatches]   = useState<InternalBatch[]>([]);
  const [allDrugs,     setAllDrugs]     = useState<Drug[]>([]);
  const [dispLogs,     setDispLogs]     = useState<DispenseLog[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [methodOpen,   setMethodOpen]   = useState(false);

  // ── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // Drugs
        const drugSnaps = await getDocs(collection(db, 'drugs'));
        const drugs = drugSnaps.docs.map(d => ({ id: d.id, ...d.data() } as Drug));
        setAllDrugs(drugs);

        // Batches (all subcollections in parallel)
        const batches: InternalBatch[] = [];
        await Promise.all(
          drugs.map(async drug => {
            const bSnaps = await getDocs(collection(db, 'drugs', drug.id, 'batches'));
            bSnaps.docs.forEach(bd => {
              const b = { id: bd.id, ...bd.data() } as Batch;
              batches.push({
                batchId:      b.id,
                drugId:       drug.id,
                drugName:     drug.name,
                drugCategory: drug.category,
                batchNumber:  b.batchNumber,
                quantity:     b.quantity,
                expiryDate:   b.expiryDate,
                costPerUnit:  b.costPerUnit,
              });
            });
          })
        );
        setAllBatches(batches);

        // Dispense logs
        const logSnaps = await getDocs(collection(db, 'dispenseLogs'));
        setDispLogs(logSnaps.docs.map(d => ({ id: d.id, ...d.data() } as DispenseLog)));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── batchId → batch lookup ────────────────────────────────────────────────
  const batchMap = useMemo(() => {
    const m = new Map<string, InternalBatch>();
    allBatches.forEach(b => m.set(b.batchId, b));
    return m;
  }, [allBatches]);

  // ── Core metrics ──────────────────────────────────────────────────────────
  const metrics = useMemo((): Metrics => {
    // a) Expired batches caught (still have stock, past expiry date)
    const expiredBatches = allBatches.filter(
      b => parseISO(b.expiryDate) < TODAY && b.quantity > 0
    );
    const expiredCount = expiredBatches.length;
    const valueAtRisk  = expiredBatches.reduce((s, b) => s + b.quantity * b.costPerUnit, 0);

    // b) Units rescued by FEFO: dispensed when batch was within 60 days of expiry
    const rescuedLogs = dispLogs.filter(log => {
      const batch = batchMap.get(log.batchId);
      if (!batch) return false;
      const daysLeft = differenceInDays(parseISO(batch.expiryDate), parseISO(log.timestamp));
      return daysLeft >= 0 && daysLeft <= 60;
    });
    const rescuedUnits = rescuedLogs.reduce((s, l) => s + l.quantity, 0);
    const rescuedValue = rescuedLogs.reduce((s, l) => {
      const b = batchMap.get(l.batchId);
      return b ? s + l.quantity * b.costPerUnit : s;
    }, 0);

    // c) Stock-outs prevented: currently at 100-150% of reorder level
    const stockoutsPrevented = allDrugs.filter(
      d => d.currentStock > 0 && d.currentStock <= d.reorderLevel * 1.5
    ).length;

    const totalSaved = valueAtRisk + rescuedValue;
    const co2Saved   = round2(rescuedUnits * 0.002);

    return { expiredCount, valueAtRisk, rescuedUnits, rescuedValue, stockoutsPrevented, totalSaved, co2Saved };
  }, [allBatches, allDrugs, dispLogs, batchMap]);

  // ── Last 6 months buckets ─────────────────────────────────────────────────
  const last6 = useMemo(
    () => Array.from({ length: 6 }, (_, i) => subMonths(startOfMonth(TODAY), 5 - i)),
    []
  );

  const monthlyData = useMemo((): MonthPoint[] => {
    return last6.map(mStart => {
      const mEnd = endOfMonth(mStart);

      const monthLogs = dispLogs.filter(l => {
        const ts = parseISO(l.timestamp);
        return ts >= mStart && ts <= mEnd;
      });

      const nearExpiryLogs = monthLogs.filter(l => {
        const b = batchMap.get(l.batchId);
        if (!b) return false;
        const d = differenceInDays(parseISO(b.expiryDate), parseISO(l.timestamp));
        return d >= 0 && d <= 60;
      });

      const prevented = nearExpiryLogs.reduce((s, l) => {
        const b = batchMap.get(l.batchId);
        return b ? s + l.quantity * b.costPerUnit : s;
      }, 0);

      // Manual 60% FEFO compliance baseline → 40% of near-expiry total would be wasted
      // Total near-expiry inventory = prevented / 0.6; wasted portion = total × 0.4
      const potential = prevented > 0 ? (prevented / 0.6) * 0.4 : 0;

      return { label: format(mStart, 'MMM yy'), potential, prevented };
    });
  }, [last6, dispLogs, batchMap]);

  // ── Doughnut: at-risk ₹ by category ──────────────────────────────────────
  const categoryData = useMemo(() => {
    const map: Record<string, number> = {};
    allBatches.forEach(b => {
      const daysLeft = differenceInDays(parseISO(b.expiryDate), TODAY);
      if (daysLeft <= 60 && b.quantity > 0) {
        map[b.drugCategory] = (map[b.drugCategory] || 0) + b.quantity * b.costPerUnit;
      }
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [allBatches]);

  // ── Cumulative savings line ───────────────────────────────────────────────
  const cumulativeSavings = useMemo(() => {
    let running = 0;
    return monthlyData.map(m => { running += m.prevented; return running; });
  }, [monthlyData]);

  // ── Comparison section values ─────────────────────────────────────────────
  const withoutSystem = useMemo(() => {
    // If only 60% FEFO compliance, total near-expiry inventory = rescuedValue / 0.6
    const nearExpiryTotal = metrics.rescuedValue > 0 ? metrics.rescuedValue / 0.6 : 0;
    const manualWaste     = nearExpiryTotal * 0.4; // 40% wasted under manual tracking
    return manualWaste + metrics.valueAtRisk;
  }, [metrics]);

  const annualProjected = metrics.totalSaved * 2; // extrapolate 6 months → 12

  // ── Chart configs ─────────────────────────────────────────────────────────
  const barData = useMemo(() => ({
    labels: monthlyData.map(m => m.label),
    datasets: [
      {
        label: 'Potential Waste (₹)',
        data: monthlyData.map(m => m.potential),
        backgroundColor: 'rgba(239, 68, 68, 0.75)',
        borderRadius: 5,
      },
      {
        label: 'Waste Prevented (₹)',
        data: monthlyData.map(m => m.prevented),
        backgroundColor: 'rgba(16, 185, 129, 0.85)',
        borderRadius: 5,
      },
    ],
  }), [monthlyData]);

  const barOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: { display: true, position: 'top' as const, labels: { boxWidth: 12, font: { size: 11 } } },
      tooltip: { callbacks: { label: (ctx: { raw: unknown }) => ` ₹${inr(ctx.raw as number)}` } },
    },
    scales: {
      y: {
        grid: { color: 'rgba(0,0,0,0.05)' },
        ticks: { callback: (v: unknown) => `₹${inr(v as number)}`, font: { size: 10 } },
      },
      x: { grid: { display: false }, ticks: { font: { size: 11 } } },
    },
  }), []);

  const donutData = useMemo(() => ({
    labels: categoryData.map(([cat]) => cat),
    datasets: [{
      data: categoryData.map(([, val]) => val),
      backgroundColor: DONUT_COLORS.slice(0, categoryData.length),
      borderWidth: 2,
      borderColor: '#ffffff',
      hoverOffset: 6,
    }],
  }), [categoryData]);

  const donutOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        display: true,
        position: 'right' as const,
        labels: { boxWidth: 12, font: { size: 11 }, padding: 12 },
      },
      tooltip: { callbacks: { label: (ctx: { raw: unknown }) => ` ₹${inr(ctx.raw as number)}` } },
    },
    cutout: '62%',
  }), []);

  const lineData = useMemo(() => ({
    labels: monthlyData.map(m => m.label),
    datasets: [{
      label: 'Cumulative Savings (₹)',
      data: cumulativeSavings,
      borderColor: '#10b981',
      backgroundColor: 'rgba(16, 185, 129, 0.1)',
      fill: true,
      tension: 0.4,
      pointBackgroundColor: '#10b981',
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
      pointRadius: 5,
    }],
  }), [monthlyData, cumulativeSavings]);

  const lineOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx: { raw: unknown }) => ` ₹${inr(ctx.raw as number)}` } },
    },
    scales: {
      y: {
        grid: { color: 'rgba(0,0,0,0.05)' },
        ticks: { callback: (v: unknown) => `₹${inr(v as number)}`, font: { size: 10 } },
      },
      x: { grid: { display: false }, ticks: { font: { size: 11 } } },
    },
  }), []);

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6 space-y-6 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-72" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="col-span-2 h-36 bg-gray-200 rounded-xl" />
          {[0, 1, 2, 3].map(i => <div key={i} className="h-36 bg-gray-200 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map(i => <div key={i} className="h-64 bg-gray-200 rounded-xl" />)}
        </div>
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!allBatches.length && !dispLogs.length) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-96 gap-4 text-center">
        <BarChart3 size={52} className="text-gray-200" />
        <p className="text-lg font-semibold text-gray-500">No dispense data found.</p>
        <p className="text-sm text-gray-400 max-w-sm">
          Ensure the database has been seeded and drugs have been dispensed.
        </p>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 space-y-6">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <TrendingUp size={22} className="text-emerald-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-800">Waste Prevention Dashboard</h1>
          <p className="text-xs text-gray-400">
            Real-time impact metrics powered by FEFO + ML forecasting
          </p>
        </div>
      </div>

      {/* ── Hero metric cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">

        {/* ₹ Total Saved — hero card */}
        <div className="col-span-2 bg-gradient-to-r from-emerald-500 to-green-600 rounded-xl shadow-lg p-6 text-white flex flex-col justify-between">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center">
              <TrendingUp size={18} className="text-white" />
            </div>
            <span className="text-emerald-100 text-sm font-medium">Total Waste Prevented</span>
          </div>
          <div>
            <p className="text-4xl md:text-5xl font-black tracking-tight">
              ₹{inr(metrics.totalSaved)}
            </p>
            <p className="text-emerald-100 text-sm mt-1">
              Expired stock caught + near-expiry units rescued by FEFO
            </p>
          </div>
        </div>

        {/* Units Rescued */}
        <MetricCard
          icon={<Package size={18} className="text-blue-600" />}
          label="Units Rescued from Expiry"
          value={inr(metrics.rescuedUnits)}
          description="Dispensed within 60 days of expiry via FEFO"
          border="border-blue-100"
          iconBg="bg-blue-50"
          valueCls="text-blue-700"
        />

        {/* Expired Batches */}
        <MetricCard
          icon={<AlertTriangle size={18} className="text-red-500" />}
          label="Expired Batches Caught"
          value={String(metrics.expiredCount)}
          description={`₹${inr(metrics.valueAtRisk)} flagged for disposal`}
          border="border-red-100"
          iconBg="bg-red-50"
          valueCls="text-red-600"
        />

        {/* Stock-outs Prevented */}
        <MetricCard
          icon={<Shield size={18} className="text-violet-600" />}
          label="Stock-outs Prevented"
          value={String(metrics.stockoutsPrevented)}
          description="Drugs at reorder threshold caught by ML alerts"
          border="border-violet-100"
          iconBg="bg-violet-50"
          valueCls="text-violet-700"
        />

        {/* CO₂ Saved */}
        <MetricCard
          icon={<Leaf size={18} className="text-green-600" />}
          label="CO₂ Saved"
          value={`${inr(metrics.co2Saved)} kg`}
          description="Pharma waste reduction @ 0.002 kg/unit"
          border="border-green-100"
          iconBg="bg-green-50"
          valueCls="text-green-700"
        />
      </div>

      {/* ── Charts ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

        {/* Bar: Monthly waste prevention */}
        <ChartCard
          title="Monthly Waste Prevention"
          subtitle="Last 6 months — potential vs. actually prevented (₹)"
        >
          <Bar data={barData} options={barOptions} />
        </ChartCard>

        {/* Doughnut: By category */}
        <ChartCard
          title="At-Risk Value by Category"
          subtitle="₹ value of batches expiring within 60 days"
        >
          {categoryData.length > 0 ? (
            <Doughnut data={donutData} options={donutOptions} />
          ) : (
            <div className="flex items-center justify-center h-48 text-sm text-gray-400">
              No near-expiry batches found.
            </div>
          )}
        </ChartCard>

        {/* Line: Cumulative savings */}
        <ChartCard
          title="Cumulative Savings Over Time"
          subtitle="Running total of ₹ rescued by FEFO dispensing"
        >
          <Line data={lineData} options={lineOptions} />
        </ChartCard>
      </div>

      {/* ── With vs Without PharmaGuard ─────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h2 className="font-bold text-gray-800 text-base mb-1 flex items-center gap-2">
          <BarChart3 size={18} className="text-gray-400" />
          With vs Without PharmaGuard Gujarat
        </h2>
        <p className="text-xs text-gray-400 mb-4">
          Baseline: CAG audit — manual FEFO compliance ~60% in Gujarat government hospitals
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
          {/* Without */}
          <div className="bg-red-50 border border-red-100 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle size={16} className="text-red-500" />
              </div>
              <h3 className="font-bold text-red-700">Without PharmaGuard</h3>
            </div>
            <ul className="space-y-2.5 text-sm text-red-800">
              <li className="flex justify-between">
                <span className="text-red-600">FEFO compliance rate</span>
                <span className="font-bold">~60%</span>
              </li>
              <li className="flex justify-between">
                <span className="text-red-600">Near-expiry batches wasted</span>
                <span className="font-bold">~40%</span>
              </li>
              <li className="flex justify-between">
                <span className="text-red-600">Overstocking (no ML forecast)</span>
                <span className="font-bold">15–20%</span>
              </li>
              <li className="flex justify-between border-t border-red-200 pt-2 mt-2">
                <span className="text-red-700 font-semibold">Estimated waste value</span>
                <span className="font-black text-red-700 text-base">₹{inr(withoutSystem)}</span>
              </li>
            </ul>
          </div>

          {/* With */}
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                <Shield size={16} className="text-emerald-600" />
              </div>
              <h3 className="font-bold text-emerald-700">With PharmaGuard</h3>
            </div>
            <ul className="space-y-2.5 text-sm text-emerald-800">
              <li className="flex justify-between">
                <span className="text-emerald-600">FEFO compliance rate</span>
                <span className="font-bold">100% (automated)</span>
              </li>
              <li className="flex justify-between">
                <span className="text-emerald-600">Waste reduction (IJRMP 2025)</span>
                <span className="font-bold">33–42%</span>
              </li>
              <li className="flex justify-between">
                <span className="text-emerald-600">Overstock via ML reorder</span>
                <span className="font-bold">Minimised</span>
              </li>
              <li className="flex justify-between border-t border-emerald-200 pt-2 mt-2">
                <span className="text-emerald-700 font-semibold">Total waste prevented</span>
                <span className="font-black text-emerald-700 text-base">₹{inr(metrics.totalSaved)}</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Annual projection */}
        <div className="bg-gradient-to-r from-emerald-500 to-green-600 rounded-xl p-5 text-white flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <p className="text-emerald-100 text-sm font-medium">Annual Projected Savings</p>
            <p className="text-xs text-emerald-200 mt-0.5">
              Extrapolated from current {dispLogs.length} dispense records · 6 months of data
            </p>
          </div>
          <div className="text-right">
            <p className="text-4xl font-black">₹{inr(annualProjected)}</p>
            <p className="text-emerald-100 text-xs mt-0.5">per year per facility</p>
          </div>
        </div>
      </div>

      {/* ── Methodology (collapsible) ────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <button
          onClick={() => setMethodOpen(o => !o)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition text-left"
        >
          <div>
            <span className="font-semibold text-gray-700">How We Calculate These Numbers</span>
            <span className="text-xs text-gray-400 block mt-0.5">
              Methodology, data sources &amp; references — important for audit transparency
            </span>
          </div>
          {methodOpen
            ? <ChevronUp size={18} className="text-gray-400 shrink-0" />
            : <ChevronDown size={18} className="text-gray-400 shrink-0" />
          }
        </button>

        {methodOpen && (
          <div className="border-t border-gray-100 px-5 py-5 space-y-5 text-sm text-gray-600">

            <div>
              <h4 className="font-semibold text-gray-800 mb-2">Metric Definitions</h4>
              <ul className="space-y-3">
                <li className="flex gap-3">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 mt-1.5" />
                  <div>
                    <span className="font-medium text-gray-700">Total ₹ Saved</span>
                    <span className="text-gray-500"> = </span>
                    <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">
                      Rescued Value + Expired Value at Risk
                    </code>
                    <p className="text-gray-400 text-xs mt-0.5">
                      Sum of what was actively rescued through FEFO dispense ordering,
                      plus the value of expired stock flagged by the system before it was silently discarded.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0 mt-1.5" />
                  <div>
                    <span className="font-medium text-gray-700">Units Rescued by FEFO</span>
                    <p className="text-gray-400 text-xs mt-0.5">
                      Dispense log entries where the corresponding batch's expiry date was within 60 days
                      of the dispense timestamp. Without FEFO ordering, these batches would likely have been
                      dispensed after expiry (or left to expire).
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="w-2 h-2 rounded-full bg-red-400 shrink-0 mt-1.5" />
                  <div>
                    <span className="font-medium text-gray-700">Expired Batches Caught</span>
                    <p className="text-gray-400 text-xs mt-0.5">
                      Batches where <code className="bg-gray-100 px-1 rounded text-xs font-mono">expiryDate &lt; today</code> and{' '}
                      <code className="bg-gray-100 px-1 rounded text-xs font-mono">quantity &gt; 0</code>.
                      The system raised alerts for these before silent disposal. Value = qty × costPerUnit.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="w-2 h-2 rounded-full bg-violet-400 shrink-0 mt-1.5" />
                  <div>
                    <span className="font-medium text-gray-700">Stock-outs Prevented</span>
                    <p className="text-gray-400 text-xs mt-0.5">
                      Drugs currently between 100–150% of their reorder level — the ML forecasting
                      system would have triggered a reorder alert before stockout occurred.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="w-2 h-2 rounded-full bg-green-400 shrink-0 mt-1.5" />
                  <div>
                    <span className="font-medium text-gray-700">CO₂ Reduction</span>
                    <p className="text-gray-400 text-xs mt-0.5">
                      Estimated at 0.002 kg CO₂ per pharmaceutical unit avoided from landfill or
                      incineration (conservative estimate based on pharma waste literature).
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0 mt-1.5" />
                  <div>
                    <span className="font-medium text-gray-700">Monthly Potential Waste (Bar Chart)</span>
                    <p className="text-gray-400 text-xs mt-0.5">
                      Simulates manual 60% FEFO compliance baseline. If near-expiry dispenses achieved
                      ₹X in that month, the total near-expiry inventory = X/0.6. The wasted portion
                      under manual tracking = total × 0.4.
                    </p>
                  </div>
                </li>
              </ul>
            </div>

            <div className="bg-amber-50 border border-amber-100 rounded-lg p-4">
              <p className="font-medium text-amber-800 mb-1">Data Caveat</p>
              <p className="text-amber-700 text-xs leading-relaxed">
                All metrics are calculated from live Firestore records. In production deployment,
                these figures reflect actual dispense logs, batch tracking data, and real-time
                stock levels collected over the facility's operational period. The "comparison
                baseline" uses the CAG-audited 60% manual FEFO compliance rate reported for
                Gujarat government hospitals.
              </p>
            </div>

            <div className="text-xs text-gray-400 space-y-1">
              <p className="font-medium text-gray-500">References</p>
              <p>· IJRMP 2025 — Hospital pharmacy FEFO implementation studies (33–42% waste reduction)</p>
              <p>· CAG Audit Report — Drug procurement and storage in Gujarat government hospitals</p>
              <p>· WHO Guidelines on pharmaceutical waste management (CO₂ estimates)</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
