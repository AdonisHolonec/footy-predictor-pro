import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import BrandArtboard from "../components/BrandArtboard";
import SuccessRateTracker from "../components/SuccessRateTracker";
import { ModelPulseWave } from "../components/SignalLab";
import { BRAND_IMAGES } from "../constants/brandAssets";
import { useAuth } from "../hooks/useAuth";
import { HistoryStats } from "../types";

export default function Login() {
  const { user, signup, login, sendPasswordResetEmail, updatePassword, lastAuthEvent, error } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [localError, setLocalError] = useState("");
  const [globalStats, setGlobalStats] = useState<HistoryStats>({ wins: 0, losses: 0, settled: 0, winRate: 0 });
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (searchParams.get("mode") === "signup") {
      setMode("signup");
    }
  }, [searchParams]);

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
      // Clean the hash so we don't re-enter reset mode on every re-render / back-nav.
      if (hashParams.get("type") === "recovery") {
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
      }
    }
    if (hashParams.get("type") === "signup") {
      setMessage("Email confirmat. Te poti autentifica.");
      setMode("login");
      window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
    }
  }, [lastAuthEvent]);

  useEffect(() => {
    if (!user) return;
    navigate("/workspace", { replace: true });
  }, [user?.id, navigate]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) return;
    const onMove = (event: MouseEvent) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const nx = (event.clientX - cx) / Math.max(cx, 1);
      const ny = (event.clientY - cy) / Math.max(cy, 1);
      setParallax({ x: Math.max(-1, Math.min(1, nx)), y: Math.max(-1, Math.min(1, ny)) });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

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
        // After a successful password update the user session is already active,
        // so send them straight to the workspace instead of forcing a re-login.
        setMessage("Parola actualizata. Te redirectionam catre workspace.");
        setMode("login");
        navigate("/workspace", { replace: true });
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
      <div
        className="pointer-events-none absolute inset-0 z-[1] bg-cover bg-center opacity-[0.18] saturate-125 transition-transform duration-300"
        style={{
          backgroundImage: `url(${BRAND_IMAGES.landingAccessHero})`,
          transform: `translate3d(${parallax.x * 10}px, ${parallax.y * 10}px, 0)`
        }}
        aria-hidden
      />
      <div
        className="login-ultra-glow pointer-events-none absolute inset-0 z-[1] opacity-[0.05] mix-blend-screen transition-transform duration-300"
        style={{
          backgroundImage: `url(${BRAND_IMAGES.heroForesight})`,
          backgroundSize: "120% auto",
          backgroundPosition: "center top",
          transform: `translate3d(${parallax.x * -14}px, ${parallax.y * -14}px, 0)`
        }}
        aria-hidden
      />
      <div className="login-ultra-noise pointer-events-none absolute inset-0 z-[1]" aria-hidden />
      <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(circle_at_16%_14%,rgba(56,189,248,0.34),transparent_42%),radial-gradient(circle_at_87%_10%,rgba(251,191,36,0.28),transparent_40%),radial-gradient(circle_at_52%_100%,rgba(244,63,94,0.24),transparent_36%)]" aria-hidden />
      <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-signal-mist/30 via-signal-void/20 to-signal-void/88" aria-hidden />
      <div className="pointer-events-none absolute inset-0 z-[1] opacity-30 [background-size:24px_24px] [background-image:linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)]" aria-hidden />
      <div className="relative z-10 mx-auto max-w-7xl px-4 py-10 sm:py-14">
        <header className="mb-10 border-b border-white/[0.1] pb-8 animate-fadeIn">
          <Link
            to="/"
            className="inline-block font-mono text-[10px] font-semibold uppercase tracking-wider text-signal-inkMuted transition hover:text-signal-petrol"
          >
            ← Pagina de acces
          </Link>
          <p className="mt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.28em] text-signal-petrol">Footy predictor · intelligence lab</p>
          <div className="mt-2 max-w-4xl rounded-2xl border border-white/[0.18] bg-signal-panel/68 p-4 shadow-[0_0_28px_rgba(56,189,248,0.16)] backdrop-blur-[24px] sm:p-5 lg:border-transparent lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-0">
            <h1 className="font-display text-4xl font-bold leading-[1.03] tracking-tight drop-shadow-[0_0_34px_rgba(56,189,248,0.28)] sm:text-6xl lg:text-[5rem]">
              <span className="relative inline-block">
                <span
                  className="absolute inset-0 z-0 text-transparent opacity-75 blur-[1px]"
                  style={{ WebkitTextStroke: "1px rgba(94,234,212,0.55)" }}
                  aria-hidden
                >
                  Footy Predictor
                </span>
                <span className="relative z-10 bg-gradient-to-r from-signal-ink via-signal-petrol to-signal-mint bg-clip-text text-transparent drop-shadow-[0_0_26px_rgba(56,189,248,0.34)]">
                  Footy Predictor
                </span>
              </span>
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-signal-ink">
              Login într-un mediu premium, cinematic și calm. Intră în observatorul tău de predicții, piețe avansate și
              performanță în timp real.
            </p>
          </div>
        </header>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,26rem)] lg:items-start xl:gap-14">
          <div className="animate-fadeIn space-y-6 [animation-delay:40ms]">
            <ModelPulseWave status="OPTIMAL CALIBRATION" className="w-full" />

            <div className="rounded-2xl border border-signal-sage/45 bg-signal-panel/80 px-4 py-4 shadow-[0_0_24px_rgba(16,185,129,0.18)] backdrop-blur-[24px]">
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal-petrol/80">Global model performance · last 30d</p>
              <div className="mt-2 grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="font-mono text-2xl font-semibold tabular-nums text-signal-mint sm:text-3xl">
                    {globalStats.settled ? globalStats.winRate.toFixed(1) : "—"}%
                  </div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-signal-ink">Hit rate · 30d</div>
                </div>
                <div>
                  <div className="font-mono text-2xl font-semibold tabular-nums text-signal-petrol sm:text-3xl">{globalStats.settled || "—"}</div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-signal-ink">Settled</div>
                </div>
                <div>
                  <div className="font-mono text-2xl font-semibold tabular-nums text-signal-sage sm:text-3xl">
                    {globalStats.wins + globalStats.losses > 0 ? `${globalStats.wins}W/${globalStats.losses}L` : "—"}
                  </div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-signal-ink">Record</div>
                </div>
              </div>
            </div>

            <section className="rounded-2xl border border-white/[0.2] bg-signal-panel/80 p-4 shadow-[0_0_20px_rgba(56,189,248,0.14)] backdrop-blur-[24px]">
              <h2 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-signal-petrol">Servicii disponibile în platformă</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  "Predicții 1X2 + O/U calibrate",
                  "Piețe Corners / Shots / HT Goals",
                  "Signal Lens + Edge Compass",
                  "Performance Counter pe user/ligă"
                ].map((service) => (
                  <div key={service} className="rounded-xl border border-signal-sage/25 bg-signal-void/45 px-3 py-2 font-mono text-[10px] text-signal-ink">
                    {service}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-signal-petrol">Observatory pulse</h2>
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
          </div>

          <section className="lg:sticky lg:top-8">
            <div className="login-auth-shell animate-fadeIn overflow-hidden rounded-2xl border border-white/[0.2] bg-gradient-to-b from-signal-panel/100 via-signal-mist/100 to-signal-panel/95 shadow-[0_0_38px_rgba(56,189,248,0.26)] backdrop-blur-[30px] [animation-delay:90ms]">
              <div className="flex items-center gap-2 border-b border-white/[0.06] px-1 pt-1" aria-hidden>
                <div className="h-0.5 flex-1 rounded-full bg-gradient-to-r from-transparent via-signal-petrol/55 to-transparent" />
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-signal-silver">Credentials</span>
                <div className="h-0.5 flex-1 rounded-full bg-gradient-to-r from-transparent via-signal-sage/30 to-transparent" />
              </div>
              <div className="p-6 sm:p-7">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-signal-petrol">Secure gateway</p>
                <h2 className="lab-heading mt-1 text-xl">
                  {mode === "login" && "Login"}
                  {mode === "signup" && "Create account"}
                  {mode === "forgot" && "Forgot password"}
                  {mode === "reset" && "Reset password"}
                </h2>
                <p className="mt-1 text-xs text-signal-silver">
                  Continuă către workspace-ul tău Footy Predictor Intelligence Lab.
                </p>

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
                    className="w-full rounded-xl border border-signal-petrol/70 bg-gradient-to-r from-signal-petrol/80 via-signal-petrol to-signal-sage/70 px-4 py-2.5 text-sm font-semibold text-signal-mist shadow-[0_0_24px_rgba(56,189,248,0.5)] transition hover:-translate-y-0.5 hover:from-signal-petrol hover:to-signal-sage hover:shadow-[0_0_34px_rgba(56,189,248,0.65)] disabled:cursor-not-allowed disabled:opacity-60"
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

            <p className="mt-4 text-center text-[11px] text-signal-inkMuted lg:text-left">
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
