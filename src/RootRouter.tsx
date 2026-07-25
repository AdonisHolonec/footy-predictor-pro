import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import LandingAccess from "./pages/LandingAccess";
import TrackRecordPage from "./pages/TrackRecordPage";
import Login from "./pages/Login";
import Privacy from "./pages/Privacy";
import UserDashboard from "./pages/UserDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import { useAuth } from "./hooks/useAuth";

function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="lab-page grid min-h-screen place-items-center">
        <div className="lab-bg" aria-hidden />
        <div className="relative z-10 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-[var(--fp-accent)]">
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
        <div className="relative z-10 max-w-md rounded-2xl border border-[var(--fp-danger)]/35 bg-[var(--fp-danger)]/10 p-6 text-center text-[var(--fp-text)]">
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
      <Routes>
        <Route path="/" element={<LandingAccess />} />
        <Route path="/track-record" element={<TrackRecordPage />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/login" element={<Login />} />
        <Route path="/workspace" element={<AuthGate />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
