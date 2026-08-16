import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ThemeBoot from "./design-system/ThemeBoot";
import { useAuth } from "./hooks/useAuth";

// Route-level code splitting: every page is its own chunk, so a visitor on the
// marketing landing no longer downloads the authenticated workspace (the main
// bundle carried MatchModal, both dashboards and all panels before this).
const LandingAccess = lazy(() => import("./pages/LandingAccess"));
const TrackRecordPage = lazy(() => import("./pages/TrackRecordPage"));
const Login = lazy(() => import("./pages/Login"));
const Privacy = lazy(() => import("./pages/Privacy"));
const UserDashboard = lazy(() => import("./pages/UserDashboard"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));

/** Same visual language as the session-loading state below — reads native. */
function RouteFallback() {
  return (
    <div className="lab-page grid min-h-screen place-items-center">
      <div className="lab-bg" aria-hidden />
      <div className="relative z-10 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-[var(--fp-accent)]">
        Se încarcă…
      </div>
    </div>
  );
}

function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="lab-page grid min-h-screen place-items-center">
        <div className="lab-bg" aria-hidden />
        <div className="relative z-10 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-[var(--fp-accent)]">
          Se încarcă sesiunea…
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.isBlocked) {
    return (
      <div className="lab-page grid min-h-screen place-items-center p-6">
        <div className="lab-bg" aria-hidden />
        <div className="relative z-10 max-w-md rounded-[var(--fp-radius)] border border-fp-danger/35 bg-fp-danger/10 p-6 text-center text-[var(--fp-text)]">
          <h1 className="font-display text-xl font-semibold text-[var(--fp-danger)]">Account blocat</h1>
          <p className="mt-2 text-sm text-[var(--fp-text-muted)]">
            Contul tau este momentan blocat. Contacteaza un administrator pentru reactivare.
          </p>
        </div>
      </div>
    );
  }
  return user.role === "admin" ? <AdminDashboard /> : <UserDashboard />;
}

export default function RootRouter() {
  return (
    <BrowserRouter>
      {/* Theme is an application responsibility: applied for every route,
          before any page decides anything — never owned by a dashboard. */}
      <ThemeBoot />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<LandingAccess />} />
          <Route path="/track-record" element={<TrackRecordPage />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/login" element={<Login />} />
          <Route path="/workspace" element={<AuthGate />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
