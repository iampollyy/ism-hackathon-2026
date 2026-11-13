import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { SignUpPage } from './pages/SignUpPage/SignUpPage';
import { SignUpFormPage } from './pages/SignUpFormPage/SignUpFormPage';
import { SignInPage } from './pages/SignInPage/SignInPage';
import { SettingsPage } from './pages/SettingsPage/SettingsPage';
import { FamilyDashboardPage } from './pages/FamilyDashboardPage/FamilyDashboardPage';
import { PracticeCallPage } from './pages/PracticeCallPage/PracticeCallPage';
import { CallResultPage } from './pages/CallResultPage/CallResultPage';
import { DashboardLayout } from './layouts/DashboardLayout';
import { lazy, Suspense } from 'react';

// The real app's screens load on demand, so the ElevenLabs/LiveKit SDK (phone
// page) and the rest never weigh on pages that don't need them.
const PhonePage = lazy(() => import('./pages/PhonePage/PhonePage').then((m) => ({ default: m.PhonePage })));
const LiveCallPage = lazy(() => import('./pages/LiveCallPage/LiveCallPage').then((m) => ({ default: m.LiveCallPage })));
const FamilyPage = lazy(() => import('./pages/FamilyPage/FamilyPage').then((m) => ({ default: m.FamilyPage })));
const FamilySignUpPage = lazy(() =>
  import('./pages/FamilySignUpPage/FamilySignUpPage').then((m) => ({ default: m.FamilySignUpPage })),
);

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="route-loading" aria-busy="true" />}>
      <Routes>
        {/* The phone page is full screen: no sidebar. */}
        <Route path="/phone/:memberId" element={<PhonePage />} />

        <Route element={<DashboardLayout />}>
          <Route path="/" element={<SignUpPage />} />
          {/* The real app, on the back end. */}
          <Route path="/signup" element={<FamilySignUpPage />} />
          <Route path="/family/:familyId" element={<FamilyPage />} />
          <Route path="/calls/:callId" element={<LiveCallPage />} />

          {/* Polina's mock pages, kept as they were for reference. */}
          <Route path="/mock/signup" element={<SignUpFormPage />} />
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/dashboard" element={<FamilyDashboardPage />} />
          <Route path="/practice" element={<PracticeCallPage />} />
          <Route path="/result" element={<CallResultPage />} />
        </Route>
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
