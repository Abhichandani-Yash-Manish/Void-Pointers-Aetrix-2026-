import { useEffect, useState, useMemo, useRef } from 'react';
import {
  collection, doc, onSnapshot, getDocs, writeBatch,
  addDoc, updateDoc, increment,
} from 'firebase/firestore';
import { format, differenceInDays, parseISO, isPast } from 'date-fns';
import {
  Package, AlertTriangle, Clock, IndianRupee,
  Search, ChevronDown, ChevronRight,
  Plus, Pencil, Trash2, Check, X, Loader2,
  ArrowUp, ArrowDown, ChevronsUpDown, FlaskConical,
  ShieldAlert, Filter,
} from 'lucide-react';
import { db } from '../../config/firebase';
import { useAuth } from '../../hooks/useAuth';
import type { Drug, Batch } from '../../types';

// ─── Constants ────────────────────────────────────────────────────────────────

const UNITS = [
  'tablets', 'capsules', 'vials', 'inhalers',
  'sachets', 'ampoules', 'syrup', 'injection', 'cream', 'drops',
];

const PRESET_CATEGORIES = [
  'Analgesic', 'Antibiotic', 'Antidiabetic', 'Antihypertensive',
  'Antacid', 'Antimalarial', 'Antihistamine', 'Respiratory',
  'NSAID', 'Lipid-lowering', 'Haematinic', 'Corticosteroid',
  'Rehydration', 'Supplement', 'Antifungal', 'Antiparasitic',
  'Vitamin', 'Other',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

type StockStatus = { label: string; bg: string; text: string; dot: string };

function getStockStatus(drug: Drug): StockStatus {
  if (drug.currentStock === 0)
    return { label: 'Out of Stock', bg: 'bg-red-100',    text: 'text-red-700',    dot: 'bg-red-500'    };
  if (drug.currentStock <= drug.reorderLevel)
    return { label: 'Low Stock',    bg: 'bg-amber-100',  text: 'text-amber-700',  dot: 'bg-amber-500'  };
  return   { label: 'In Stock',     bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' };
}

type ExpiryInfo = { label: string; bg: string; text: string };

function getExpiryInfo(expiryDate: string): ExpiryInfo {
  const expiry   = parseISO(expiryDate);
  const daysLeft = differenceInDays(expiry, new Date());
  if (isPast(expiry))
    return { label: `Expired ${Math.abs(daysLeft)}d ago`, bg: 'bg-red-100',    text: 'text-red-700'    };
  if (daysLeft <= 30)
    return { label: `⚠ ${daysLeft}d left`,                bg: 'bg-amber-100',  text: 'text-amber-700'  };
  if (daysLeft <= 90)
    return { label: `${daysLeft}d left`,                   bg: 'bg-yellow-100', text: 'text-yellow-700' };
  return   { label: format(expiry, 'MMM d, yyyy'),          bg: 'bg-emerald-50', text: 'text-emerald-700' };
}

function formatINR(value: number) {
  return '₹' + value.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

type SortKey = 'name' | 'category' | 'unit' | 'currentStock' | 'reorderLevel';
const BLANK_FORM = { name: '', category: '', unit: 'tablets', reorderLevel: '' };
const BLANK_BATCH = { batchNumber: '', quantity: '', expiryDate: '', receivedDate: '', costPerUnit: '' };

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  icon, label, value, sub, iconBg, loading = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  iconBg: string;
  loading?: boolean;
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 flex items-start gap-4">
      <div className={`${iconBg} rounded-lg p-2.5 shrink-0`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">{label}</p>
        {loading
          ? <div className="h-7 w-16 bg-slate-100 dark:bg-slate-700 rounded animate-pulse" />
          : <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 leading-none">{value}</p>
        }
        {sub && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Batch table (expanded row) ───────────────────────────────────────────────

function BatchTable({
  drugId, drugName, batches, batchLoading, isAdmin,
}: {
  drugId: string; drugName: string; batches: Batch[];
  batchLoading: boolean; isAdmin: boolean;
}) {
  const [showAdd, setShowAdd]   = useState(false);
  const [form, setForm]         = useState(BLANK_BATCH);
  const [saving, setSaving]     = useState(false);
  const [formErr, setFormErr]   = useState('');

  const sorted = [...batches].sort(
    (a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime(),
  );

  const handleAdd = async () => {
    const qty = parseInt(form.quantity, 10);
    const cost = parseFloat(form.costPerUnit);
    if (!form.batchNumber.trim() || !form.quantity || !form.expiryDate || !form.receivedDate || !form.costPerUnit) {
      setFormErr('All fields are required.'); return;
    }
    if (isNaN(qty) || qty <= 0) { setFormErr('Quantity must be positive.'); return; }
    if (isNaN(cost) || cost < 0) { setFormErr('Cost must be a valid number.'); return; }

    setSaving(true); setFormErr('');
    try {
      await addDoc(collection(db, 'drugs', drugId, 'batches'), {
        drugId,
        batchNumber: form.batchNumber.trim(),
        quantity: qty, expiryDate: form.expiryDate,
        receivedDate: form.receivedDate, costPerUnit: cost,
      });
      await updateDoc(doc(db, 'drugs', drugId), { currentStock: increment(qty) });
      setForm(BLANK_BATCH); setShowAdd(false);
    } catch (err) { console.error('Add batch:', err); setFormErr('Failed to save batch.'); }
    finally { setSaving(false); }
  };

  if (batchLoading) {
    return (
      <div className="bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-700 px-8 py-4 flex items-center gap-2 text-slate-400 dark:text-slate-500 text-sm">
        <Loader2 size={14} className="animate-spin" /> Loading batches…
      </div>
    );
  }

  return (
    <div className="bg-slate-50/70 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-700">
      {/* Batch header */}
      <div className="px-6 py-2.5 flex items-center justify-between border-b border-slate-200 dark:border-slate-700 bg-slate-100/60 dark:bg-slate-800/80">
        <div className="flex items-center gap-2">
          <FlaskConical size={13} className="text-slate-400 dark:text-slate-500" />
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {sorted.length} batch{sorted.length !== 1 && 'es'} · {drugName} · FEFO order
          </span>
        </div>
        {isAdmin && (
          <button
            onClick={() => { setShowAdd(v => !v); setFormErr(''); }}
            className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 bg-white dark:bg-slate-700 hover:bg-emerald-50 dark:hover:bg-slate-600 border border-emerald-200 dark:border-emerald-700 px-3 py-1.5 rounded-lg transition-colors shadow-sm"
          >
            {showAdd ? <X size={12} /> : <Plus size={12} />}
            {showAdd ? 'Cancel' : 'Add Batch'}
          </button>
        )}
      </div>

      {/* Batch rows */}
      {sorted.length === 0 && !showAdd ? (
        <p className="px-8 py-3 text-sm text-slate-400 dark:text-slate-500">No batches recorded for this drug.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                {['Batch Number', 'Quantity', 'Expiry Date', 'Received Date', '₹/Unit', 'Batch Value'].map(h => (
                  <th key={h} className={`px-5 py-2 font-semibold text-slate-500 dark:text-slate-400 ${h === 'Quantity' || h === '₹/Unit' || h === 'Batch Value' ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {sorted.map(batch => {
                const exp = getExpiryInfo(batch.expiryDate);
                return (
                  <tr key={batch.id} className="hover:bg-white/80 dark:hover:bg-slate-700/50 transition-colors">
                    <td className="px-5 py-2.5 font-mono text-slate-700 dark:text-slate-200 font-medium">{batch.batchNumber}</td>
                    <td className="px-5 py-2.5 text-right font-semibold text-slate-700 dark:text-slate-200">{batch.quantity.toLocaleString('en-IN')}</td>
                    <td className="px-5 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full font-medium ${exp.bg} ${exp.text}`}>
                        {exp.label}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-slate-500 dark:text-slate-400">
                      {format(parseISO(batch.receivedDate), 'dd MMM yyyy')}
                    </td>
                    <td className="px-5 py-2.5 text-right text-slate-600 dark:text-slate-300">₹{batch.costPerUnit.toFixed(2)}</td>
                    <td className="px-5 py-2.5 text-right font-medium text-slate-700 dark:text-slate-200">
                      {formatINR(batch.quantity * batch.costPerUnit)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add batch inline form */}
      {showAdd && (
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">New Batch Entry</p>
          {formErr && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 rounded-lg mb-3">{formErr}</p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {[
              { ph: 'Batch Number', val: form.batchNumber, key: 'batchNumber', type: 'text' },
              { ph: 'Quantity',     val: form.quantity,     key: 'quantity',     type: 'number' },
              { ph: 'Expiry Date',  val: form.expiryDate,   key: 'expiryDate',   type: 'date' },
              { ph: 'Received',     val: form.receivedDate, key: 'receivedDate', type: 'date' },
              { ph: '₹ Cost/Unit',  val: form.costPerUnit,  key: 'costPerUnit',  type: 'number' },
            ].map(f => (
              <input
                key={f.key}
                type={f.type}
                placeholder={f.ph}
                value={f.val}
                step={f.type === 'number' ? '0.01' : undefined}
                min={f.type === 'number' ? '0' : undefined}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                className="px-3 py-1.5 border border-slate-200 dark:border-slate-600 rounded-lg text-xs bg-slate-50 dark:bg-slate-700 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            ))}
            <button
              onClick={handleAdd}
              disabled={saving}
              className="flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Add / Edit Drug modal ────────────────────────────────────────────────────

function DrugModal({
  editDrug, categories, onClose, onSaved,
}: {
  editDrug: Drug | null;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm]   = useState(
    editDrug
      ? { name: editDrug.name, category: editDrug.category, unit: editDrug.unit, reorderLevel: String(editDrug.reorderLevel) }
      : BLANK_FORM,
  );
  const [err, setErr]     = useState('');
  const [saving, setSave] = useState(false);

  const allCats = useMemo(() => {
    const set = new Set([...categories, ...PRESET_CATEGORIES]);
    return Array.from(set).sort();
  }, [categories]);

  const handleSave = async () => {
    if (!form.name.trim())  { setErr('Drug name is required.'); return; }
    if (!form.category)     { setErr('Category is required.'); return; }
    if (!form.unit)         { setErr('Unit is required.'); return; }
    const rl = parseInt(form.reorderLevel, 10);
    if (isNaN(rl) || rl < 0) { setErr('Reorder level must be 0 or more.'); return; }

    setSave(true); setErr('');
    try {
      const payload = { name: form.name.trim(), category: form.category, unit: form.unit, reorderLevel: rl };
      if (editDrug) {
        await updateDoc(doc(db, 'drugs', editDrug.id), payload);
      } else {
        await addDoc(collection(db, 'drugs'), { ...payload, currentStock: 0 });
      }
      onSaved();
    } catch (err) { console.error('Save drug:', err); setErr('Save failed. Please try again.'); setSave(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2.5">
            <div className="bg-emerald-100 dark:bg-emerald-900/40 rounded-lg p-1.5">
              <Package size={16} className="text-emerald-700 dark:text-emerald-400" />
            </div>
            <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-base">
              {editDrug ? 'Edit Drug' : 'Add New Drug'}
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <div className="px-6 py-5 space-y-4">
          {err && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm px-4 py-2.5 rounded-lg flex items-center gap-2">
              <ShieldAlert size={14} className="shrink-0" />{err}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Drug Name *</label>
            <input
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Paracetamol 500mg"
              className="w-full px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Category *</label>
              <select
                value={form.category}
                onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              >
                <option value="">Select…</option>
                {allCats.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Unit *</label>
              <select
                value={form.unit}
                onChange={e => setForm(p => ({ ...p, unit: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              >
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">Reorder Level *</label>
            <input
              type="number"
              min="0"
              value={form.reorderLevel}
              onChange={e => setForm(p => ({ ...p, reorderLevel: e.target.value }))}
              placeholder="e.g. 200"
              className="w-full px-4 py-2.5 border border-slate-200 dark:border-slate-600 rounded-lg text-sm bg-slate-50 dark:bg-slate-700 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Alert triggers when current stock falls at or below this value.</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-white dark:hover:bg-slate-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-lg transition-colors shadow-sm"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {editDrug ? 'Save Changes' : 'Add Drug'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete confirm modal ─────────────────────────────────────────────────────

function DeleteConfirmModal({
  drug, onClose, onConfirm, deleting,
}: {
  drug: Drug; onClose: () => void; onConfirm: () => void; deleting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="bg-red-100 dark:bg-red-900/40 rounded-lg p-2">
            <Trash2 size={18} className="text-red-600 dark:text-red-400" />
          </div>
          <h2 className="font-semibold text-slate-800 dark:text-slate-100">Delete Drug?</h2>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-1">
          This will permanently delete <strong>{drug.name}</strong>.
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-5">
          This will also permanently delete all batch records for this drug.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-sm font-medium py-2.5 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const { profile } = useAuth();
  const isAdmin   = profile?.role === 'admin';
  const isManager = profile?.role === 'manager' || isAdmin;

  // ── Data ─────────────────────────────────────────────────────────────────
  const [drugs, setDrugs]                   = useState<Drug[]>([]);
  const [drugsLoading, setDrugsLoading]     = useState(true);
  const [allBatches, setAllBatches]         = useState<Record<string, Batch[]>>({});
  const [batchesLoading, setBatchesLoading] = useState(true);

  // ── UI ───────────────────────────────────────────────────────────────────
  const [expandedId, setExpandedId]         = useState<string | null>(null);
  const [search, setSearch]                 = useState('');
  const [catFilter, setCatFilter]           = useState('');
  const [sortKey, setSortKey]               = useState<SortKey>('name');
  const [sortDir, setSortDir]               = useState<'asc' | 'desc'>('asc');

  // Inline reorder-level edit (manager+)
  const [editReorderId, setEditReorderId]   = useState<string | null>(null);
  const [editReorderVal, setEditReorderVal] = useState('');
  const reorderInputRef                     = useRef<HTMLInputElement>(null);

  // Drug modal (admin)
  const [drugModalOpen, setDrugModalOpen]   = useState(false);
  const [drugModalEdit, setDrugModalEdit]   = useState<Drug | null>(null);

  // Delete (admin)
  const [deleteTarget, setDeleteTarget]     = useState<Drug | null>(null);
  const [deleting, setDeleting]             = useState(false);

  // ── Live drug listener ────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'drugs'), snap => {
      setDrugs(snap.docs.map(d => ({ id: d.id, ...d.data() } as Drug)));
      setDrugsLoading(false);
    });
    return unsub;
  }, []);

  // ── Fetch all batches (parallel) whenever drug list size changes ──────────
  useEffect(() => {
    if (!drugs.length) { setBatchesLoading(false); return; }
    setBatchesLoading(true);
    Promise.all(
      drugs.map(d =>
        getDocs(collection(db, 'drugs', d.id, 'batches')).then(snap => ({
          drugId:  d.id,
          batches: snap.docs.map(b => ({ id: b.id, ...b.data() } as Batch)),
        })),
      ),
    ).then(results => {
      setAllBatches(prev => {
        const next = { ...prev };
        results.forEach(({ drugId, batches }) => { next[drugId] = batches; });
        return next;
      });
      setBatchesLoading(false);
    });
  }, [drugs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived: categories ───────────────────────────────────────────────────
  const categories = useMemo(() => {
    const set = new Set(drugs.map(d => d.category));
    return Array.from(set).sort();
  }, [drugs]);

  // ── Derived: filtered + sorted drugs ─────────────────────────────────────
  const filteredSorted = useMemo(() => {
    let list = drugs;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(d =>
        d.name.toLowerCase().includes(q) || d.category.toLowerCase().includes(q),
      );
    }
    if (catFilter) list = list.filter(d => d.category === catFilter);

    return [...list].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [drugs, search, catFilter, sortKey, sortDir]);

  // ── Derived: summary stats ────────────────────────────────────────────────
  const stats = useMemo(() => {
    const flat    = Object.values(allBatches).flat();
    const today   = new Date();
    const expiring = flat.filter(b => {
      const d = differenceInDays(parseISO(b.expiryDate), today);
      return d >= 0 && d <= 30;
    }).length;
    const value     = flat.reduce((s, b) => s + b.quantity * b.costPerUnit, 0);
    const lowStock  = drugs.filter(d => d.currentStock > 0 && d.currentStock <= d.reorderLevel).length;
    const outStock  = drugs.filter(d => d.currentStock === 0).length;
    return { total: drugs.length, lowStock, outStock, expiring, value };
  }, [drugs, allBatches]);

  // ── Sort toggle ───────────────────────────────────────────────────────────
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey !== col
      ? <ChevronsUpDown size={13} className="opacity-25 shrink-0" />
      : sortDir === 'asc'
        ? <ArrowUp size={13} className="text-emerald-600 shrink-0" />
        : <ArrowDown size={13} className="text-emerald-600 shrink-0" />;

  // ── Reorder level inline edit ─────────────────────────────────────────────
  const startEditReorder = (drug: Drug) => {
    setEditReorderId(drug.id);
    setEditReorderVal(String(drug.reorderLevel));
    setTimeout(() => reorderInputRef.current?.select(), 30);
  };

  const saveReorder = async (drug: Drug) => {
    const val = parseInt(editReorderVal, 10);
    if (!isNaN(val) && val >= 0 && val !== drug.reorderLevel) {
      await updateDoc(doc(db, 'drugs', drug.id), { reorderLevel: val });
    }
    setEditReorderId(null);
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const batchSnap = await getDocs(collection(db, 'drugs', deleteTarget.id, 'batches'));
      const wb = writeBatch(db);
      batchSnap.docs.forEach(d => wb.delete(d.ref));
      wb.delete(doc(db, 'drugs', deleteTarget.id));
      await wb.commit();
      if (expandedId === deleteTarget.id) setExpandedId(null);
      setDeleteTarget(null);
    } catch (err) {
      console.error('Delete drug:', err);
    } finally { setDeleting(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 min-h-full">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Drug Inventory</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">Gujarat Essential Drug List — real-time stock</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => { setDrugModalEdit(null); setDrugModalOpen(true); }}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors shadow-sm shadow-emerald-600/20"
          >
            <Plus size={16} /> Add Drug
          </button>
        )}
      </div>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SummaryCard
          icon={<Package size={18} className="text-blue-600" />}
          iconBg="bg-blue-50"
          label="Total Drugs"
          value={drugsLoading ? '…' : stats.total}
          sub={drugsLoading ? '' : `${filteredSorted.length} shown`}
        />
        <SummaryCard
          icon={<AlertTriangle size={18} className="text-amber-600" />}
          iconBg="bg-amber-50"
          label="Low / Out of Stock"
          value={drugsLoading ? '…' : `${stats.lowStock + stats.outStock}`}
          sub={drugsLoading ? '' : `${stats.outStock} out · ${stats.lowStock} low`}
        />
        <SummaryCard
          icon={<Clock size={18} className="text-red-500" />}
          iconBg="bg-red-50"
          label="Expiring ≤ 30 Days"
          value={batchesLoading ? '…' : stats.expiring}
          sub="batches"
          loading={batchesLoading}
        />
        <SummaryCard
          icon={<IndianRupee size={18} className="text-emerald-600" />}
          iconBg="bg-emerald-50"
          label="Total Stock Value"
          value={batchesLoading ? '…' : formatINR(stats.value)}
          sub="across all batches"
          loading={batchesLoading}
        />
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search drugs or categories…"
            className="w-full pl-9 pr-4 py-2.5 border border-slate-200 dark:border-slate-700 rounded-lg text-sm bg-white dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent shadow-sm"
          />
        </div>
        <div className="relative">
          <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" />
          <select
            value={catFilter}
            onChange={e => setCatFilter(e.target.value)}
            className="pl-8 pr-8 py-2.5 border border-slate-200 dark:border-slate-700 rounded-lg text-sm bg-white dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent shadow-sm appearance-none min-w-[180px]"
          >
            <option value="">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* ── Table ── */}
      {drugsLoading ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3 text-slate-400 dark:text-slate-500">
            <Loader2 size={28} className="animate-spin" />
            <p className="text-sm">Loading inventory…</p>
          </div>
        </div>
      ) : filteredSorted.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-center py-16">
          <div className="text-center text-slate-400 dark:text-slate-500">
            <Package size={36} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm font-medium">No drugs found</p>
            <p className="text-xs mt-1">Try adjusting your search or filter</p>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {/* ── Table head ── */}
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                  {/* Expand toggle column */}
                  <th className="w-10 px-4 py-3" />

                  {(
                    [
                      { key: 'name',         label: 'Drug Name',      align: 'left'  },
                      { key: 'category',     label: 'Category',       align: 'left'  },
                      { key: 'unit',         label: 'Unit',           align: 'left'  },
                      { key: 'currentStock', label: 'Current Stock',  align: 'right' },
                      { key: 'reorderLevel', label: 'Reorder Level',  align: 'right' },
                    ] as { key: SortKey; label: string; align: string }[]
                  ).map(col => (
                    <th
                      key={col.key}
                      onClick={() => toggleSort(col.key)}
                      className={`px-4 py-3 font-semibold text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider cursor-pointer select-none hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                    >
                      <span className={`inline-flex items-center gap-1.5 ${col.align === 'right' ? 'flex-row-reverse' : ''}`}>
                        {col.label}
                        <SortIcon col={col.key} />
                      </span>
                    </th>
                  ))}

                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>

              {/* ── Table body ── */}
              <tbody>
                {filteredSorted.map(drug => {
                  const status     = getStockStatus(drug);
                  const isExpanded = expandedId === drug.id;
                  const isEditingRL = editReorderId === drug.id;
                  const drugBatches = allBatches[drug.id] ?? [];

                  return (
                    <>
                      {/* ── Drug row ── */}
                      <tr
                        key={drug.id}
                        className={`border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50/70 dark:hover:bg-slate-700/40 transition-colors ${isExpanded ? 'bg-slate-50/70 dark:bg-slate-700/30' : ''}`}
                      >
                        {/* Expand toggle */}
                        <td className="w-10 px-4 py-3">
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : drug.id)}
                            className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                            title={isExpanded ? 'Collapse batches' : 'Expand batches'}
                          >
                            {isExpanded
                              ? <ChevronDown size={16} />
                              : <ChevronRight size={16} />
                            }
                          </button>
                        </td>

                        {/* Drug name */}
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : drug.id)}
                            className="font-semibold text-slate-800 dark:text-slate-100 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors text-left"
                          >
                            {drug.name}
                          </button>
                        </td>

                        {/* Category */}
                        <td className="px-4 py-3">
                          <span className="inline-block bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium px-2.5 py-1 rounded-full">
                            {drug.category}
                          </span>
                        </td>

                        {/* Unit */}
                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400 capitalize">{drug.unit}</td>

                        {/* Current stock */}
                        <td className="px-4 py-3 text-right">
                          <span className={`font-bold tabular-nums ${drug.currentStock === 0 ? 'text-red-600' : drug.currentStock <= drug.reorderLevel ? 'text-amber-600' : 'text-slate-800'}`}>
                            {drug.currentStock.toLocaleString('en-IN')}
                          </span>
                        </td>

                        {/* Reorder level (inline-editable for manager+) */}
                        <td className="px-4 py-3 text-right">
                          {isEditingRL ? (
                            <input
                              ref={reorderInputRef}
                              type="number"
                              min="0"
                              value={editReorderVal}
                              onChange={e => setEditReorderVal(e.target.value)}
                              onBlur={() => saveReorder(drug)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') saveReorder(drug);
                                if (e.key === 'Escape') setEditReorderId(null);
                              }}
                              className="w-20 px-2 py-1 border-2 border-emerald-400 dark:border-emerald-500 rounded-lg text-sm text-right font-semibold focus:outline-none bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-100"
                            />
                          ) : (
                            <span className="text-slate-600 dark:text-slate-300 tabular-nums">{drug.reorderLevel.toLocaleString('en-IN')}</span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${status.bg} ${status.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                            {status.label}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {/* Edit reorder level (manager) or full edit (admin) */}
                            {isManager && (
                              <button
                                onClick={() => isAdmin ? (setDrugModalEdit(drug), setDrugModalOpen(true)) : startEditReorder(drug)}
                                title={isAdmin ? 'Edit drug' : 'Edit reorder level'}
                                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-lg transition-colors"
                              >
                                <Pencil size={14} />
                              </button>
                            )}
                            {/* Delete (admin only) */}
                            {isAdmin && (
                              <button
                                onClick={() => setDeleteTarget(drug)}
                                title="Delete drug"
                                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* ── Expanded batch row ── */}
                      {isExpanded && (
                        <tr key={`${drug.id}-batches`}>
                          <td colSpan={8} className="p-0">
                            <BatchTable
                              drugId={drug.id}
                              drugName={drug.name}
                              batches={drugBatches}
                              batchLoading={batchesLoading && !allBatches[drug.id]}
                              isAdmin={isAdmin}
                            />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table footer */}
          <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
            <span>
              Showing {filteredSorted.length} of {drugs.length} drugs
              {(search || catFilter) && ' (filtered)'}
            </span>
            <span>Click drug name or ▶ to view batches</span>
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {drugModalOpen && (
        <DrugModal
          editDrug={drugModalEdit}
          categories={categories}
          onClose={() => setDrugModalOpen(false)}
          onSaved={() => setDrugModalOpen(false)}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          drug={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
          deleting={deleting}
        />
      )}
    </div>
  );
}
