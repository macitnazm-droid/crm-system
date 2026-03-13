import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ConversationsPage from './pages/ConversationsPage';
import CustomersPage from './pages/CustomersPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import SimulatorPage from './pages/SimulatorPage';
import SuperAdminPage from './pages/SuperAdminPage';
import AppointmentsPage from './pages/AppointmentsPage';

function ProtectedRoute({ children, role }) {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) return <div className="loading-center"><div className="loading-spinner" /></div>;
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (role && user.role !== role) return <Navigate to="/" />;
  return children;
}

function AppRoutes() {
  const { isAuthenticated } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" /> : <LoginPage />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="conversations" element={<ConversationsPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="appointments" element={<AppointmentsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="simulator" element={<SimulatorPage />} />
        <Route path="super-admin" element={<ProtectedRoute role="super_admin"><SuperAdminPage /></ProtectedRoute>} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SocketProvider>
          <AppRoutes />
        </SocketProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
