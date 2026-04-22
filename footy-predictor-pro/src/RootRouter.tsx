import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import LandingAccess from "./pages/LandingAccess";
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
        <div className="relative z-10 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-signal-petrol">
          Loading session…
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.isBlocked) {
    return (
      <div className="lab-page grid min-h-screen place-items-center p-6">
        <div className="lab-bg" aria-hidden />
        <div className="relative z-10 max-w-md rounded-2xl border border-signal-rose/35 bg-signal-rose/10 p-6 text-center text-signal-ink">
          <h1 className="font-display text-xl font-semibold text-signal-rose">Account blocat</h1>
          <p className="mt-2 text-sm text-signal-inkMuted">
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
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/login" element={<Login />} />
        <Route path="/workspace" element={<AuthGate />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
