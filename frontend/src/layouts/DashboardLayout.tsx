import { Sidebar } from '../components/organisms/Sidebar';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function DashboardLayout() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/signin" replace state={{ from: location }} />;
  }

  return (
    <div className="practice-page-shell">
      <Sidebar />
      <main className="practice-main">
        <Outlet />
      </main>
    </div>
  );
}
