import { Suspense, lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { SignUpPage } from './pages/SignUpPage/SignUpPage';
import { SignUpFormPage } from './pages/SignUpFormPage/SignUpFormPage';
import { SignInPage } from './pages/SignInPage/SignInPage';
import { SettingsPage } from './pages/SettingsPage/SettingsPage';
import { FamilyDashboardPage } from './pages/FamilyDashboardPage/FamilyDashboardPage';
import { PracticeCallPage } from './pages/PracticeCallPage/PracticeCallPage';
import { CallResultPage } from './pages/CallResultPage/CallResultPage';
import { DashboardLayout } from './layouts/DashboardLayout';
import { PhonePage } from './pages/PhonePage/PhonePage';
import { LiveCallPage } from './pages/LiveCallPage/LiveCallPage';
import { FamilyPage } from './pages/FamilyPage/FamilyPage';
import { FamilySignUpPage } from './pages/FamilySignUpPage/FamilySignUpPage';

// The landing and pricing pages load on their own, so app routes never download three.js.
const LandingPage = lazy(() => import('./pages/LandingPage/LandingPage'));
const PricingPage = lazy(() => import('./pages/LandingPage/PricingPage'));
const landingFallback = <div style={{ minHeight: '100vh', background: '#07111a' }} />;

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* The phone page is full screen: no sidebar. */}
        <Route path="/phone/:memberId" element={<PhonePage />} />
        {/* The marketing landing and pricing: full page, no sidebar. */}
        <Route path="/" element={<Suspense fallback={landingFallback}><LandingPage /></Suspense>} />
        <Route path="/pricing" element={<Suspense fallback={landingFallback}><PricingPage /></Suspense>} />

        <Route element={<DashboardLayout />}>
          {/* Polina's first landing page, kept for reference. */}
          <Route path="/classic" element={<SignUpPage />} />
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
    </BrowserRouter>
  );
}
