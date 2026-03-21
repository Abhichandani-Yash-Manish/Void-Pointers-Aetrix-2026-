import { collection, doc, writeBatch, getDoc } from 'firebase/firestore';
import {
  addDays,
  subMonths,
  format,
  getDaysInMonth,
} from 'date-fns';
import { db } from '../config/firebase';

export type SeedProgress = (message: string) => void;

// ─── Constants ───────────────────────────────────────────────────────────────

// Anchor "today" for deterministic expiry/received dates
const TODAY = new Date('2026-03-21T12:00:00');

// 6 months of history: Sep 2025 → Feb 2026
const HISTORY_MONTHS: Date[] = [
  new Date(2025, 8, 1),  // Sep 2025 — idx 0
  new Date(2025, 9, 1),  // Oct 2025 — idx 1
  new Date(2025, 10, 1), // Nov 2025 — idx 2
  new Date(2025, 11, 1), // Dec 2025 — idx 3
  new Date(2026, 0, 1),  // Jan 2026 — idx 4
  new Date(2026, 1, 1),  // Feb 2026 — idx 5
];

// ─── Drug definitions ─────────────────────────────────────────────────────────

interface DrugDef {
  name: string;
  category: string;
  unit: string;
  reorderLevel: number;
  costPerUnit: number;
  /** Base number of dispense events per month before seasonality */
  baseMonthlyEvents: number;
  /** [min, max] units per single dispense event */
  dispenseRange: [number, number];
}

const DRUG_DEFS: DrugDef[] = [
  // idx 00
  { name: 'Paracetamol 500mg',      category: 'Analgesic',        unit: 'tablets',  reorderLevel: 500, costPerUnit: 0.50,   baseMonthlyEvents: 5, dispenseRange: [20, 60] },
  // idx 01
  { name: 'Amoxicillin 250mg',      category: 'Antibiotic',       unit: 'capsules', reorderLevel: 300, costPerUnit: 3.00,   baseMonthlyEvents: 3, dispenseRange: [10, 30] },
  // idx 02
  { name: 'Metformin 500mg',        category: 'Antidiabetic',     unit: 'tablets',  reorderLevel: 400, costPerUnit: 1.50,   baseMonthlyEvents: 4, dispenseRange: [30, 60] },
  // idx 03
  { name: 'Amlodipine 5mg',         category: 'Antihypertensive', unit: 'tablets',  reorderLevel: 350, costPerUnit: 2.00,   baseMonthlyEvents: 3, dispenseRange: [20, 40] },
  // idx 04
  { name: 'Omeprazole 20mg',        category: 'Antacid',          unit: 'capsules', reorderLevel: 300, costPerUnit: 2.50,   baseMonthlyEvents: 3, dispenseRange: [15, 35] },
  // idx 05
  { name: 'Ciprofloxacin 500mg',    category: 'Antibiotic',       unit: 'tablets',  reorderLevel: 250, costPerUnit: 5.00,   baseMonthlyEvents: 3, dispenseRange: [10, 25] },
  // idx 06
  { name: 'Atorvastatin 10mg',      category: 'Lipid-lowering',   unit: 'tablets',  reorderLevel: 200, costPerUnit: 3.50,   baseMonthlyEvents: 3, dispenseRange: [15, 30] },
  // idx 07
  { name: 'Ceftriaxone 1g',         category: 'Antibiotic',       unit: 'vials',    reorderLevel: 100, costPerUnit: 80.00,  baseMonthlyEvents: 2, dispenseRange: [2, 8]   },
  // idx 08
  { name: 'Salbutamol Inhaler',     category: 'Respiratory',      unit: 'inhalers', reorderLevel: 50,  costPerUnit: 45.00,  baseMonthlyEvents: 2, dispenseRange: [1, 4]   },
  // idx 09
  { name: 'Insulin Glargine',       category: 'Antidiabetic',     unit: 'vials',    reorderLevel: 30,  costPerUnit: 350.00, baseMonthlyEvents: 1, dispenseRange: [1, 4]   },
  // idx 10
  { name: 'Diclofenac 50mg',        category: 'NSAID',            unit: 'tablets',  reorderLevel: 400, costPerUnit: 1.50,   baseMonthlyEvents: 4, dispenseRange: [15, 40] },
  // idx 11
  { name: 'Azithromycin 500mg',     category: 'Antibiotic',       unit: 'tablets',  reorderLevel: 200, costPerUnit: 15.00,  baseMonthlyEvents: 2, dispenseRange: [5, 15]  },
  // idx 12
  { name: 'Losartan 50mg',          category: 'Antihypertensive', unit: 'tablets',  reorderLevel: 300, costPerUnit: 4.00,   baseMonthlyEvents: 3, dispenseRange: [20, 45] },
  // idx 13
  { name: 'Pantoprazole 40mg',      category: 'Antacid',          unit: 'tablets',  reorderLevel: 250, costPerUnit: 3.00,   baseMonthlyEvents: 3, dispenseRange: [15, 30] },
  // idx 14
  { name: 'Chloroquine 250mg',      category: 'Antimalarial',     unit: 'tablets',  reorderLevel: 150, costPerUnit: 2.00,   baseMonthlyEvents: 2, dispenseRange: [10, 30] },
  // idx 15
  { name: 'ORS Sachets',            category: 'Rehydration',      unit: 'sachets',  reorderLevel: 500, costPerUnit: 5.00,   baseMonthlyEvents: 4, dispenseRange: [30, 80] },
  // idx 16
  { name: 'Ferrous Sulphate 200mg', category: 'Haematinic',       unit: 'tablets',  reorderLevel: 400, costPerUnit: 0.80,   baseMonthlyEvents: 4, dispenseRange: [20, 60] },
  // idx 17
  { name: 'Dexamethasone 4mg',      category: 'Corticosteroid',   unit: 'vials',    reorderLevel: 80,  costPerUnit: 25.00,  baseMonthlyEvents: 2, dispenseRange: [2, 8]   },
  // idx 18
  { name: 'Metronidazole 400mg',    category: 'Antibiotic',       unit: 'tablets',  reorderLevel: 300, costPerUnit: 1.80,   baseMonthlyEvents: 3, dispenseRange: [15, 35] },
  // idx 19
  { name: 'Ibuprofen 400mg',        category: 'NSAID',            unit: 'tablets',  reorderLevel: 350, costPerUnit: 1.20,   baseMonthlyEvents: 4, dispenseRange: [15, 40] },
];

