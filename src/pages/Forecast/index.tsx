import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const mockData = {
  labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6'],
  datasets: [
    {
      label: 'Actual Consumption',
      data: [120, 135, 118, 142, 130, 125],
      backgroundColor: 'rgba(16, 185, 129, 0.6)',
    },
    {
      label: 'Predicted Demand',
      data: [125, 138, 122, 140, 133, 128],
      backgroundColor: 'rgba(59, 130, 246, 0.6)',
    },
  ],
};

export default function ForecastPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-slate-800 mb-2">Demand Forecast</h1>
      <p className="text-slate-500 mb-6">ML-based consumption predictions</p>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <Bar
          data={mockData}
          options={{
            responsive: true,
            plugins: {
              legend: { position: 'top' },
              title: { display: true, text: 'Weekly Drug Consumption vs Forecast' },
            },
          }}
        />
      </div>
    </div>
  );
}
