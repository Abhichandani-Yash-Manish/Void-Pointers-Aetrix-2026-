import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../config/firebase';
import type { Drug } from '../../types';

export default function InventoryPage() {
  const [drugs, setDrugs] = useState<Drug[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDocs(collection(db, 'drugs'))
      .then((snap) => {
        setDrugs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Drug)));
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Drug Inventory</h1>

      {loading ? (
        <p className="text-slate-500">Loading inventory...</p>
      ) : drugs.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm">
          No drugs found. Run the seed script to populate the database.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Drug Name</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Category</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Unit</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">Current Stock</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-600">Reorder Level</th>
                <th className="text-center px-4 py-3 font-semibold text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {drugs.map((drug) => {
                const isLow = drug.currentStock <= drug.reorderLevel;
                return (
                  <tr key={drug.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{drug.name}</td>
                    <td className="px-4 py-3 text-slate-600">{drug.category}</td>
                    <td className="px-4 py-3 text-slate-600">{drug.unit}</td>
                    <td className="px-4 py-3 text-right">{drug.currentStock}</td>
                    <td className="px-4 py-3 text-right">{drug.reorderLevel}</td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          isLow
                            ? 'bg-red-100 text-red-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {isLow ? 'Low Stock' : 'OK'}
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
  );
}
