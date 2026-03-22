import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import ProtectedRoute from './components/Layout/ProtectedRoute';
import Sidebar from './components/Layout/Sidebar';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import InventoryPage from './pages/Inventory';
import DispensePage from './pages/Dispense';
import AlertsPage from './pages/Alerts';
import ForecastPage from './pages/Forecast';
import HeatmapPage from './pages/Heatmap';
import WasteCalcPage from './pages/WasteCalc';
import ReportPage from './pages/Report';
import DispenseHistoryPage from './pages/DispenseHistory';

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-900 dark:text-slate-100">
        {children}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <DashboardPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/inventory"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <InventoryPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/dispense"
            element={
              <ProtectedRoute allowedRoles={['pharmacist', 'admin']}>
                <AppLayout>
                  <DispensePage />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/history"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <DispenseHistoryPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/alerts"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <AlertsPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/forecast"
            element={
              <ProtectedRoute allowedRoles={['manager', 'admin']}>
                <AppLayout>
                  <ForecastPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/heatmap"
            element={
              <ProtectedRoute>
                <AppLayout>
                  <HeatmapPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/waste"
            element={
              <ProtectedRoute allowedRoles={['manager', 'admin']}>
                <AppLayout>
                  <WasteCalcPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          <Route
            path="/report"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AppLayout>
                  <ReportPage />
                </AppLayout>
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
