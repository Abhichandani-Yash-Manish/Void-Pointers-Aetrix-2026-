import { useState, useEffect, useRef } from 'react';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  where,
  writeBatch,
  increment,
  addDoc,
} from 'firebase/firestore';
import { differenceInDays, format, parseISO } from 'date-fns';
import {
  Package,
  AlertTriangle,
  CheckCircle,
  Clock,
  ArrowRight,
  ChevronDown,
  X,
  Loader2,
  Info,
} from 'lucide-react';
import { db } from '../../config/firebase';
import { useAuth } from '../../hooks/useAuth';
import type { Drug, Batch } from '../../types';

// ── Local types ───────────────────────────────────────────────────────────────

interface SplitItem {
  batch: Batch;
  take: number;
}

interface Toast {
  type: 'success' | 'error';
  message: string;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function daysUntilExpiry(expiryDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return differenceInDays(parseISO(expiryDate), today);
}

function isExpired(expiryDate: string): boolean {
  return daysUntilExpiry(expiryDate) < 0;
}

/** Text colour for expiry label */
function expiryTextColor(days: number): string {
  if (days < 0)  return 'text-red-600';
  if (days < 30) return 'text-yellow-600';
  if (days < 90) return 'text-amber-600';
  return 'text-green-600';
}

/** Dot indicator colour */
function expiryDotColor(days: number): string {
  if (days < 0)  return 'bg-red-500';
  if (days < 30) return 'bg-yellow-400';
  if (days < 90) return 'bg-amber-400';
  return 'bg-green-400';
}

/** Full card class for a batch row */
function batchCardClass(batch: Batch, isRecommended: boolean): string {
  const days    = daysUntilExpiry(batch.expiryDate);
  const expired = days < 0;
  const depleted = batch.quantity === 0;

  if (expired)        return 'border border-red-200 bg-red-50 opacity-70';
  if (depleted)       return 'border border-slate-200 bg-slate-50 opacity-55';
  if (isRecommended)  return 'border-l-[4px] border-l-green-500 border border-green-200 bg-green-50 shadow-sm';
  if (days < 30)      return 'border border-yellow-200 bg-yellow-50/50';
  if (days < 90)      return 'border border-amber-200 bg-amber-50/40';
  return 'border border-slate-200 bg-white';
}

/** Greedy FEFO split — returns list of {batch, take} in expiry order */
function computeSplit(batches: Batch[], quantity: number): SplitItem[] {
  const available = [...batches]
    .filter(b => !isExpired(b.expiryDate) && b.quantity > 0)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

  const result: SplitItem[] = [];
  let remaining = quantity;
  for (const batch of available) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    result.push({ batch, take });
    remaining -= take;
  }
  return result;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DispensePage() {
  const { user, profile } = useAuth();

  // ── Drug list (fetched once) ───────────────────────────────────────────────
  const [drugs, setDrugs]               = useState<Drug[]>([]);
  const [drugsLoading, setDrugsLoading] = useState(true);
  const [searchQuery, setSearchQuery]   = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedDrug, setSelectedDrug] = useState<Drug | null>(null);
  const dropdownRef                     = useRef<HTMLDivElement>(null);

