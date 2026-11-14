import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { SignUpPage } from './pages/SignUpPage/SignUpPage';
import { SignUpFormPage } from './pages/SignUpFormPage/SignUpFormPage';
import { SignInPage } from './pages/SignInPage/SignInPage';
import { SettingsPage } from './pages/SettingsPage/SettingsPage';
import { FamilyDashboardPage } from './pages/FamilyDashboardPage/FamilyDashboardPage';
import { PracticeCallPage } from './pages/PracticeCallPage/PracticeCallPage';
import { CallResultPage } from './pages/CallResultPage/CallResultPage';
import { DashboardLayout } from './layouts/DashboardLayout';

// Every real screen loads on demand, so heavy parts (the call SDK on the phone
// page, the 3D landing page) never weigh on pages that don't need them.
const page = <T extends Record<string, unknown>>(load: () => Promise<T>, name: keyof T) =>
  lazy(async () => ({ default: (await load())[name] as React.ComponentType }));

const PhonePage = page(() => import('./pages/PhonePage/PhonePage'), 'PhonePage');
const JoinPage = page(() => import('./pages/JoinPage/JoinPage'), 'JoinPage');
const LoginPage = page(() => import('./pages/LoginPage/LoginPage'), 'LoginPage');
const RegisterPage = page(() => import('./pages/RegisterPage/RegisterPage'), 'RegisterPage');
const FamiliesPage = page(() => import('./pages/FamiliesPage/FamiliesPage'), 'FamiliesPage');
const FamilySignUpPage = page(() => import('./pages/FamilySignUpPage/FamilySignUpPage'), 'FamilySignUpPage');
const FamilyPage = page(() => import('./pages/FamilyPage/FamilyPage'), 'FamilyPage');
const DrillsPage = page(() => import('./pages/DrillsPage/DrillsPage'), 'DrillsPage');
const ActivityPage = page(() => import('./pages/ActivityPage/ActivityPage'), 'ActivityPage');
const MemberPage = page(() => import('./pages/MemberPage/MemberPage'), 'MemberPage');
const LearnPage = page(() => import('./pages/LearnPage/LearnPage'), 'LearnPage');
const NewsPage = page(() => import('./pages/NewsPage/NewsPage'), 'NewsPage');
const PlanPage = page(() => import('./pages/PlanPage/PlanPage'), 'PlanPage');
const LiveCallPage = page(() => import('./pages/LiveCallPage/LiveCallPage'), 'LiveCallPage');

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="route-loading" aria-busy="true" />}>
        <Routes>
          {/* Full screen, no sidebar: the member's phone, joining, and signing in. */}
          <Route path="/phone/:memberId" element={<PhonePage />} />
          <Route path="/join/:memberId" element={<JoinPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route element={<DashboardLayout />}>
            <Route path="/" element={<SignUpPage />} />
            {/* The organiser's app. */}
            <Route path="/families" element={<FamiliesPage />} />
            <Route path="/signup" element={<FamilySignUpPage />} />
            <Route path="/family/:familyId" element={<FamilyPage />} />
            <Route path="/family/:familyId/drills" element={<DrillsPage />} />
            <Route path="/family/:familyId/activity" element={<ActivityPage />} />
            <Route path="/family/:familyId/members/:memberId" element={<MemberPage />} />
            <Route path="/family/:familyId/learn" element={<LearnPage />} />
            <Route path="/family/:familyId/news" element={<NewsPage />} />
            <Route path="/family/:familyId/plan" element={<PlanPage />} />
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