// ─── Seasonality ──────────────────────────────────────────────────────────────
// Monthly multipliers: [Sep25, Oct25, Nov25, Dec25, Jan26, Feb26]
// Anchored to the history window we're generating.
//
// Rationale (Gujarat health patterns):
//   Antimalarial   — monsoon peak Jun–Sep; Sep still elevated, tapering by Oct
//   Respiratory    — winter spike Nov–Feb; Ahmedabad/Surat dust + cold air
//   Antibiotic     — steady; modest monsoon bump (waterborne infections Sep)
//   Analgesic      — stable year-round; slight festive + winter uptick
//   NSAID          — winter joints ache; Dec–Jan peak
//   Antidiabetic   — stable chronic use
//   Antihypertensive — winter cold raises BP; Dec–Jan higher
//   Antacid        — festive eating Oct–Nov; slightly elevated
//   Rehydration    — post-monsoon Sep; drops sharply in winter
//   Haematinic     — stable (anemia programme is year-round)
//   Corticosteroid — stable with slight winter allergy bump
//   Lipid-lowering — stable chronic use
const SEASON: Record<string, number[]> = {
  Antimalarial:     [1.8, 1.2, 0.8, 0.7,  0.7,  0.8 ],
  Respiratory:      [0.7, 0.8, 1.4, 1.85, 1.95, 1.6 ],
  Antibiotic:       [1.2, 1.1, 1.0, 1.0,  1.0,  1.0 ],
  Analgesic:        [1.0, 1.0, 1.0, 1.1,  1.1,  1.0 ],
  NSAID:            [0.9, 0.9, 1.0, 1.15, 1.25, 1.1 ],
  Antidiabetic:     [1.0, 1.0, 1.0, 1.0,  1.0,  1.0 ],
  Antihypertensive: [0.9, 0.9, 1.0, 1.15, 1.25, 1.1 ],
  Antacid:          [0.9, 1.2, 1.3, 1.1,  1.0,  1.0 ],
  Rehydration:      [1.5, 1.2, 0.8, 0.7,  0.7,  0.8 ],
  Haematinic:       [1.0, 1.0, 1.0, 1.0,  1.0,  1.0 ],
  Corticosteroid:   [1.0, 1.0, 1.1, 1.2,  1.1,  1.0 ],
  'Lipid-lowering': [1.0, 1.0, 1.0, 1.0,  1.0,  1.0 ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Inclusive integer random in [min, max] */
function ri(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isoDate(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

/** Qty range by unit type for a single batch */
function batchQtyForUnit(unit: string): number {
  switch (unit) {
    case 'tablets':  return ri(200, 450);
    case 'capsules': return ri(150, 320);
    case 'vials':    return ri(40,  130);
    case 'inhalers': return ri(20,  65);
    case 'sachets':  return ri(250, 450);
    default:         return ri(100, 300);
  }
}

// ─── Batch generation ─────────────────────────────────────────────────────────
// Each drug gets 3–5 batches covering:
//   ≥1 expired batch        → triggers "expired" alerts
//   ≥1 near-expiry batch    → triggers "near_expiry" alerts (within 30 days)
//   ≥2 future batches       → actual usable stock
//
// Groups rotate (drugIndex % 4) for variety:
//   Group 0: 3 batches — 1 expired_old, 1 near, 1 good_180d
//   Group 1: 4 batches — 1 expired_recent, 1 near, 1 good_90d, 1 good_1yr
//   Group 2: 5 batches — 1 expired_old, 1 expired_recent, 1 near, 1 good_180d, 1 good_1yr
//   Group 3: 4 batches — 2 expired, 1 near, 1 good_250d

interface BatchShape {
  expiryDaysFromToday: number;
  receivedMonthsAgo: number;
}

const BATCH_GROUPS: BatchShape[][] = [
  // Group 0 — 3 batches
  [
    { expiryDaysFromToday: -95,  receivedMonthsAgo: 6 }, // Expired Dec 16 2025
    { expiryDaysFromToday: +17,  receivedMonthsAgo: 3 }, // Near-expiry Apr 7
    { expiryDaysFromToday: +183, receivedMonthsAgo: 2 }, // Good Sep 20
  ],
  // Group 1 — 4 batches
  [
    { expiryDaysFromToday: -22,  receivedMonthsAgo: 5 }, // Expired Feb 28
    { expiryDaysFromToday: +14,  receivedMonthsAgo: 3 }, // Near-expiry Apr 4
    { expiryDaysFromToday: +90,  receivedMonthsAgo: 2 }, // Good Jun 19
    { expiryDaysFromToday: +365, receivedMonthsAgo: 1 }, // Good Mar 2027
  ],
  // Group 2 — 5 batches
  [
    { expiryDaysFromToday: -62,  receivedMonthsAgo: 6 }, // Expired Jan 18
    { expiryDaysFromToday: -10,  receivedMonthsAgo: 4 }, // Expired Mar 11
    { expiryDaysFromToday: +22,  receivedMonthsAgo: 3 }, // Near-expiry Apr 12
    { expiryDaysFromToday: +200, receivedMonthsAgo: 1 }, // Good Oct 7
    { expiryDaysFromToday: +365, receivedMonthsAgo: 1 }, // Good Mar 2027
  ],
  // Group 3 — 4 batches
  [
    { expiryDaysFromToday: -95,  receivedMonthsAgo: 5 }, // Expired Dec 16
    { expiryDaysFromToday: -20,  receivedMonthsAgo: 4 }, // Expired Mar 1
    { expiryDaysFromToday: +20,  receivedMonthsAgo: 2 }, // Near-expiry Apr 10
    { expiryDaysFromToday: +180, receivedMonthsAgo: 1 }, // Good Sep 17
  ],
];

interface BatchPayload {
  drugId: string;
  batchNumber: string;
  quantity: number;
  expiryDate: string;
  receivedDate: string;
  costPerUnit: number;
}

interface DrugBatchResult {
  batches: BatchPayload[];
  totalStock: number;
}

function buildBatches(drugIndex: number, drug: DrugDef): DrugBatchResult {
  const drugId = `drug_${String(drugIndex + 1).padStart(2, '0')}`;
  const group = BATCH_GROUPS[drugIndex % 4];
  const batches: BatchPayload[] = [];
  let totalStock = 0;

  group.forEach((shape, j) => {
    const batchSeq = drugIndex * 10 + j + 1;
    const batchNumber = `BTH-2025-${String(batchSeq).padStart(4, '0')}`;
    const quantity = batchQtyForUnit(drug.unit);
    totalStock += quantity;

    batches.push({
      drugId,
      batchNumber,
      quantity,
      expiryDate:   isoDate(addDays(TODAY, shape.expiryDaysFromToday)),
      receivedDate: isoDate(subMonths(TODAY, shape.receivedMonthsAgo)),
      costPerUnit:  drug.costPerUnit,
    });
  });

  return { batches, totalStock };
}

// ─── Dispense log generation ──────────────────────────────────────────────────

interface DispenseLogPayload {
  drugId: string;
  drugName: string;
  batchId: string;
  batchNumber: string;
  quantity: number;
  dispensedBy: string;
  timestamp: string;
}

const PHARMACISTS = ['Dr. Patel', 'Dr. Sharma', 'Dr. Desai', 'Dr. Joshi', 'Dr. Trivedi'];

function buildDispenseLogs(drugIndex: number, drug: DrugDef): DispenseLogPayload[] {
  const drugId = `drug_${String(drugIndex + 1).padStart(2, '0')}`;
  const seasonMultipliers = SEASON[drug.category] ?? [1, 1, 1, 1, 1, 1];
  const logs: DispenseLogPayload[] = [];

  HISTORY_MONTHS.forEach((monthStart, monthIdx) => {
    const multiplier = seasonMultipliers[monthIdx];

    // Number of events this month — floor(base * multiplier), minimum 0
    // We add a small random ±1 jitter so not every month is a round number
    const rawCount = drug.baseMonthlyEvents * multiplier;
    const numEvents = Math.max(0, Math.floor(rawCount) + (Math.random() < (rawCount % 1) ? 1 : 0));

    if (numEvents === 0) return;

    const daysInMonth = getDaysInMonth(monthStart);

    // Spread events across the month using a shuffled day-pool so
    // events don't cluster on the same days every iteration.
    const dayPool = Array.from({ length: daysInMonth }, (_, d) => d + 1);
    for (let i = dayPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dayPool[i], dayPool[j]] = [dayPool[j], dayPool[i]];
    }

    for (let e = 0; e < numEvents; e++) {
      const day  = dayPool[e % daysInMonth];
      const hour = ri(8, 17);
      const min  = ri(0, 59);
      const ts   = new Date(
        monthStart.getFullYear(),
        monthStart.getMonth(),
        day, hour, min, 0,
      );

      logs.push({
        drugId,
        drugName:    drug.name,
        batchId:     'seed',
        batchNumber: 'SEED',
        quantity:    ri(drug.dispenseRange[0], drug.dispenseRange[1]),
        dispensedBy: PHARMACISTS[ri(0, PHARMACISTS.length - 1)],
        timestamp:   ts.toISOString(),
      });
    }
  });

  return logs;
}

// ─── Commit helper (splits payloads into ≤490 write chunks) ──────────────────

async function commitInChunks<T>(
  items: T[],
  writer: (batch: ReturnType<typeof writeBatch>, item: T, index: number) => void,
): Promise<void> {
  const CHUNK = 490;
  for (let start = 0; start < items.length; start += CHUNK) {
    const chunk = items.slice(start, start + CHUNK);
    const batch = writeBatch(db);
    chunk.forEach((item, i) => writer(batch, item, start + i));
    await batch.commit();
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function checkAlreadySeeded(): Promise<boolean> {
  const snap = await getDoc(doc(db, 'config', 'seeded'));
  return snap.exists();
}

export async function seedDatabase(onProgress: SeedProgress): Promise<void> {
  // Guard: refuse to double-seed
  if (await checkAlreadySeeded()) {
    throw new Error('Database has already been seeded.');
  }

  // ── 1. Drugs ─────────────────────────────────────────────────────────────
  onProgress('Seeding 20 drugs…');

  type DrugEntry = { id: string; payload: Record<string, unknown>; batches: BatchPayload[] };
  const drugEntries: DrugEntry[] = DRUG_DEFS.map((drug, i) => {
    const id = `drug_${String(i + 1).padStart(2, '0')}`;
    const { batches, totalStock } = buildBatches(i, drug);
    return {
      id,
      payload: {
        name: drug.name,
        category: drug.category,
        unit: drug.unit,
        reorderLevel: drug.reorderLevel,
        currentStock: totalStock,
      },
      batches,
    };
  });

  await commitInChunks(drugEntries, (batch, entry) => {
    batch.set(doc(collection(db, 'drugs'), entry.id), entry.payload);
  });

  // ── 2. Batches (subcollection: drugs/{drugId}/batches/) ───────────────────
  onProgress('Seeding batches (3–5 per drug)…');

  type BatchEntry = { drugId: string; batchDocId: string; data: BatchPayload };
  const allBatchEntries: BatchEntry[] = [];
  drugEntries.forEach((entry, drugIndex) => {
    entry.batches.forEach((b, j) => {
      allBatchEntries.push({
        drugId:     entry.id,
        batchDocId: `${entry.id}_b${drugIndex * 10 + j + 1}`,
        data:       b,
      });
    });
  });

  await commitInChunks(allBatchEntries, (batch, entry) => {
    batch.set(
      doc(db, 'drugs', entry.drugId, 'batches', entry.batchDocId),
      entry.data,
    );
  });

  // ── 3. Dispense history (6 months, seasonally weighted) ──────────────────
  onProgress('Seeding 6 months of dispense history…');

  type LogEntry = { docId: string; data: DispenseLogPayload };
  const allLogs: LogEntry[] = [];

  DRUG_DEFS.forEach((drug, i) => {
    buildDispenseLogs(i, drug).forEach((log, j) => {
      allLogs.push({
        docId: `drug_${String(i + 1).padStart(2, '0')}_log_${String(j + 1).padStart(3, '0')}`,
        data:  log,
      });
    });
  });

  onProgress(`Seeding dispense history (${allLogs.length} records)…`);

  await commitInChunks(allLogs, (batch, entry) => {
    batch.set(doc(collection(db, 'dispenseLogs'), entry.docId), entry.data);
  });

  // ── 4. Test users + config/seeded flag ───────────────────────────────────
  onProgress('Creating test users…');

  const TEST_USERS = [
    { uid: 'pharmacist-1', name: 'Dr. Patel', email: 'patel@hospital.guj.in', role: 'pharmacist' },
    { uid: 'manager-1',    name: 'Dr. Shah',  email: 'shah@hospital.guj.in',  role: 'manager'    },
    { uid: 'admin-1',      name: 'Dr. Mehta', email: 'mehta@hospital.guj.in', role: 'admin'      },
  ];

  const metaBatch = writeBatch(db);
  TEST_USERS.forEach(u => {
    metaBatch.set(doc(db, 'users', u.uid), u);
  });
  metaBatch.set(doc(db, 'config', 'seeded'), {
    seededAt:    new Date().toISOString(),
    version:     1,
    drugCount:   DRUG_DEFS.length,
    logCount:    allLogs.length,
    batchCount:  allBatchEntries.length,
  });
  await metaBatch.commit();

  onProgress(`Done! Seeded ${DRUG_DEFS.length} drugs, ${allBatchEntries.length} batches, ${allLogs.length} dispense records.`);
}