  // ── Batches (real-time) ────────────────────────────────────────────────────
  const [batches, setBatches]               = useState<Batch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);

  // ── Dispense form ──────────────────────────────────────────────────────────
  const [quantity, setQuantity]       = useState<number | ''>('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [dispensing, setDispensing]   = useState(false);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [toast, setToast]             = useState<Toast | null>(null);
  const [fefoTraining, setFefoTraining] = useState(false);

  // ── Fetch all drugs on mount ───────────────────────────────────────────────
  useEffect(() => {
    getDocs(collection(db, 'drugs'))
      .then(snap => {
        const list: Drug[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as Drug));
        list.sort((a, b) => a.name.localeCompare(b.name));
        setDrugs(list);
      })
      .catch(console.error)
      .finally(() => setDrugsLoading(false));
  }, []);

  // ── Real-time batch subscription (auto-refreshes via onSnapshot) ───────────
  useEffect(() => {
    if (!selectedDrug) {
      setBatches([]);
      return;
    }
    setBatchesLoading(true);
    const unsub = onSnapshot(
      collection(db, 'drugs', selectedDrug.id, 'batches'),
      snap => {
        const list: Batch[] = snap.docs.map(d => ({ id: d.id, ...d.data() } as Batch));
        setBatches(list);
        setBatchesLoading(false);
      },
      err => { console.error(err); setBatchesLoading(false); },
    );
    return unsub;
  }, [selectedDrug?.id]);

  // ── Close dropdown on outside click ───────────────────────────────────────
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  // ── Auto-dismiss toast after 3 s ──────────────────────────────────────────
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Derived / computed values ──────────────────────────────────────────────
  const sortedBatches     = [...batches].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  const availableBatches  = sortedBatches.filter(b => !isExpired(b.expiryDate) && b.quantity > 0);
  const totalAvailStock   = availableBatches.reduce((s, b) => s + b.quantity, 0);
  const fefoRecommended   = availableBatches[0] ?? null;

  const filteredDrugs = drugs.filter(d =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    d.category.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const qty          = typeof quantity === 'number' ? quantity : 0;
  const splitPlan    = selectedDrug && qty > 0 ? computeSplit(batches, qty) : [];
  const splitTotal   = splitPlan.reduce((s, i) => s + i.take, 0);
  const splitCovers  = qty > 0 && splitTotal >= qty;

  // ── Duplicate-alert guard ──────────────────────────────────────────────────
  async function alertExists(type: string, drugId: string): Promise<boolean> {
    const snap = await getDocs(
      query(
        collection(db, 'alerts'),
        where('type', '==', type),
        where('drugId', '==', drugId),
        where('read', '==', false),
      ),
    );
    return !snap.empty;
  }

  // ── Post-dispense alert generation ────────────────────────────────────────
  async function generateAlerts(drug: Drug, newStock: number, remaining: Batch[]) {
    if (newStock <= drug.reorderLevel) {
      if (!(await alertExists('low_stock', drug.id))) {
        await addDoc(collection(db, 'alerts'), {
          type: 'low_stock',
          drugId: drug.id,
          drugName: drug.name,
          message: `${drug.name} stock is low: ${newStock} ${drug.unit} remaining (reorder level: ${drug.reorderLevel})`,
          severity: newStock <= drug.reorderLevel * 0.5 ? 'critical' : 'warning',
          read: false,
          createdAt: new Date().toISOString(),
        });
      }
    }

    for (const batch of remaining) {
      if (batch.quantity <= 0 || isExpired(batch.expiryDate)) continue;
      const daysLeft = daysUntilExpiry(batch.expiryDate);
      if (daysLeft <= 30) {
        if (!(await alertExists('near_expiry', drug.id))) {
          await addDoc(collection(db, 'alerts'), {
            type: 'near_expiry',
            drugId: drug.id,
            drugName: drug.name,
            batchNumber: batch.batchNumber,
            message: `${drug.name} batch ${batch.batchNumber} expires in ${daysLeft} days`,
            severity: daysLeft <= 7 ? 'critical' : 'warning',
            read: false,
            createdAt: new Date().toISOString(),
          });
        }
        break;
      }
    }
  }

  // ── Dispense handler (atomic writeBatch) ───────────────────────────────────
  async function handleDispense() {
    if (!selectedDrug || !user || splitPlan.length === 0) return;
    setDispensing(true);

    try {
      const batch       = writeBatch(db);
      let totalDeducted = 0;
      const remainingMap: Record<string, number> = {};
      batches.forEach(b => { remainingMap[b.id] = b.quantity; });

      const dispensedByName =
        user.displayName || user.email || profile?.name || 'Unknown';
      const timestamp = new Date().toISOString();

      for (const { batch: drugBatch, take } of splitPlan) {
        // Decrement batch quantity
        batch.update(
          doc(db, 'drugs', selectedDrug.id, 'batches', drugBatch.id),
          { quantity: increment(-take) },
        );
        remainingMap[drugBatch.id] = (remainingMap[drugBatch.id] ?? 0) - take;
        totalDeducted += take;

        // Create dispense log doc (batch.set on a new ref)
        const logRef = doc(collection(db, 'dispenseLogs'));
        batch.set(logRef, {
          drugId:          selectedDrug.id,
          drugName:        selectedDrug.name,
          batchId:         drugBatch.id,
          batchNumber:     drugBatch.batchNumber,
          quantity:        take,
          dispensedBy:     user.uid,
          dispensedByName,
          timestamp,
        });
      }

      // Decrement drug's currentStock
      batch.update(doc(db, 'drugs', selectedDrug.id), {
        currentStock: increment(-totalDeducted),
      });

      await batch.commit();

      // Post-commit: alert generation (reads → separate from the batch write)
      const newStock = selectedDrug.currentStock - totalDeducted;
      const remainingBatches = batches.map(b => ({
        ...b,
        quantity: remainingMap[b.id] ?? b.quantity,
      }));
      await generateAlerts(selectedDrug, newStock, remainingBatches);

      // Update local drug reference so summary strip refreshes immediately
      setSelectedDrug(prev => prev ? { ...prev, currentStock: newStock } : prev);
      setShowConfirm(false);
      setQuantity('');
      setToast({
        type: 'success',
        message: `Dispensed ${totalDeducted} ${selectedDrug.unit} of ${selectedDrug.name}`,
      });
    } catch (err) {
      console.error(err);
      setToast({ type: 'error', message: 'Dispense failed — please try again.' });
    } finally {
      setDispensing(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-4xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">FEFO Dispense</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            First Expiry, First Out — nearest-expiry batches are dispensed first
          </p>
        </div>

        {/* Training mode toggle */}
        <button
          onClick={() => setFefoTraining(v => !v)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
            fefoTraining
              ? 'bg-blue-50 border-blue-300 text-blue-700'
              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Info size={15} />
          FEFO Training Mode
        </button>
      </div>

      {/* ── FEFO Training Panel ─────────────────────────────────────────────── */}
      {fefoTraining && (
        <div className="mb-5 bg-blue-50 border border-blue-200 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <div className="bg-blue-100 rounded-lg p-2 mt-0.5 shrink-0">
              <Info size={18} className="text-blue-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-blue-800 mb-2">FEFO — First Expiry, First Out</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                <div className="bg-white border border-blue-100 rounded-lg p-3">
                  <p className="text-xs font-semibold text-blue-700 mb-1 flex items-center gap-1">
                    <Clock size={12} /> What is FEFO?
                  </p>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Batches are sorted by expiry date, nearest first. The oldest-expiring batch with stock is always dispensed first to minimise waste.
                  </p>
                </div>
                <div className="bg-white border border-blue-100 rounded-lg p-3">
                  <p className="text-xs font-semibold text-blue-700 mb-1 flex items-center gap-1">
                    <ArrowRight size={12} /> Why this batch?
                  </p>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {fefoRecommended
                      ? `Batch ${fefoRecommended.batchNumber} expires in ${daysUntilExpiry(fefoRecommended.expiryDate)} days — it has the nearest expiry among all batches with stock.`
                      : 'No batch with available stock selected yet.'}
                  </p>
                </div>
                <div className="bg-white border border-blue-100 rounded-lg p-3">
                  <p className="text-xs font-semibold text-blue-700 mb-1 flex items-center gap-1">
                    <CheckCircle size={12} /> Waste prevented
                  </p>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {fefoRecommended && fefoRecommended.costPerUnit > 0
                      ? `Dispensing this batch first prevents ₹${(fefoRecommended.costPerUnit * fefoRecommended.quantity).toFixed(0)} of potential waste if it were to expire unused.`
                      : 'Select a drug to see the waste-prevention estimate.'}
                  </p>
                </div>
              </div>
              {fefoRecommended && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-700">
                  <ArrowRight size={12} className="shrink-0 text-green-500" />
                  <span>
                    <strong>Currently recommended ↓</strong>&nbsp; Batch{' '}
                    <strong>{fefoRecommended.batchNumber}</strong> ({daysUntilExpiry(fefoRecommended.expiryDate)} days remaining)
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 1. Drug Selection ──────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-4">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
          <Package size={13} className="text-slate-400" />
          Select Drug
        </h2>

        {drugsLoading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <Loader2 size={15} className="animate-spin" /> Loading drugs…
          </div>
        ) : drugs.length === 0 ? (
          <p className="text-sm text-slate-400">No drugs found. Please seed the database from the Dashboard.</p>
        ) : (
          <div className="relative" ref={dropdownRef}>
            {/* Trigger button */}
            <button
              onClick={() => setDropdownOpen(v => !v)}
              className="w-full flex items-center justify-between gap-3 px-4 py-2.5 border border-slate-200 rounded-lg hover:border-slate-300 transition-colors bg-white text-left"
            >
              <span className={selectedDrug ? 'text-slate-800 font-medium text-sm' : 'text-slate-400 text-sm'}>
                {selectedDrug ? selectedDrug.name : 'Search and select a drug…'}
              </span>
              <ChevronDown
                size={15}
                className={`text-slate-400 shrink-0 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {/* Dropdown list */}
            {dropdownOpen && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-xl z-30">
                <div className="p-2 border-b border-slate-100">
                  <input
                    autoFocus
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Type drug name or category…"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <ul className="max-h-60 overflow-y-auto">
                  {filteredDrugs.length === 0 ? (
                    <li className="px-4 py-3 text-sm text-slate-400 text-center">No drugs match</li>
                  ) : filteredDrugs.map(drug => (
                    <li key={drug.id}>
                      <button
                        onClick={() => {
                          setSelectedDrug(drug);
                          setDropdownOpen(false);
                          setSearchQuery('');
                          setQuantity('');
                        }}
                        className={`w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center justify-between transition-colors ${
                          selectedDrug?.id === drug.id ? 'bg-blue-50' : ''
                        }`}
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-700">{drug.name}</p>
                          <p className="text-xs text-slate-400">{drug.category}</p>
                        </div>
                        <span className="text-xs text-slate-400 shrink-0 ml-4">{drug.unit}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Drug summary strip */}
        {selectedDrug && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Category',        value: selectedDrug.category },
              { label: 'Unit',            value: selectedDrug.unit },
              { label: 'Available Stock', value: `${totalAvailStock} ${selectedDrug.unit}` },
              { label: 'Active Batches',  value: String(availableBatches.length) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-0.5">{label}</p>
                <p className="text-sm font-semibold text-slate-700 truncate">{value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 2. FEFO Batch Display ─────────────────────────────────────────── */}
      {selectedDrug && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-4">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
            <Clock size={13} className="text-slate-400" />
            Batches — FEFO Order (Nearest Expiry First)
          </h2>

          {batchesLoading ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Loader2 size={15} className="animate-spin" /> Loading batches…
            </div>
          ) : sortedBatches.length === 0 ? (
            <p className="text-sm text-slate-400">No batches found for this drug.</p>
          ) : (
            <div className="space-y-2.5">
              {sortedBatches.map(batch => {
                const days          = daysUntilExpiry(batch.expiryDate);
                const expired       = days < 0;
                const depleted      = batch.quantity === 0;
                const isRecommended = !expired && !depleted && batch.id === fefoRecommended?.id;

                return (
                  <div
                    key={batch.id}
                    className={`rounded-xl p-4 ${batchCardClass(batch, isRecommended)}`}
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">

                        {/* Batch number + status badges */}
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <span className={`text-sm font-semibold ${
                            expired || depleted ? 'line-through text-slate-400' : 'text-slate-800'
                          }`}>
                            {batch.batchNumber}
                          </span>

                          {isRecommended && (
                            <span className="inline-flex items-center gap-1 bg-green-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">
                              <CheckCircle size={9} /> FEFO RECOMMENDED
                            </span>
                          )}
                          {expired && (
                            <span className="inline-flex items-center gap-1 bg-red-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">
                              <AlertTriangle size={9} /> EXPIRED
                            </span>
                          )}
                          {!expired && depleted && (
                            <span className="inline-flex items-center gap-1 bg-slate-400 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">
                              DEPLETED
                            </span>
                          )}
                        </div>

                        {/* Detail row */}
                        <div className="flex items-center gap-4 flex-wrap text-xs text-slate-500">
                          <span>
                            Qty: <strong className={depleted ? 'text-slate-400' : 'text-slate-700'}>
                              {batch.quantity}
                            </strong>
                          </span>
                          <span>
                            Expiry: <strong className={expiryTextColor(days)}>
                              {format(parseISO(batch.expiryDate), 'dd MMM yyyy')}
                            </strong>
                          </span>
                          <span className={`font-medium ${expiryTextColor(days)}`}>
                            {expired
                              ? `Expired ${Math.abs(days)}d ago`
                              : days === 0
                              ? 'Expires today!'
                              : `${days} day${days !== 1 ? 's' : ''} remaining`}
                          </span>
                        </div>

                        {/* Training mode annotation */}
                        {fefoTraining && isRecommended && (
                          <div className="mt-2 pt-2 border-t border-green-200 flex items-center gap-1.5 text-xs text-green-700">
                            <ArrowRight size={11} className="shrink-0" />
                            This batch expires soonest — FEFO selects it first to prevent expiry waste
                          </div>
                        )}
                      </div>

                      {/* Expiry dot */}
                      <div className={`w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${expiryDotColor(days)}`} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 3. Dispense Form ──────────────────────────────────────────────── */}
      {selectedDrug && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Package size={13} className="text-slate-400" />
            Dispense
          </h2>

          {fefoRecommended ? (
            <>
              {/* Auto-selection notice */}
              <div className="mb-4 flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
                <CheckCircle size={15} className="shrink-0" />
                Auto-selected: <strong className="ml-1">Batch {fefoRecommended.batchNumber}</strong>
                &nbsp;({daysUntilExpiry(fefoRecommended.expiryDate)} days to expiry)
              </div>

              {/* Quantity input */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Quantity to Dispense{' '}
                  <span className="font-normal text-slate-400">({selectedDrug.unit})</span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={totalAvailStock}
                  value={quantity}
                  onChange={e =>
                    setQuantity(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10)))
                  }
                  placeholder={`Max ${totalAvailStock}`}
                  className="w-full sm:w-52 px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-400"
                />
              </div>

              {/* FEFO allocation plan */}
              {qty > 0 && splitPlan.length > 0 && (
                <div className="mb-4 bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                    FEFO Allocation Plan
                  </p>
                  <div className="space-y-2">
                    {splitPlan.map(({ batch, take }, i) => (
                      <div key={batch.id} className="flex items-center gap-3 text-sm flex-wrap">
                        <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[11px] font-bold shrink-0 ${
                          i === 0 ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'
                        }`}>
                          {i + 1}
                        </span>
                        <span className="font-medium text-slate-700 truncate max-w-[120px]">
                          {batch.batchNumber}
                        </span>
                        <ArrowRight size={13} className="text-slate-400 shrink-0" />
                        <span className="font-semibold text-slate-800 shrink-0">
                          {take} {selectedDrug.unit}
                        </span>
                        <span className="text-slate-400 text-xs shrink-0">
                          exp: {format(parseISO(batch.expiryDate), 'dd MMM yyyy')}
                        </span>
                      </div>
                    ))}
                  </div>
                  {splitPlan.length > 1 && (
                    <p className="mt-3 text-xs text-blue-600 flex items-center gap-1.5">
                      <Info size={11} />
                      Auto-split across {splitPlan.length} batches in FEFO order
                    </p>
                  )}
                </div>
              )}

              {/* Insufficient stock warning */}
              {qty > 0 && !splitCovers && (
                <div className="mb-4 flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm">
                  <AlertTriangle size={15} className="shrink-0" />
                  Insufficient stock — only {totalAvailStock} {selectedDrug.unit} available
                </div>
              )}

              <button
                disabled={qty <= 0 || !splitCovers || dispensing}
                onClick={() => setShowConfirm(true)}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors"
              >
                {dispensing ? <Loader2 size={15} className="animate-spin" /> : <Package size={15} />}
                Dispense
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm">
              <AlertTriangle size={15} className="shrink-0" />
              No available stock — all batches are expired or fully depleted
            </div>
          )}
        </div>
      )}

      {/* ── Confirmation Modal ─────────────────────────────────────────────── */}
      {showConfirm && selectedDrug && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-800">Confirm Dispense</h3>
              <button
                onClick={() => setShowConfirm(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors rounded-lg p-1"
              >
                <X size={20} />
              </button>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 mb-5 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Drug</span>
                <span className="font-semibold text-slate-800">{selectedDrug.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Total Quantity</span>
                <span className="font-semibold text-slate-800">{qty} {selectedDrug.unit}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Dispensed By</span>
                <span className="font-semibold text-slate-800">
                  {user?.displayName || user?.email || profile?.name || '—'}
                </span>
              </div>
              <div className="border-t border-slate-200 pt-3">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Batch Allocation</p>
                {splitPlan.map(({ batch, take }) => (
                  <div key={batch.id} className="flex items-center justify-between mb-1.5">
                    <span className="text-slate-700">{batch.batchNumber}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-400 text-xs">
                        exp: {format(parseISO(batch.expiryDate), 'dd MMM yyyy')}
                      </span>
                      <span className="font-semibold text-slate-800">{take} {selectedDrug.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDispense}
                disabled={dispensing}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {dispensing
                  ? <><Loader2 size={14} className="animate-spin" /> Processing…</>
                  : 'Confirm Dispense'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-lg text-sm font-medium max-w-sm ${
            toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
          }`}
        >
          {toast.type === 'success'
            ? <CheckCircle size={16} />
            : <AlertTriangle size={16} />}
          <span className="flex-1">{toast.message}</span>
          <button onClick={() => setToast(null)} className="opacity-70 hover:opacity-100 shrink-0">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
