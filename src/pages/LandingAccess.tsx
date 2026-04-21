import { useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { ModelPulseWave } from "../components/SignalLab";
import { BRAND_IMAGES } from "../constants/brandAssets";
import { useAuth } from "../hooks/useAuth";

export default function LandingAccess() {
  const { user, loading } = useAuth();
  const previewRef = useRef<HTMLDivElement | null>(null);
  const scrollPreview = useCallback(() => {
    previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const workspace = "/workspace";
  const login = "/login";
  const signup = "/login?mode=signup";

  return (
    <div className="lab-page min-h-screen">
      <div className="lab-bg" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 z-[1] bg-cover bg-center opacity-[0.16]"
        style={{ backgroundImage: `url(${BRAND_IMAGES.heroPlatform})` }}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.28),transparent_42%),radial-gradient(circle_at_85%_15%,rgba(16,185,129,0.24),transparent_45%),radial-gradient(circle_at_50%_100%,rgba(245,158,11,0.22),transparent_40%)]" aria-hidden />
      <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-signal-mist/45 via-transparent to-signal-void/95" aria-hidden />

      <div className="relative z-10">
        <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-signal-mist/70 px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <Link to="/" className="flex items-center gap-2.5 text-signal-ink transition hover:text-signal-petrol">
              <span className="grid h-9 w-9 place-items-center rounded-lg border border-signal-line/70 bg-signal-void/70 text-signal-petrol" aria-hidden>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="opacity-90">
                  <path d="M3 18h18M4 17l4-5 4 3 4-6 4 8M4 18V6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="font-display text-sm font-semibold tracking-tight sm:text-base">Footy Predictor Intelligence Lab</span>
            </Link>
            <Link
              to={user ? workspace : login}
              className="rounded-xl border border-signal-petrol/50 bg-signal-petrol/20 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-signal-petrol transition hover:bg-signal-petrol/30"
            >
              {user ? "Open App" : "Sign In"}
            </Link>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:py-16">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] xl:gap-16">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-signal-petrol/85">Football analytics platform</p>
              <h1 className="font-display mt-3 text-4xl font-bold leading-[1.08] tracking-tight text-signal-ink sm:text-5xl lg:text-[3.25rem]">
                Predicții fotbal cu energie de stadion și analiză de laborator.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-signal-inkMuted">
                Construiești decizii pe 1X2, Over/Under, Corners, Shots și HT Goals într-un dashboard vibrant,
                clar și orientat pe edge real.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                {user ? (
                  <Link
                    to={workspace}
                    className="inline-flex items-center justify-center rounded-xl border border-signal-petrol/50 bg-signal-petrol/20 px-6 py-3 font-semibold text-signal-mist shadow-[0_0_24px_rgba(56,189,248,0.25)] transition hover:bg-signal-petrol/30 hover:shadow-frost"
                  >
                    Deschide observatorul
                  </Link>
                ) : (
                  <Link
                    to={signup}
                    className="inline-flex items-center justify-center rounded-xl border border-signal-petrol/50 bg-signal-petrol/20 px-6 py-3 font-semibold text-signal-mist shadow-[0_0_24px_rgba(56,189,248,0.25)] transition hover:bg-signal-petrol/30 hover:shadow-frost"
                  >
                    Start Gratuit
                  </Link>
                )}
                <button
                  type="button"
                  onClick={scrollPreview}
                  className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-signal-void/40 px-6 py-3 font-semibold text-signal-ink transition hover:border-signal-petrol/30 hover:bg-signal-panel/50"
                >
                  Explore platform
                </button>
              </div>
              <div className="mt-10 max-w-xl space-y-4">
                <ModelPulseWave status="STREAM ACTIVE" className="w-full" />
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: "Meciuri analizate", value: "400+" },
                    { label: "Semnale / fixture", value: "20+" },
                    { label: "Actualizare live", value: "<60s" }
                  ].map((kpi) => (
                    <div key={kpi.label} className="rounded-xl border border-white/10 bg-signal-panel/50 p-3 backdrop-blur-sm">
                      <p className="font-mono text-[9px] uppercase tracking-wide text-signal-inkMuted">{kpi.label}</p>
                      <p className="mt-1 font-display text-xl font-bold text-signal-mint">{kpi.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div ref={previewRef} id="platform-preview" className="relative scroll-mt-28">
              <div className="pointer-events-none absolute -inset-4 rounded-[2rem] bg-signal-petrol/5 blur-3xl" aria-hidden />
              <div className="relative space-y-4">
                <div className="relative z-10 rounded-2xl border border-signal-petrol/30 bg-signal-panel/65 p-4 shadow-frost backdrop-blur-md sm:p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal-amber">Match intelligence</p>
                      <p className="mt-1 font-display text-lg font-semibold text-signal-ink">Liverpool vs Tottenham</p>
                      <p className="mt-1 font-mono text-[11px] text-signal-inkMuted">20:45 · Today</p>
                    </div>
                    <Link
                      to={login}
                      className="shrink-0 rounded-lg border border-signal-petrol/30 bg-signal-petrol/10 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-signal-petrol transition hover:bg-signal-petrol/20"
                    >
                      Open
                    </Link>
                  </div>
                  <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <p className="font-mono text-[9px] uppercase text-signal-inkMuted">Top pick</p>
                      <p className="font-display text-xl font-bold text-signal-mint">Over 2.5 goals</p>
                    </div>
                    <div className="rounded-xl border border-signal-sage/35 bg-signal-sage/10 px-3 py-2 text-center">
                      <p className="font-mono text-[9px] uppercase text-signal-silver">Confidence</p>
                      <p className="font-mono text-xl font-bold tabular-nums text-signal-mint">79%</p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[10px] text-signal-silver">
                    <span className="rounded-md border border-white/10 bg-signal-void/40 px-2 py-1">xG 2.10 · 1.41</span>
                    <span className="rounded-md border border-signal-petrol/30 bg-signal-petrol/10 px-2 py-1 text-signal-petrol">Edge +0.22 EV</span>
                    <span className="rounded-md border border-white/10 bg-signal-void/40 px-2 py-1">Corners O/U 9.5</span>
                    <span className="rounded-md border border-white/10 bg-signal-void/40 px-2 py-1">HT Goals O/U 1.5</span>
                  </div>
                  <div className="mt-3 flex gap-1.5" aria-label="Form ribbon">
                    {["W", "W", "D", "L", "W"].map((x, i) => (
                      <span
                        key={i}
                        className={`grid h-7 w-7 place-items-center rounded-md border text-[10px] font-bold ${
                          x === "W"
                            ? "border-signal-sage/35 bg-signal-sage/15 text-signal-mint"
                            : x === "L"
                              ? "border-signal-rose/35 bg-signal-rose/15 text-signal-rose"
                              : "border-white/10 bg-signal-void/50 text-signal-amberSoft"
                        }`}
                      >
                        {x}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: "Signal Lens", detail: "Pattern match live", tone: "text-signal-petrol border-signal-petrol/30 bg-signal-petrol/10" },
                    { label: "Edge Compass", detail: "Value lane detect", tone: "text-signal-amber border-signal-amber/30 bg-signal-amber/10" },
                    { label: "Risk Guard", detail: "Stake discipline", tone: "text-signal-mint border-signal-sage/35 bg-signal-sage/10" }
                  ].map((item) => (
                    <div key={item.label} className={`rounded-xl border p-3 backdrop-blur-sm ${item.tone}`}>
                      <p className="font-mono text-[9px] uppercase tracking-wide">{item.label}</p>
                      <p className="mt-1 text-xs">{item.detail}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-white/10 bg-signal-void/55 p-4 backdrop-blur-md">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal-petrol">Ce primești</p>
                  <div className="mt-3 grid gap-2 text-sm text-signal-silver">
                    <p>• Predicții explicabile, nu doar scoruri brute.</p>
                    <p>• Piețe clasice + piețe avansate în aceeași interfață.</p>
                    <p>• Performance counter real pe user și pe ligă.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <section id="pricing" className="scroll-mt-28 border-t border-white/[0.06] py-16">
            <h2 className="font-display text-2xl font-semibold text-signal-ink">Access Tiers · Intelligence Plans</h2>
            <p className="mt-2 max-w-2xl text-sm text-signal-inkMuted">
              Trei niveluri gândite pentru ritmuri diferite: explorare, execuție tactical și intelligence complet.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                {
                  title: "Free Habit Trial",
                  price: "FREE",
                  metrics: ["05 meciuri / zi", "10 zile active", "1X2 + O/U"],
                  desc: "Ideal pentru rutină rapidă și validare de semnal.",
                  to: signup,
                  cta: "Pornește Free"
                },
                {
                  title: "Tactical Premium",
                  price: "PREMIUM",
                  metrics: ["10 meciuri / zi", "Corners incluse", "Signal Lens Basic"],
                  desc: "Pentru workflow constant cu un nivel tactic superior.",
                  to: `${login}?from=pricing&tier=premium`,
                  cta: "Disponibil curând"
                },
                {
                  title: "Intelligence Ultra",
                  price: "ULTRA",
                  metrics: ["Nelimitat", "Shots + HT Goals", "Edge Compass"],
                  desc: "Control complet al piețelor avansate și al edge-ului.",
                  to: `${login}?from=pricing&tier=ultra`,
                  cta: "Disponibil curând"
                }
              ].map((tier) => (
                <div
                  key={tier.title}
                  className="rounded-2xl border border-white/[0.08] bg-signal-panel/55 p-5 shadow-inner backdrop-blur-md"
                >
                  <p className="font-mono text-[10px] uppercase tracking-wider text-signal-petrol">{tier.title}</p>
                  <p className="mt-2 font-display text-3xl font-bold text-signal-ink">{tier.price}</p>
                  <p className="mt-2 text-sm text-signal-inkMuted">{tier.desc}</p>
                  <div className="mt-3 space-y-1 font-mono text-[10px] uppercase tracking-wider text-signal-silver">
                    {tier.metrics.map((metric) => (
                      <p key={metric}>{metric}</p>
                    ))}
                  </div>
                  <Link
                    to={tier.to}
                    className="mt-4 inline-block rounded-lg border border-signal-petrol/30 bg-signal-petrol/10 px-4 py-2 text-xs font-semibold text-signal-petrol transition hover:bg-signal-petrol/20"
                  >
                    {tier.cta}
                  </Link>
                </div>
              ))}
            </div>
          </section>

          <section className="border-t border-white/[0.06] py-14">
            <div className="rounded-3xl border border-signal-petrol/25 bg-gradient-to-r from-signal-petrol/20 via-signal-sage/15 to-signal-amber/20 p-6 backdrop-blur-md sm:p-8">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal-petrol">Ready for kickoff?</p>
              <h3 className="mt-2 font-display text-2xl font-semibold text-signal-ink sm:text-3xl">
                Intră în platformă și rulează primele predicții în mai puțin de 2 minute.
              </h3>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  to={user ? workspace : signup}
                  className="rounded-xl border border-signal-petrol/45 bg-signal-petrol/25 px-5 py-2.5 font-semibold text-signal-mist transition hover:bg-signal-petrol/35"
                >
                  {user ? "Open Workspace" : "Creează cont"}
                </Link>
                <Link
                  to={login}
                  className="rounded-xl border border-white/20 bg-signal-void/35 px-5 py-2.5 font-semibold text-signal-ink transition hover:bg-signal-panel/50"
                >
                  Login
                </Link>
              </div>
            </div>
          </section>

          <footer className="border-t border-white/[0.06] py-8 text-center sm:flex sm:items-center sm:justify-between sm:text-left">
            <p className="font-mono text-[11px] text-signal-inkMuted">
              {loading ? "Se încarcă sesiunea…" : user ? `Sesiune activă · ${user.email}` : "Nu ești autentificat."}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-4 sm:mt-0 sm:justify-end">
              <Link to="/privacy" className="font-mono text-[11px] text-signal-petrol hover:underline">
                Privacy (GDPR)
              </Link>
              <Link to={login} className="font-mono text-[11px] text-signal-petrol hover:underline">
                Login
              </Link>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
