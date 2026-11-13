import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { SignUpPage } from './pages/SignUpPage/SignUpPage';
import { SignUpFormPage } from './pages/SignUpFormPage/SignUpFormPage';
import { SignInPage } from './pages/SignInPage/SignInPage';
import { SettingsPage } from './pages/SettingsPage/SettingsPage';
import { FamilyDashboardPage } from './pages/FamilyDashboardPage/FamilyDashboardPage';
import { PracticeCallPage } from './pages/PracticeCallPage/PracticeCallPage';
import { CallResultPage } from './pages/CallResultPage/CallResultPage';
import { DashboardLayout } from './layouts/DashboardLayout';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="/" element={<SignUpPage />} />
          <Route path="/signup" element={<SignUpFormPage />} />
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/dashboard" element={<FamilyDashboardPage />} />
          <Route path="/practice" element={<PracticeCallPage />} />
          <Route path="/result" element={<CallResultPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
