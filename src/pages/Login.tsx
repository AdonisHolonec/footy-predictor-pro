import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import SuccessRateTracker from "../components/SuccessRateTracker";
import { useAuth } from "../hooks/useAuth";
import { HistoryStats } from "../types";

export default function Login() {
  const { user, signup, login, sendPasswordResetEmail, updatePassword, lastAuthEvent, error } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [localError, setLocalError] = useState("");
  const [globalStats, setGlobalStats] = useState<HistoryStats>({ wins: 0, losses: 0, settled: 0, winRate: 0 });

  useEffect(() => {
    void fetch("/api/history?days=30")
      .then((response) => response.json())
      .then((json) => {
        if (json?.ok && json.stats) setGlobalStats(json.stats);
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (hashParams.get("type") === "recovery" || lastAuthEvent === "PASSWORD_RECOVERY") {
      setMode("reset");
      setMessage("Seteaza o parola noua pentru contul tau.");
    }
    if (hashParams.get("type") === "signup") {
      setMessage("Email confirmat. Te poti autentifica.");
      setMode("login");
      window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
    }
  }, [lastAuthEvent]);

  useEffect(() => {
    if (!user) return;
    navigate("/", { replace: true });
  }, [user?.id, navigate]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError("");
    setMessage("");
    if (!email.trim()) {
      setLocalError("Email este obligatoriu.");
      return;
    }
    try {
      setSubmitting(true);
      if (mode === "login") {
        await login(email.trim(), password);
      } else if (mode === "signup") {
        await signup(email.trim(), password);
        setMessage("Cont creat. Verifica email-ul pentru confirmare.");
      } else if (mode === "forgot") {
        await sendPasswordResetEmail(email.trim());
        setMessage("Am trimis email-ul de reset.");
      } else {
        if (password.length < 6) {
          setLocalError("Parola trebuie sa aiba minim 6 caractere.");
          return;
        }
        if (password !== confirmPassword) {
          setLocalError("Parolele nu coincid.");
          return;
        }
        await updatePassword(password);
        setMessage("Parola actualizata. Te poti autentifica.");
        setMode("login");
      }
    } catch (submitError: unknown) {
      setLocalError(submitError instanceof Error ? submitError.message : "Operatiune esuata.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-xl">⚽</div>
          <div>
            <h1 className="text-3xl font-black text-white">Footy Predictor</h1>
            <p className="text-xs text-slate-400">Global authentication gateway</p>
          </div>
        </div>

        <SuccessRateTracker
          stats={globalStats}
          animatedWins={globalStats.wins}
          animatedLosses={globalStats.losses}
          animatedWinRate={globalStats.winRate}
          isWinRatePulsing={false}
          isHistorySyncing={false}
          pendingHistoryCount={0}
        />

        <div className="mt-6 w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/90 p-6">
          <h2 className="text-xl font-black text-white">
            {mode === "login" && "Login"}
            {mode === "signup" && "Create account"}
            {mode === "forgot" && "Forgot password"}
            {mode === "reset" && "Reset password"}
          </h2>
          <p className="mt-1 text-xs text-slate-400">Autentificare pentru dashboard user/admin.</p>
          <form onSubmit={(event) => void onSubmit(event)} className="mt-4 space-y-3">
            <label className="block text-xs font-black uppercase tracking-wide text-slate-300">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={mode === "reset"}
                className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-500/60"
              />
            </label>
            {mode !== "forgot" && (
              <label className="block text-xs font-black uppercase tracking-wide text-slate-300">
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-500/60"
                />
              </label>
            )}
            {mode === "reset" && (
              <label className="block text-xs font-black uppercase tracking-wide text-slate-300">
                Confirm password
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-500/60"
                />
              </label>
            )}

            {(localError || error) && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200">
                {localError || error}
              </div>
            )}
            {message && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {submitting
                ? "Se proceseaza..."
                : mode === "login"
                ? "Login"
                : mode === "signup"
                ? "Sign up"
                : mode === "forgot"
                ? "Trimite email reset"
                : "Actualizeaza parola"}
            </button>
          </form>
          <div className="mt-4 flex flex-wrap gap-3 text-xs font-bold">
            {(mode === "login" || mode === "signup") && (
              <button onClick={() => setMode(mode === "login" ? "signup" : "login")} className="text-emerald-300 hover:text-emerald-200">
                {mode === "login" ? "Nu ai cont? Creeaza unul." : "Ai cont? Intra in aplicatie."}
              </button>
            )}
            {mode === "login" && (
              <button onClick={() => setMode("forgot")} className="text-cyan-300 hover:text-cyan-200">
                Ai uitat parola?
              </button>
            )}
            {(mode === "forgot" || mode === "reset") && (
              <button onClick={() => setMode("login")} className="text-emerald-300 hover:text-emerald-200">
                Inapoi la login
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
