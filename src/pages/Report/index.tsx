import jsPDF from 'jspdf';
import { format } from 'date-fns';

export default function ReportPage() {
  const generatePDF = () => {
    const doc = new jsPDF();
    const today = format(new Date(), 'dd MMM yyyy');

    doc.setFontSize(18);
    doc.text('PharmaGuard Gujarat', 20, 20);
    doc.setFontSize(12);
    doc.text(`Impact Report — ${today}`, 20, 30);
    doc.line(20, 35, 190, 35);

    doc.setFontSize(11);
    doc.text('Summary', 20, 45);
    doc.setFontSize(10);
    doc.text('• Total drugs tracked: —', 20, 55);
    doc.text('• Dispense logs this month: —', 20, 63);
    doc.text('• Waste prevented (est.): ₹—', 20, 71);
    doc.text('• Expired batches disposed: —', 20, 79);

    doc.save(`pharmaguard-report-${today}.pdf`);
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-slate-800 mb-2">Impact Report</h1>
      <p className="text-slate-500 mb-6">Generate PDF summary reports for administration</p>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 max-w-md">
        <p className="text-slate-600 text-sm mb-4">
          Click below to generate and download a PDF report with current pharmacy statistics.
        </p>
        <button
          onClick={generatePDF}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-6 py-2.5 rounded-lg transition-colors"
        >
          Download PDF Report
        </button>
      </div>
    </div>
  );
}
