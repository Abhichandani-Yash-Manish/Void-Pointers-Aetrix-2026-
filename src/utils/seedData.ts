import { collection, doc, writeBatch } from 'firebase/firestore';
import { db } from '../config/firebase';
import type { Drug, Batch } from '../types';

const drugs: Omit<Drug, 'id'>[] = [
  { name: 'Paracetamol 500mg', category: 'Analgesic', unit: 'tablet', reorderLevel: 200, currentStock: 850 },
  { name: 'Amoxicillin 250mg', category: 'Antibiotic', unit: 'capsule', reorderLevel: 100, currentStock: 75 },
  { name: 'Metformin 500mg', category: 'Antidiabetic', unit: 'tablet', reorderLevel: 150, currentStock: 400 },
  { name: 'Amlodipine 5mg', category: 'Antihypertensive', unit: 'tablet', reorderLevel: 100, currentStock: 320 },
  { name: 'ORS Sachets', category: 'Rehydration', unit: 'sachet', reorderLevel: 50, currentStock: 30 },
  { name: 'Cetirizine 10mg', category: 'Antihistamine', unit: 'tablet', reorderLevel: 80, currentStock: 200 },
  { name: 'Omeprazole 20mg', category: 'Antacid', unit: 'capsule', reorderLevel: 80, currentStock: 60 },
  { name: 'Iron + Folic Acid', category: 'Supplement', unit: 'tablet', reorderLevel: 100, currentStock: 500 },
];

export async function seedDatabase() {
  const batch = writeBatch(db);

  const drugIds: string[] = [];
  drugs.forEach((drug, i) => {
    const id = `drug_${i + 1}`;
    drugIds.push(id);
    const ref = doc(collection(db, 'drugs'), id);
    batch.set(ref, drug);
  });

  // Sample batches
  const batches: Omit<Batch, 'id'>[] = [
    {
      drugId: 'drug_1',
      batchNumber: 'B2024-001',
      quantity: 500,
      expiryDate: '2026-06-30',
      receivedDate: '2024-01-15',
      costPerUnit: 0.5,
    },
    {
      drugId: 'drug_2',
      batchNumber: 'B2024-002',
      quantity: 75,
      expiryDate: '2025-12-31',
      receivedDate: '2024-02-01',
      costPerUnit: 2.5,
    },
    {
      drugId: 'drug_5',
      batchNumber: 'B2024-003',
      quantity: 30,
      expiryDate: '2025-04-15',
      receivedDate: '2024-03-01',
      costPerUnit: 1.2,
    },
  ];

  batches.forEach((batch_, i) => {
    const ref = doc(collection(db, 'batches'), `batch_${i + 1}`);
    batch.set(ref, batch_);
  });

  await batch.commit();
  console.log('Database seeded successfully!');
}
