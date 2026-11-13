import { Sidebar } from '../components/organisms/Sidebar';
import { Outlet } from 'react-router-dom';

export function DashboardLayout() {
  return (
    <div className="practice-page-shell">
      <Sidebar />
      <main className="practice-main">
        <Outlet />
      </main>
    </div>
  );
}
