import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import UserDashboard from "./pages/UserDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import { useAuth } from "./hooks/useAuth";

function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 text-slate-200">
        <div className="text-sm font-black uppercase tracking-wide">Loading session...</div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (user.isBlocked) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 p-6 text-slate-100">
        <div className="max-w-md rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center">
          <h1 className="text-xl font-black text-rose-200">Account blocat</h1>
          <p className="mt-2 text-sm text-rose-100/90">
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
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<AuthGate />} />
      </Routes>
    </BrowserRouter>
  );
}
