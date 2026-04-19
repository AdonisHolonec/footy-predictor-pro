import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

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
    if (mode === "signup" && !privacyAccepted) {
      setLocalError("Trebuie sa confirmi ca ai citit politica de confidentialitate.");
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
    <div className="lab-page">
      <div className="lab-bg" aria-hidden />
      <div className="relative z-10 mx-auto max-w-6xl px-4 py-10 sm:py-14">
        <header className="mb-10 animate-fadeIn">
          <div className="flex flex-wrap items-end justify-between gap-6 border-b border-white/[0.07] pb-8">
            <div className="flex items-start gap-4">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-signal-line bg-signal-bone/50 shadow-innerSoft backdrop-blur-sm">
                <span className="text-2xl leading-none opacity-90" aria-hidden>
                  ⚽
                </span>
              </div>
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-signal-petrolMuted">
                  Observatory · access
                </p>
                <h1 className="lab-heading mt-1 max-w-xl text-3xl leading-tight sm:text-4xl">
                  Football signal <span className="text-signal-petrol">gateway</span>
                </h1>
                <p className="mt-2 max-w-lg text-sm leading-relaxed text-signal-inkMuted">
                  Autentificare securizata pentru dashboard utilizator si administrare. Acelasi limbaj vizual ca in
                  aplicatie.
                </p>
              </div>
            </div>
            <div className="hidden text-right sm:block">
              <p className="font-mono text-[10px] uppercase tracking-widest text-signal-inkMuted">Session</p>
              <p className="mt-1 font-mono text-xs text-signal-silver">Standby · encrypted</p>
            </div>
          </div>
        </header>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
          <section className="animate-fadeIn space-y-4 [animation-delay:60ms]">
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-signal-petrolMuted">
              Performance observatory
            </h2>
            <SuccessRateTracker
              stats={globalStats}
              animatedWins={globalStats.wins}
              animatedLosses={globalStats.losses}
              animatedWinRate={globalStats.winRate}
              isWinRatePulsing={false}
              isHistorySyncing={false}
              pendingHistoryCount={0}
            />
          </section>

          <section className="lg:sticky lg:top-8">
            <div className="animate-fadeIn overflow-hidden rounded-2xl border border-white/[0.09] bg-gradient-to-b from-signal-panel/90 to-signal-mist/95 shadow-atelierLg backdrop-blur-xl [animation-delay:90ms]">
              <div className="flex items-center gap-2 border-b border-white/[0.06] px-1 pt-1" aria-hidden>
                <div className="h-0.5 flex-1 rounded-full bg-gradient-to-r from-transparent via-signal-petrol/55 to-transparent" />
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-signal-inkMuted">
                  Model pulse
                </span>
                <div className="h-0.5 flex-1 rounded-full bg-gradient-to-r from-transparent via-signal-sage/30 to-transparent" />
              </div>
              <div className="p-6 sm:p-7">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-signal-petrolMuted">
                  Credentials
                </p>
                <h2 className="lab-heading mt-1 text-xl">
                  {mode === "login" && "Login"}
                  {mode === "signup" && "Create account"}
                  {mode === "forgot" && "Forgot password"}
                  {mode === "reset" && "Reset password"}
                </h2>
                <p className="mt-1 text-xs text-signal-inkMuted">Autentificare pentru dashboard user/admin.</p>

                <form onSubmit={(event) => void onSubmit(event)} className="mt-5 space-y-3">
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-signal-inkMuted">
                    Email
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      disabled={mode === "reset"}
                      className="glass-input mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-signal-petrol/35"
                    />
                  </label>
                  {mode !== "forgot" && (
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-signal-inkMuted">
                      Password
                      <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="glass-input mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-signal-petrol/35"
                      />
                    </label>
                  )}
                  {mode === "reset" && (
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-signal-inkMuted">
                      Confirm password
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        className="glass-input mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-signal-petrol/35"
                      />
                    </label>
                  )}

                  {mode === "signup" && (
                    <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-signal-inkMuted">
                      <input
                        type="checkbox"
                        checked={privacyAccepted}
                        onChange={(event) => setPrivacyAccepted(event.target.checked)}
                        className="mt-1 h-3.5 w-3.5 rounded border-white/20 bg-signal-fog accent-signal-petrol focus:ring-signal-petrol/40"
                      />
                      <span>
                        Confirm ca am citit{" "}
                        <Link
                          to="/privacy"
                          className="font-semibold text-signal-petrol underline decoration-signal-line/60 underline-offset-2 hover:text-signal-mint"
                        >
                          politica de confidentialitate
                        </Link>{" "}
                        si sunt de acord cu prelucrarea datelor necesare contului.
                      </span>
                    </label>
                  )}

                  {(localError || error) && (
                    <div className="rounded-xl border border-signal-rose/35 bg-signal-rose/10 px-3 py-2 text-xs font-semibold text-signal-rose">
                      {localError || error}
                    </div>
                  )}
                  {message && (
                    <div className="rounded-xl border border-signal-sage/35 bg-signal-sage/10 px-3 py-2 text-xs font-semibold text-signal-mint">
                      {message}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full rounded-xl bg-signal-petrol px-4 py-2.5 text-sm font-semibold text-signal-mist shadow-frost transition hover:bg-signal-petrolDeep disabled:cursor-not-allowed disabled:opacity-60"
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

                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-white/[0.06] pt-4 text-xs font-semibold">
                  {(mode === "login" || mode === "signup") && (
                    <button
                      type="button"
                      onClick={() => {
                        setPrivacyAccepted(false);
                        setMode(mode === "login" ? "signup" : "login");
                      }}
                      className="text-signal-petrol transition hover:text-signal-mint"
                    >
                      {mode === "login" ? "Nu ai cont? Creeaza unul." : "Ai cont? Intra in aplicatie."}
                    </button>
                  )}
                  {mode === "login" && (
                    <button
                      type="button"
                      onClick={() => setMode("forgot")}
                      className="text-signal-amberSoft/90 transition hover:text-signal-amber"
                    >
                      Ai uitat parola?
                    </button>
                  )}
                  {(mode === "forgot" || mode === "reset") && (
                    <button type="button" onClick={() => setMode("login")} className="text-signal-petrol transition hover:text-signal-mint">
                      Inapoi la login
                    </button>
                  )}
                </div>
              </div>
            </div>

            <p className="text-center text-[11px] text-signal-inkMuted lg:text-left">
              <Link
                to="/privacy"
                className="text-signal-silver underline decoration-white/15 underline-offset-2 transition hover:text-signal-petrol"
              >
                Politica de confidentialitate (GDPR)
              </Link>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
