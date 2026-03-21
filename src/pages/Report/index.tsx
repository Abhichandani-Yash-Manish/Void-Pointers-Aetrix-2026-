import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../config/firebase';
import type { Drug, Batch, DispenseLog } from '../../types';
import { differenceInDays, format, parseISO, startOfToday } from 'date-fns';
import { AlertTriangle, CheckCircle, Download, FileText, Printer } from 'lucide-react';
import { jsPDF } from 'jspdf';

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
  daysUntilExpiry: number;
}

interface TopDrug extends Drug {
  totalDispensed: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TODAY = startOfToday();

// ─── Helpers ────────────────────────────────────────────────────────────────

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

/** Replace ₹ with "Rs." for jsPDF (standard fonts don't render the rupee symbol) */
const pdfStr = (s: string) => s.replace(/₹/g, 'Rs.');
const pdfMoney = (n: number) => `Rs.${inr(n)}`;

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function ReportPage() {
  const [allBatches, setAllBatches] = useState<InternalBatch[]>([]);
  const [allDrugs,   setAllDrugs]   = useState<Drug[]>([]);
  const [dispLogs,   setDispLogs]   = useState<DispenseLog[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [hospitalName, setHospitalName] = useState('District Hospital, Ahmedabad');
  const [officerName,  setOfficerName]  = useState('Hospital Superintendent');

  // ── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const drugSnaps = await getDocs(collection(db, 'drugs'));
        const drugs = drugSnaps.docs.map(d => ({ id: d.id, ...d.data() } as Drug));
        setAllDrugs(drugs);

        const batches: InternalBatch[] = [];
        await Promise.all(
          drugs.map(async drug => {
            const bSnaps = await getDocs(collection(db, 'drugs', drug.id, 'batches'));
            bSnaps.docs.forEach(bd => {
              const b = { id: bd.id, ...bd.data() } as Batch;
              batches.push({
                batchId:         b.id,
                drugId:          drug.id,
                drugName:        drug.name,
                drugCategory:    drug.category,
                batchNumber:     b.batchNumber,
                quantity:        b.quantity,
                expiryDate:      b.expiryDate,
                costPerUnit:     b.costPerUnit,
                daysUntilExpiry: differenceInDays(parseISO(b.expiryDate), TODAY),
              });
            });
          })
        );
        setAllBatches(batches);

        const logSnaps = await getDocs(collection(db, 'dispenseLogs'));
        setDispLogs(logSnaps.docs.map(d => ({ id: d.id, ...d.data() } as DispenseLog)));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Report period ─────────────────────────────────────────────────────────
  const reportPeriod = useMemo(() => {
    if (!dispLogs.length) return 'No dispense records found';
    const sorted = dispLogs.map(l => l.timestamp).sort();
    return `${format(parseISO(sorted[0]), 'dd MMM yyyy')} – ${format(parseISO(sorted[sorted.length - 1]), 'dd MMM yyyy')}`;
  }, [dispLogs]);

  // ── All derived report data ────────────────────────────────────────────────
  const rd = useMemo(() => {
    // Lookups
    const batchMap = new Map<string, InternalBatch>();
    allBatches.forEach(b => batchMap.set(b.batchId, b));

    const drugBatchMap = new Map<string, InternalBatch[]>();
    allBatches.forEach(b => {
      const arr = drugBatchMap.get(b.drugId) ?? [];
      arr.push(b);
      drugBatchMap.set(b.drugId, arr);
    });

    // Counts
    const totalDrugs     = allDrugs.length;
    const totalBatches   = allBatches.length;
    const totalDispenses = dispLogs.length;

    // Expired / near-expiry
    const expiredBatches    = allBatches.filter(b => b.daysUntilExpiry <= 0 && b.quantity > 0);
    const nearExpiryBatches = allBatches.filter(b => b.daysUntilExpiry > 0 && b.daysUntilExpiry <= 30 && b.quantity > 0);

    // Value saved + rescued units (batch within 60 days of expiry at time of dispense)
    let valueSaved   = 0;
    let rescuedUnits = 0;
    dispLogs.forEach(log => {
      const b = batchMap.get(log.batchId);
      if (!b) return;
      const daysLeft = differenceInDays(parseISO(b.expiryDate), parseISO(log.timestamp));
      if (daysLeft >= 0 && daysLeft <= 60) {
        valueSaved   += log.quantity * b.costPerUnit;
        rescuedUnits += log.quantity;
      }
    });

    const expiredValue = expiredBatches.reduce((s, b) => s + b.quantity * b.costPerUnit, 0);
    const totalSaved   = expiredValue + valueSaved;

    const lowStockDrugs = allDrugs.filter(d => d.currentStock <= d.reorderLevel);

    // FEFO compliance: check if dispensed batch had expiry ≤ median for its drug
    const matchable = dispLogs.filter(l => batchMap.has(l.batchId));
    const compliant = matchable.filter(l => {
      const b = batchMap.get(l.batchId)!;
      const drugBatches = drugBatchMap.get(l.drugId) ?? [];
      if (drugBatches.length <= 1) return true;
      const sorted = [...drugBatches].sort((a, c) => a.expiryDate.localeCompare(c.expiryDate));
      const median = sorted[Math.floor(sorted.length / 2)].expiryDate;
      return b.expiryDate <= median;
    });
    const fefoCompliance = matchable.length > 0
      ? Math.min(100, Math.round((compliant.length / matchable.length) * 100))
      : 100;

    // Top 5 drugs by dispensed quantity
    const drugDispMap: Record<string, number> = {};
    dispLogs.forEach(l => { drugDispMap[l.drugId] = (drugDispMap[l.drugId] || 0) + l.quantity; });
    const topDrugs: TopDrug[] = allDrugs
      .map(d => ({ ...d, totalDispensed: drugDispMap[d.id] || 0 }))
      .sort((a, b) => b.totalDispensed - a.totalDispensed)
      .slice(0, 5);

    // Attention batches (expired first, then near-expiry, max 10)
    const attentionBatches = [...expiredBatches, ...nearExpiryBatches]
      .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
      .slice(0, 10);

    // Auto-generated recommendations
    const recommendations: string[] = [];
    const criticalDrugs = allDrugs.filter(d => d.currentStock > 0 && d.currentStock <= d.reorderLevel * 0.5);
    if (criticalDrugs.length > 0) {
      const names = criticalDrugs.map(d => d.name).slice(0, 2).join(', ');
      const extra = criticalDrugs.length > 2 ? ` and ${criticalDrugs.length - 2} more` : '';
      recommendations.push(`URGENT: ${names}${extra} critically low — immediate reorder required.`);
    }
    if (expiredBatches.length > 0) {
      recommendations.push(
        `DISPOSAL: ${expiredBatches.length} expired batch${expiredBatches.length > 1 ? 'es' : ''} ` +
        `totaling ₹${inr(expiredValue)} require safe disposal per GMSCL guidelines.`
      );
    }
    const annualProjection = totalSaved * 2;
    recommendations.push(
      `Continue FEFO protocol compliance to maintain projected annual savings of ₹${inr(annualProjection)}.`
    );

    return {
      totalDrugs, totalBatches, totalDispenses,
      expiredBatches, nearExpiryBatches, attentionBatches,
      valueSaved, rescuedUnits, expiredValue, totalSaved,
      lowStockDrugs, fefoCompliance, topDrugs, recommendations,
      annualProjection,
    };
  }, [allBatches, allDrugs, dispLogs]);

  // ── jsPDF generation ──────────────────────────────────────────────────────
  function handleDownloadPDF() {
    const doc  = new jsPDF('p', 'mm', 'a4');
    const PW   = 210;
    const ML   = 14;
    const CW   = PW - ML * 2; // 182mm
    let y      = 0;

    const newPage = () => { doc.addPage(); y = 15; };
    const checkY  = (need: number) => { if (y + need > 278) newPage(); };

    // ── Header bar ──────────────────────────────────────────────────────────
    doc.setFillColor(30, 58, 95);
    doc.rect(0, 0, PW, 26, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('PharmaGuard Gujarat - Impact Report', ML, 11);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.text('Digital Drug Inventory Management System | FEFO + ML Forecasting', ML, 18);
    doc.text(`Generated: ${format(new Date(), 'dd MMM yyyy, HH:mm')}`, PW - ML, 18, { align: 'right' });
    y = 33;

    // ── Hospital info ────────────────────────────────────────────────────────
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(hospitalName, ML, y);
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Reporting Officer: ${officerName}`, ML, y); y += 6;
    doc.text(`Report Period: ${reportPeriod}`,     ML, y); y += 9;
    doc.setDrawColor(200, 200, 200);
    doc.line(ML, y, PW - ML, y);
    y += 10;

    // ── Executive Summary ────────────────────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 58, 95);
    doc.text('EXECUTIVE SUMMARY', ML, y);
    y += 8;

    const bw = (CW - 5) / 2;  // ~88.5mm
    const bh = 23;

    // Row 1 of boxes
    const drawBox = (x: number, bY: number, fill: [number, number, number], bigText: string, smallText: string) => {
      doc.setFillColor(...fill);
      doc.rect(x, bY, bw, bh, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(bigText, x + bw / 2, bY + 10, { align: 'center' });
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.text(smallText, x + bw / 2, bY + 17, { align: 'center' });
    };

    drawBox(ML,          y, [5, 150, 105],  pdfMoney(rd.totalSaved),       'Total Waste Prevented');
    drawBox(ML + bw + 5, y, [30, 58, 95],   String(rd.totalDispenses),     'Total Dispenses Processed');
    y += bh + 4;
    drawBox(ML,          y, [37, 99, 235],  `${rd.fefoCompliance}%`,       'FEFO Compliance Rate');
    drawBox(ML + bw + 5, y, [220, 38, 38],
      String(rd.expiredBatches.length + rd.nearExpiryBatches.length),      'Batches Requiring Attention');
    y += bh + 12;

    doc.setTextColor(0, 0, 0);
    checkY(50);

    // ── Inventory Overview ───────────────────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 58, 95);
    doc.text('INVENTORY OVERVIEW', ML, y);
    y += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);

    const lowNames = rd.lowStockDrugs.map(d => d.name).slice(0, 3).join(', ')
      + (rd.lowStockDrugs.length > 3 ? ` +${rd.lowStockDrugs.length - 3} more` : '');

    [
      `Total drugs managed: ${rd.totalDrugs}`,
      `Total batches tracked: ${rd.totalBatches}`,
      `Current low-stock items: ${rd.lowStockDrugs.length}${rd.lowStockDrugs.length > 0 ? ` (${lowNames})` : ''}`,
      `Expired batches requiring disposal: ${rd.expiredBatches.length}`,
    ].forEach(line => {
      const wrapped = doc.splitTextToSize(`  * ${line}`, CW - 4);
      doc.text(wrapped, ML + 2, y);
      y += wrapped.length * 6.5;
    });

    y += 5;
    doc.setDrawColor(200, 200, 200);
    doc.line(ML, y, PW - ML, y);
    y += 10;
    checkY(40);

    // ── FEFO Compliance ──────────────────────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 58, 95);
    doc.text('FEFO COMPLIANCE', ML, y);
    y += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);

    [
      `${rd.fefoCompliance}% of dispenses followed First Expiry First Out protocol.`,
      `Near-expiry batches caught and dispensed in time: ${rd.rescuedUnits} units.`,
      `Estimated waste prevented: ${pdfMoney(rd.valueSaved)}.`,
    ].forEach(line => {
      doc.text(`  * ${line}`, ML + 2, y);
      y += 7;
    });

    doc.setFontSize(8.5);
    doc.setTextColor(130, 130, 130);
    const caveatLines = doc.splitTextToSize(
      'Note: FEFO Compliance is calculated against current batch inventory. Historical compliance may vary as batches are added or depleted.',
      CW - 4
    );
    doc.text(caveatLines, ML + 2, y);
    y += caveatLines.length * 6;
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);

    y += 5;
    doc.setDrawColor(200, 200, 200);
    doc.line(ML, y, PW - ML, y);
    y += 10;
    checkY(60);

    // ── Top 5 Drugs ──────────────────────────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 58, 95);
    doc.text('TOP 5 DRUGS BY USAGE', ML, y);
    y += 8;

    const dc = [76, 34, 36, 36];  // column widths summing to CW
    const tblHeaders = ['Drug Name', 'Total Dispensed', 'Current Stock', 'Status'];

    // Header row
    doc.setFillColor(30, 58, 95);
    doc.rect(ML, y - 5.5, CW, 7.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    let cx = ML;
    tblHeaders.forEach((h, i) => { doc.text(h, cx + 2, y); cx += dc[i]; });
    y += 7;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    rd.topDrugs.forEach((drug, idx) => {
      if (idx % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(ML, y - 5.5, CW, 7.5, 'F');
      }
      const status = drug.currentStock <= drug.reorderLevel * 0.5 ? 'Critical'
        : drug.currentStock <= drug.reorderLevel ? 'Low' : 'OK';
      doc.setTextColor(0, 0, 0);
      cx = ML;
      [drug.name.slice(0, 32), String(drug.totalDispensed), `${drug.currentStock} ${drug.unit}`, status]
        .forEach((cell, i) => {
          if (i === 3) {
            if (status === 'Critical') doc.setTextColor(220, 38, 38);
            else if (status === 'Low')  doc.setTextColor(180, 100, 0);
            else                        doc.setTextColor(5, 130, 90);
          }
          doc.text(cell, cx + 2, y);
          doc.setTextColor(0, 0, 0);
          cx += dc[i];
        });
      y += 7;
    });

    y += 5;
    doc.setDrawColor(200, 200, 200);
    doc.line(ML, y, PW - ML, y);
    y += 10;
    checkY(60);

    // ── Batches Requiring Attention ──────────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 58, 95);
    doc.text('BATCHES REQUIRING ATTENTION', ML, y);
    y += 8;

    const bc = [56, 26, 18, 28, 22, 32];  // col widths
    const bHeaders = ['Drug Name', 'Batch #', 'Qty', 'Expiry Date', 'Days Left', 'Action Needed'];

    doc.setFillColor(180, 40, 40);
    doc.rect(ML, y - 5.5, CW, 7.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    cx = ML;
    bHeaders.forEach((h, i) => { doc.text(h, cx + 2, y); cx += bc[i]; });
    y += 7;

    doc.setFont('helvetica', 'normal');
    rd.attentionBatches.forEach((b, idx) => {
      checkY(9);
      if (idx % 2 === 0) {
        doc.setFillColor(255, 244, 244);
        doc.rect(ML, y - 5.5, CW, 7.5, 'F');
      }
      const action = b.daysUntilExpiry <= 0 ? 'DISPOSE'
        : b.daysUntilExpiry <= 7 ? 'URGENT' : 'Monitor';
      doc.setTextColor(0, 0, 0);
      cx = ML;
      [
        b.drugName.slice(0, 22),
        b.batchNumber.slice(0, 12),
        String(b.quantity),
        format(parseISO(b.expiryDate), 'dd/MM/yy'),
        b.daysUntilExpiry <= 0 ? 'Expired' : `${b.daysUntilExpiry}d`,
        action,
      ].forEach((cell, i) => {
        if (i === 5) {
          if (action === 'DISPOSE') doc.setTextColor(220, 38, 38);
          else if (action === 'URGENT') doc.setTextColor(200, 90, 0);
        }
        doc.text(cell, cx + 2, y);
        doc.setTextColor(0, 0, 0);
        cx += bc[i];
      });
      y += 7;
    });

    y += 5;
    checkY(50);
    doc.setDrawColor(200, 200, 200);
    doc.line(ML, y, PW - ML, y);
    y += 10;

    // ── Recommendations ──────────────────────────────────────────────────────
    checkY(40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 58, 95);
    doc.text('RECOMMENDATIONS', ML, y);
    y += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);

    rd.recommendations.forEach((rec, i) => {
      checkY(14);
      const lines = doc.splitTextToSize(`${i + 1}. ${pdfStr(rec)}`, CW - 4);
      doc.text(lines, ML + 2, y);
      y += lines.length * 7 + 2;
    });

    // ── Footer ───────────────────────────────────────────────────────────────
    checkY(18);
    y += 5;
    doc.setDrawColor(200, 200, 200);
    doc.line(ML, y, PW - ML, y);
    y += 6;
    doc.setFontSize(8);
    doc.setTextColor(130, 130, 130);
    doc.text('Generated by PharmaGuard Gujarat v1.0', ML, y);
    doc.text('Designed for GMSCL / e-Aushadhi Hospital Integration', PW / 2, y, { align: 'center' });
    doc.text(format(new Date(), 'dd MMM yyyy, HH:mm'), PW - ML, y, { align: 'right' });

    doc.save(`PharmaGuard_Impact_Report_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6 space-y-5 animate-pulse">
        <div className="h-8 bg-gray-200 dark:bg-slate-700 rounded w-64" />
        <div className="h-36 bg-gray-200 dark:bg-slate-700 rounded-xl" />
        <div className="h-[900px] bg-gray-200 dark:bg-slate-700 rounded-xl" />
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 space-y-5">

      {/* Page header */}
      <div className="flex items-center gap-2">
        <FileText size={22} className="text-blue-700" />
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-slate-100">Impact Report Generator</h1>
          <p className="text-xs text-gray-400 dark:text-slate-500">Configure, preview, and download your pharmacy impact report</p>
        </div>
      </div>

      {/* ── Config panel ──────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm p-5">
        <h2 className="font-semibold text-gray-700 dark:text-slate-200 mb-4">Report Configuration</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Hospital Name</label>
            <input
              type="text"
              value={hospitalName}
              onChange={e => setHospitalName(e.target.value)}
              className="w-full border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-slate-100 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Reporting Officer</label>
            <input
              type="text"
              value={officerName}
              onChange={e => setOfficerName(e.target.value)}
              className="w-full border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-slate-100 bg-white dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
        </div>

        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Report Period <span className="text-gray-400 dark:text-slate-500 font-normal">(auto-calculated from dispense logs)</span>
          </label>
          <p className="text-sm font-medium text-gray-700 dark:text-slate-200 border border-gray-100 dark:border-slate-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-slate-700">
            {reportPeriod}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setShowPreview(v => !v)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
          >
            <FileText size={15} />
            {showPreview ? 'Hide Preview' : 'Generate Preview'}
          </button>
          <button
            onClick={handleDownloadPDF}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
          >
            <Download size={15} /> Download PDF
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
          >
            <Printer size={15} /> Print
          </button>
        </div>
      </div>

      {/* ── HTML Preview ──────────────────────────────────────────────────── */}
      {showPreview && (
        <div className="overflow-x-auto">
          {/* A4 proportioned container (794px ≈ 210mm @ 96dpi) */}
          <div
            className="bg-white shadow-2xl border border-gray-300 mx-auto text-gray-800"
            style={{ maxWidth: 794, minWidth: 560, fontFamily: "'Georgia', 'Times New Roman', serif" }}
          >
            {/* Header bar */}
            <div className="bg-[#1e3a5f] text-white px-8 py-5">
              <h1 className="text-xl font-bold tracking-tight leading-snug">
                PharmaGuard Gujarat — Impact Report
              </h1>
              <p className="text-blue-200 text-xs mt-1">
                Digital Drug Inventory Management System · FEFO + ML Forecasting
              </p>
              <p className="text-blue-300 text-xs mt-0.5 text-right">
                Generated: {format(new Date(), 'dd MMM yyyy, HH:mm')}
              </p>
            </div>

            <div className="px-10 py-8 space-y-7 text-sm">

              {/* Hospital info */}
              <div>
                <h2 className="text-lg font-bold text-gray-900">{hospitalName}</h2>
                <p className="text-gray-500 mt-0.5">Reporting Officer: {officerName}</p>
                <p className="text-gray-500">Report Period: {reportPeriod}</p>
              </div>
              <hr className="border-gray-200" />

              {/* Executive Summary */}
              <section>
                <h3 className="text-[11px] font-bold text-[#1e3a5f] uppercase tracking-widest mb-4">
                  Executive Summary
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-emerald-600 text-white rounded-lg p-5 text-center">
                    <p className="text-2xl font-black">₹{inr(rd.totalSaved)}</p>
                    <p className="text-emerald-100 text-xs mt-1">Total Waste Prevented</p>
                  </div>
                  <div className="bg-[#1e3a5f] text-white rounded-lg p-5 text-center">
                    <p className="text-2xl font-black">{rd.totalDispenses}</p>
                    <p className="text-blue-200 text-xs mt-1">Total Dispenses Processed</p>
                  </div>
                  <div className="bg-blue-600 text-white rounded-lg p-5 text-center">
                    <p className="text-2xl font-black">{rd.fefoCompliance}%</p>
                    <p className="text-blue-100 text-xs mt-1">FEFO Compliance Rate</p>
                  </div>
                  <div className="bg-red-600 text-white rounded-lg p-5 text-center">
                    <p className="text-2xl font-black">
                      {rd.expiredBatches.length + rd.nearExpiryBatches.length}
                    </p>
                    <p className="text-red-100 text-xs mt-1">Batches Requiring Attention</p>
                  </div>
                </div>
              </section>
              <hr className="border-gray-200" />

              {/* Inventory Overview */}
              <section>
                <h3 className="text-[11px] font-bold text-[#1e3a5f] uppercase tracking-widest mb-3">
                  Inventory Overview
                </h3>
                <ul className="space-y-2 text-gray-700">
                  <li className="flex items-center gap-2">
                    <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                    Total drugs managed: <span className="font-semibold ml-1">{rd.totalDrugs}</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                    Total batches tracked: <span className="font-semibold ml-1">{rd.totalBatches}</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <AlertTriangle size={14} className="text-yellow-500 shrink-0 mt-0.5" />
                    <span>
                      Current low-stock items:{' '}
                      <span className="font-semibold">{rd.lowStockDrugs.length}</span>
                      {rd.lowStockDrugs.length > 0 && (
                        <span className="text-gray-400 ml-1">
                          ({rd.lowStockDrugs.map(d => d.name).slice(0, 4).join(', ')}
                          {rd.lowStockDrugs.length > 4 ? '…' : ''})
                        </span>
                      )}
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <AlertTriangle size={14} className="text-red-500 shrink-0" />
                    Expired batches requiring disposal:{' '}
                    <span className="font-semibold text-red-600 ml-1">{rd.expiredBatches.length}</span>
                  </li>
                </ul>
              </section>
              <hr className="border-gray-200" />

              {/* FEFO Compliance */}
              <section>
                <h3 className="text-[11px] font-bold text-[#1e3a5f] uppercase tracking-widest mb-3">
                  FEFO Compliance
                </h3>
                <ul className="space-y-2 text-gray-700">
                  <li className="flex items-center gap-2">
                    <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                    <span>
                      <span className="font-semibold text-emerald-700">{rd.fefoCompliance}%</span>
                      {' '}of dispenses followed First Expiry First Out protocol.
                    </span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                    Near-expiry batches caught and dispensed in time:{' '}
                    <span className="font-semibold ml-1">{rd.rescuedUnits} units</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                    Estimated waste prevented:{' '}
                    <span className="font-semibold text-emerald-700 ml-1">₹{inr(rd.valueSaved)}</span>
                  </li>
                </ul>
                <p className="text-xs text-gray-400 mt-3 italic">
                  Note: FEFO Compliance is calculated against current batch inventory. Historical compliance may vary as batches are added or depleted.
                </p>
              </section>
              <hr className="border-gray-200" />

              {/* Top 5 Drugs */}
              <section>
                <h3 className="text-[11px] font-bold text-[#1e3a5f] uppercase tracking-widest mb-3">
                  Top 5 Drugs by Usage
                </h3>
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#1e3a5f] text-white">
                      <th className="text-left px-3 py-2 font-semibold rounded-tl-md">Drug Name</th>
                      <th className="text-right px-3 py-2 font-semibold">Total Dispensed</th>
                      <th className="text-right px-3 py-2 font-semibold">Current Stock</th>
                      <th className="text-center px-3 py-2 font-semibold rounded-tr-md">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rd.topDrugs.map((drug, idx) => {
                      const status = drug.currentStock <= drug.reorderLevel * 0.5 ? 'Critical'
                        : drug.currentStock <= drug.reorderLevel ? 'Low' : 'OK';
                      return (
                        <tr key={drug.id} className={idx % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                          <td className="px-3 py-2.5 font-medium text-gray-800">{drug.name}</td>
                          <td className="px-3 py-2.5 text-right text-gray-600">
                            {drug.totalDispensed} {drug.unit}
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-600">
                            {drug.currentStock} {drug.unit}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              status === 'Critical' ? 'bg-red-100 text-red-700' :
                              status === 'Low'      ? 'bg-yellow-100 text-yellow-700' :
                                                      'bg-emerald-100 text-emerald-700'
                            }`}>
                              {status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
              <hr className="border-gray-200" />

              {/* Batches Requiring Attention */}
              <section>
                <h3 className="text-[11px] font-bold text-[#1e3a5f] uppercase tracking-widest mb-3">
                  Batches Requiring Attention
                  <span className="text-gray-400 font-normal normal-case text-xs ml-2">
                    · expired + expiring within 30 days · max 10 rows
                  </span>
                </h3>
                {rd.attentionBatches.length === 0 ? (
                  <p className="text-emerald-600 flex items-center gap-2">
                    <CheckCircle size={16} /> No batches require immediate attention.
                  </p>
                ) : (
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-red-700 text-white">
                        <th className="text-left px-3 py-2 font-semibold">Drug Name</th>
                        <th className="text-left px-3 py-2 font-semibold">Batch #</th>
                        <th className="text-right px-3 py-2 font-semibold">Qty</th>
                        <th className="text-left px-3 py-2 font-semibold">Expiry Date</th>
                        <th className="text-right px-3 py-2 font-semibold">Days Left</th>
                        <th className="text-center px-3 py-2 font-semibold">Action Needed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rd.attentionBatches.map((b, idx) => {
                        const action = b.daysUntilExpiry <= 0 ? 'DISPOSE'
                          : b.daysUntilExpiry <= 7 ? 'URGENT' : 'Monitor';
                        return (
                          <tr key={b.batchId} className={idx % 2 === 0 ? 'bg-red-50' : 'bg-white'}>
                            <td className="px-3 py-2.5 font-medium text-gray-800">{b.drugName}</td>
                            <td className="px-3 py-2.5 font-mono text-gray-500">{b.batchNumber}</td>
                            <td className="px-3 py-2.5 text-right text-gray-600">{b.quantity}</td>
                            <td className="px-3 py-2.5 text-gray-600">
                              {format(parseISO(b.expiryDate), 'dd MMM yyyy')}
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold">
                              {b.daysUntilExpiry <= 0
                                ? <span className="text-red-600">Expired</span>
                                : <span className="text-orange-600">{b.daysUntilExpiry}d</span>
                              }
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                action === 'DISPOSE' ? 'bg-red-100 text-red-700' :
                                action === 'URGENT'  ? 'bg-orange-100 text-orange-700' :
                                                       'bg-yellow-100 text-yellow-700'
                              }`}>
                                {action}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </section>
              <hr className="border-gray-200" />

              {/* Recommendations */}
              <section>
                <h3 className="text-[11px] font-bold text-[#1e3a5f] uppercase tracking-widest mb-4">
                  Recommendations
                </h3>
                <ol className="space-y-3">
                  {rd.recommendations.map((rec, i) => (
                    <li key={i} className="flex gap-3 text-gray-700">
                      <span className="w-6 h-6 rounded-full bg-[#1e3a5f] text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span>{rec}</span>
                    </li>
                  ))}
                </ol>
              </section>
              <hr className="border-gray-200" />

              {/* Footer */}
              <div className="text-center space-y-1 pb-2">
                <p className="text-xs text-gray-400">Generated by PharmaGuard Gujarat v1.0</p>
                <p className="text-xs text-gray-400">
                  Designed for GMSCL / e-Aushadhi Hospital Integration
                </p>
                <p className="text-xs text-gray-400">{format(new Date(), 'dd MMM yyyy, HH:mm')}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
