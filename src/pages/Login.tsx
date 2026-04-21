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
      <div
        className="pointer-events-none absolute inset-0 z-[1] bg-cover bg-center opacity-[0.12] transition-transform duration-300"
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
      <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-signal-mist/40 via-transparent to-signal-void/85" aria-hidden />
      <div className="relative z-10 mx-auto max-w-7xl px-4 py-10 sm:py-14">
        <header className="mb-10 border-b border-white/[0.07] pb-8 animate-fadeIn">
          <Link
            to="/"
            className="inline-block font-mono text-[10px] font-semibold uppercase tracking-wider text-signal-inkMuted transition hover:text-signal-petrol"
          >
            ← Pagina de acces
          </Link>
          <p className="mt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.28em] text-signal-petrolMuted">Footy predictor · intelligence lab</p>
          <h1 className="lab-heading mt-2 max-w-3xl text-3xl leading-[1.15] sm:text-4xl lg:text-[2.75rem]">
            Access control for your football intelligence workspace.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-signal-inkMuted">
            Login într-un mediu premium, cinematic și calm. Odată autentificat, intri în observatorul de predicții,
            piețe avansate și monitorizare de performanță.
          </p>
        </header>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,26rem)] lg:items-start xl:gap-14">
          <div className="animate-fadeIn space-y-6 [animation-delay:40ms]">
            <ModelPulseWave status="OPTIMAL CALIBRATION" className="w-full" />

            <div className="grid gap-4 sm:grid-cols-2">
              <BrandArtboard
                src={BRAND_IMAGES.heroForesight}
                alt="Footy Predictor — atmosferă editorială și carduri predictive"
                frameClassName="aspect-[4/3] max-h-[280px] sm:max-h-[320px]"
              />
              <BrandArtboard
                src={BRAND_IMAGES.heroPlatform}
                alt="Footy Predictor — navigare și previzualizare platformă"
                frameClassName="aspect-[4/3] max-h-[280px] sm:max-h-[320px]"
              />
            </div>

            <div className="rounded-2xl border border-white/[0.07] bg-signal-panel/35 px-4 py-3 backdrop-blur-md">
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal-petrol/80">Global model performance · last 30d</p>
              <div className="mt-2 grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="font-mono text-lg font-semibold tabular-nums text-signal-mint sm:text-xl">
                    {globalStats.settled ? globalStats.winRate.toFixed(1) : "—"}%
                  </div>
                  <div className="text-[9px] font-medium uppercase tracking-wide text-signal-inkMuted">Hit rate · 30d</div>
                </div>
                <div>
                  <div className="font-mono text-lg font-semibold tabular-nums text-signal-petrol sm:text-xl">{globalStats.settled || "—"}</div>
                  <div className="text-[9px] font-medium uppercase tracking-wide text-signal-inkMuted">Settled</div>
                </div>
                <div>
                  <div className="font-mono text-lg font-semibold tabular-nums text-signal-silver sm:text-xl">
                    {globalStats.wins + globalStats.losses > 0 ? `${globalStats.wins}W/${globalStats.losses}L` : "—"}
                  </div>
                  <div className="text-[9px] font-medium uppercase tracking-wide text-signal-inkMuted">Record</div>
                </div>
              </div>
            </div>

            <section className="rounded-2xl border border-white/[0.07] bg-signal-panel/35 p-4 backdrop-blur-md">
              <h2 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-signal-petrolMuted">Servicii disponibile în platformă</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  "Predicții 1X2 + O/U calibrate",
                  "Piețe Corners / Shots / HT Goals",
                  "Signal Lens + Edge Compass",
                  "Performance Counter pe user/ligă"
                ].map((service) => (
                  <div key={service} className="rounded-xl border border-white/10 bg-signal-void/35 px-3 py-2 font-mono text-[10px] text-signal-silver">
                    {service}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-signal-petrolMuted">Observatory pulse</h2>
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
            <div className="login-auth-shell animate-fadeIn overflow-hidden rounded-2xl border border-white/[0.09] bg-gradient-to-b from-signal-panel/90 to-signal-mist/95 shadow-atelierLg backdrop-blur-xl [animation-delay:90ms]">
              <div className="flex items-center gap-2 border-b border-white/[0.06] px-1 pt-1" aria-hidden>
                <div className="h-0.5 flex-1 rounded-full bg-gradient-to-r from-transparent via-signal-petrol/55 to-transparent" />
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-signal-inkMuted">Credentials</span>
                <div className="h-0.5 flex-1 rounded-full bg-gradient-to-r from-transparent via-signal-sage/30 to-transparent" />
              </div>
              <div className="p-6 sm:p-7">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-signal-petrolMuted">Secure gateway</p>
                <h2 className="lab-heading mt-1 text-xl">
                  {mode === "login" && "Login"}
                  {mode === "signup" && "Create account"}
                  {mode === "forgot" && "Forgot password"}
                  {mode === "reset" && "Reset password"}
                </h2>
                <p className="mt-1 text-xs text-signal-inkMuted">
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
