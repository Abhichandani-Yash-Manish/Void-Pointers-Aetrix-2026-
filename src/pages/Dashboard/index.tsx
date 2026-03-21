import { useAuth } from '../../hooks/useAuth';

export default function DashboardPage() {
  const { profile } = useAuth();

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">
        Welcome back, {profile?.name ?? 'User'}
      </h1>
      <p className="text-slate-500 mb-6">Here's your pharmacy overview</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Drugs', value: '—', color: 'bg-blue-50 text-blue-700' },
          { label: 'Low Stock', value: '—', color: 'bg-amber-50 text-amber-700' },
          { label: 'Near Expiry', value: '—', color: 'bg-orange-50 text-orange-700' },
          { label: 'Dispensed Today', value: '—', color: 'bg-emerald-50 text-emerald-700' },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <p className="text-slate-500 text-sm mb-1">{card.label}</p>
            <p className={`text-3xl font-bold ${card.color} px-2 py-0.5 rounded inline-block`}>
              {card.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
