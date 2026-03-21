import { useState } from 'react';

export default function WasteCalcPage() {
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [result, setResult] = useState<number | null>(null);

  const calculate = () => {
    const q = parseFloat(qty);
    const c = parseFloat(cost);
    if (!isNaN(q) && !isNaN(c)) setResult(q * c);
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-slate-800 mb-2">Waste Calculator</h1>
      <p className="text-slate-500 mb-6">Estimate financial loss from expired/wasted drugs</p>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 max-w-md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Wasted Quantity (units)
            </label>
            <input
              type="number"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="e.g. 50"
              className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Cost per Unit (₹)
            </label>
            <input
              type="number"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="e.g. 12.50"
              className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <button
            onClick={calculate}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2.5 rounded-lg transition-colors"
          >
            Calculate Loss
          </button>

          {result !== null && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-red-700 font-semibold text-lg">
                Estimated Loss: ₹{result.toFixed(2)}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
