import { useCallback, useId, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import BrandArtboard from "../components/BrandArtboard";
import { ModelPulseWave } from "../components/SignalLab";
import { BRAND_IMAGES } from "../constants/brandAssets";
import { useAuth } from "../hooks/useAuth";

function NavDropdown({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-lg border border-transparent px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-signal-inkMuted transition hover:border-white/10 hover:bg-signal-void/40 hover:text-signal-ink [&::-webkit-details-marker]:hidden">
        {label}
        <span className="text-[9px] text-signal-petrol transition group-open:rotate-180" aria-hidden>
          ▾
        </span>
      </summary>
      <div className="absolute left-0 top-full z-50 mt-1 min-w-[12rem] rounded-xl border border-white/10 bg-signal-panel/95 py-2 shadow-atelierLg backdrop-blur-xl">
        {children}
      </div>
    </details>
  );
}

function DropLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="block px-4 py-2.5 text-sm text-signal-inkMuted transition hover:bg-signal-petrol/10 hover:text-signal-petrol"
    >
      {children}
    </Link>
  );
}

export default function LandingAccess() {
  const { user, loading } = useAuth();
  const ringGradId = useId().replace(/:/g, "");
  const previewRef = useRef<HTMLElement | null>(null);
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
        className="pointer-events-none absolute inset-0 z-[1] bg-cover bg-[center_top] opacity-[0.12]"
        style={{ backgroundImage: `url(${BRAND_IMAGES.landingAccessHero})` }}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-signal-mist via-transparent to-signal-void/90" aria-hidden />

      <div className="relative z-10">
        <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-signal-mist/75 px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
            <Link to="/" className="flex items-center gap-2.5 text-signal-ink transition hover:text-signal-petrol">
              <span className="grid h-9 w-9 place-items-center rounded-lg border border-signal-line/60 bg-signal-void/60 text-signal-petrol" aria-hidden>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="opacity-90">
                  <path d="M4 18V6M4 18h16M4 18l4-5 4 3 4-6 4 8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="font-display text-sm font-semibold tracking-tight sm:text-base">Footy Predictor</span>
            </Link>

            <nav className="hidden flex-wrap items-center gap-1 md:flex" aria-label="Principal">
              <NavDropdown label="Leagues">
                <DropLink to={`${login}?from=leagues&focus=elite`}>Elite · calendar</DropLink>
                <DropLink to={`${login}?from=leagues&focus=favorites`}>Favorite & sync</DropLink>
                <DropLink to={`${login}?from=leagues&focus=multi`}>Multi-day feed</DropLink>
              </NavDropdown>
              <NavDropdown label="Analytics">
                <DropLink to={`${login}?from=analytics&focus=performance`}>Performance observatory</DropLink>
                <DropLink to={`${login}?from=analytics&focus=xg`}>xG & calibration</DropLink>
                <DropLink to={`${login}?from=analytics&focus=value`}>Value signals</DropLink>
              </NavDropdown>
              <Link
                to={`${login}?from=intelligence`}
                className="rounded-lg px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-signal-inkMuted transition hover:bg-signal-void/40 hover:text-signal-ink"
              >
                Intelligence
              </Link>
              <a
                href="#pricing"
                className="rounded-lg px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-signal-inkMuted transition hover:bg-signal-void/40 hover:text-signal-ink"
              >
                Pricing
              </a>
              {user ? (
                <Link
                  to={workspace}
                  className="rounded-xl border border-signal-petrol/35 bg-signal-petrol/15 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-signal-petrol transition hover:bg-signal-petrol/25"
                >
                  Open app
                </Link>
              ) : (
                <Link
                  to={login}
                  className="rounded-xl border border-signal-petrol/35 bg-signal-petrol/15 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-signal-petrol transition hover:bg-signal-petrol/25"
                >
                  Sign In
                </Link>
              )}
            </nav>

            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2 rounded-full border border-signal-petrol/25 bg-signal-petrol/10 px-3 py-1.5 sm:flex">
                <span className="h-2 w-2 shrink-0 rounded-full bg-signal-sage shadow-[0_0_10px_#34d399] motion-reduce:shadow-none" aria-hidden />
                <span className="font-mono text-[10px] uppercase tracking-wider text-signal-inkMuted">Model status</span>
                <span className="font-mono text-[10px] font-semibold text-signal-mint">Optimal</span>
              </div>
              <details className="relative md:hidden">
                <summary className="list-none rounded-lg border border-white/10 bg-signal-panel/60 px-3 py-2 font-mono text-[10px] font-semibold uppercase text-signal-petrol [&::-webkit-details-marker]:hidden">
                  Menu
                </summary>
                <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-white/10 bg-signal-panel/95 py-2 shadow-atelierLg backdrop-blur-xl">
                  <Link to={`${login}?from=leagues`} className="block px-4 py-2 text-sm text-signal-inkMuted hover:bg-signal-petrol/10 hover:text-signal-petrol">
                    Leagues
                  </Link>
                  <Link to={`${login}?from=analytics`} className="block px-4 py-2 text-sm text-signal-inkMuted hover:bg-signal-petrol/10 hover:text-signal-petrol">
                    Analytics
                  </Link>
                  <Link to={`${login}?from=intelligence`} className="block px-4 py-2 text-sm text-signal-inkMuted hover:bg-signal-petrol/10 hover:text-signal-petrol">
                    Intelligence
                  </Link>
                  <a href="#pricing" className="block px-4 py-2 text-sm text-signal-inkMuted hover:bg-signal-petrol/10 hover:text-signal-petrol">
                    Pricing
                  </a>
                  <Link to={user ? workspace : login} className="block px-4 py-2 text-sm font-semibold text-signal-petrol">
                    {user ? "Open app" : "Sign In"}
                  </Link>
                </div>
              </details>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:py-16">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] xl:gap-16">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-signal-petrol/85">Predictive stack</p>
              <h1 className="font-display mt-3 text-4xl font-bold leading-[1.08] tracking-tight text-signal-ink sm:text-5xl lg:text-[3.25rem]">
                Predictive intelligence for football minds.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-signal-inkMuted">
                Analiză editorială, semnale calibrate și context xG — fără hype de pariuri. Intră în observator pentru
                predicții, istoric personal și limite inteligente Warm / Predict.
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
                    Start free trial
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
              <div className="mt-10 max-w-xl">
                <ModelPulseWave status="STREAM ACTIVE" className="w-full" />
              </div>
            </div>

            <div ref={previewRef} id="platform-preview" className="relative scroll-mt-28">
              <div className="pointer-events-none absolute -inset-4 rounded-[2rem] bg-signal-petrol/5 blur-3xl" aria-hidden />
              <div className="relative space-y-4">
                <div className="relative z-10 rounded-2xl border border-signal-petrol/25 bg-signal-panel/55 p-4 shadow-frost backdrop-blur-md sm:p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal-amber">Prediction dossier</p>
                      <p className="mt-1 font-display text-lg font-semibold text-signal-ink">Arsenal vs Manchester City</p>
                      <p className="mt-1 font-mono text-[11px] text-signal-inkMuted">16:30 · 19 APR</p>
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
                      <p className="font-display text-xl font-bold text-signal-mint">Home win · 1X</p>
                    </div>
                    <div className="relative flex h-20 w-20 items-center justify-center">
                      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 44 44" aria-hidden>
                        <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                        <circle
                          cx="22"
                          cy="22"
                          r="18"
                          fill="none"
                          stroke={`url(#${ringGradId})`}
                          strokeWidth="3"
                          strokeDasharray={`${0.81 * 2 * Math.PI * 18} ${2 * Math.PI * 18}`}
                          strokeLinecap="round"
                        />
                        <defs>
                          <linearGradient id={ringGradId} x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop stopColor="#38bdf8" />
                            <stop offset="1" stopColor="#5eead4" />
                          </linearGradient>
                        </defs>
                      </svg>
                      <span className="relative font-mono text-xl font-bold tabular-nums text-signal-ink">81%</span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 font-mono text-[11px] text-signal-silver">
                    <span>xG 2.15 · 1.30</span>
                    <span className="text-signal-mint">Edge +0.18 EV</span>
                  </div>
                  <div className="mt-3 flex gap-1" aria-label="Form ribbon">
                    {["W", "D", "L", "W", "W"].map((x, i) => (
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

                <div className="relative z-10 ml-0 rounded-2xl border border-white/10 bg-signal-void/50 p-4 shadow-inner backdrop-blur-md sm:ml-8 sm:max-w-[280px]">
                  <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal-petrol/90">Model pulse</p>
                  <div className="mt-2 h-12 w-full rounded-lg bg-signal-mist/80">
                    <svg viewBox="0 0 200 48" className="h-full w-full" preserveAspectRatio="none" aria-hidden>
                      <path
                        d="M0,30 Q25,12 50,28 T100,24 T150,32 T200,26"
                        fill="none"
                        stroke="#5eead4"
                        strokeWidth="1.5"
                        opacity="0.85"
                      />
                    </svg>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-1 font-mono text-[10px] text-signal-inkMuted">
                    <div className="flex justify-between">
                      <span>Compute load</span>
                      <span className="text-signal-petrol">68%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Neural activity</span>
                      <span className="text-signal-silver">1.25 Hz</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Input channels</span>
                      <span className="text-signal-silver">145</span>
                    </div>
                  </div>
                </div>

                <div className="relative z-10 mr-0 flex gap-2 sm:-mt-4 sm:mr-4 sm:justify-end">
                  <div className="w-36 rounded-xl border border-white/10 bg-signal-panel/50 p-2 backdrop-blur-sm">
                    <p className="text-center font-mono text-[8px] uppercase text-signal-inkMuted">Edge</p>
                    <svg viewBox="0 0 100 100" className="mx-auto mt-1 h-24 w-full" aria-hidden>
                      <polygon
                        points="50,15 85,80 15,80"
                        fill="rgba(56,189,248,0.15)"
                        stroke="#38bdf8"
                        strokeWidth="1"
                      />
                    </svg>
                  </div>
                  <div className="w-36 rounded-xl border border-white/10 bg-signal-panel/50 p-2 backdrop-blur-sm">
                    <p className="text-center font-mono text-[8px] uppercase text-signal-inkMuted">Market</p>
                    <svg viewBox="0 0 100 100" className="mx-auto mt-1 h-24 w-full" aria-hidden>
                      <polygon
                        points="50,25 80,75 20,75"
                        fill="rgba(251,191,36,0.12)"
                        stroke="#fbbf24"
                        strokeWidth="1"
                      />
                    </svg>
                  </div>
                </div>

                <BrandArtboard
                  src={BRAND_IMAGES.landingAccessHero}
                  alt="Footy Predictor — previzualizare platformă"
                  frameClassName="mt-4 max-h-[220px] opacity-90 sm:max-h-[260px]"
                  className="lg:hidden"
                />
              </div>
            </div>
          </div>

          <section id="pricing" className="scroll-mt-28 border-t border-white/[0.06] py-16">
            <h2 className="font-display text-2xl font-semibold text-signal-ink">Pricing · orientativ</h2>
            <p className="mt-2 max-w-2xl text-sm text-signal-inkMuted">
              Prototip: accesul se face prin cont. Limitele Warm / Predict pe zi sunt afișate în dashboard după autentificare.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                { title: "Starter", price: "0", desc: "Autentificare + istoric personal", to: signup },
                { title: "Observer", price: "—", desc: "Feed predictiv + ligi favorite", to: login },
                { title: "Lab", price: "—", desc: "Workspace admin (rol invitat)", to: `${login}?from=pricing` }
              ].map((tier) => (
                <div
                  key={tier.title}
                  className="rounded-2xl border border-white/[0.08] bg-signal-panel/40 p-5 shadow-inner backdrop-blur-md"
                >
                  <p className="font-mono text-[10px] uppercase tracking-wider text-signal-petrol">{tier.title}</p>
                  <p className="mt-2 font-display text-3xl font-bold text-signal-ink">{tier.price === "0" ? "Free" : tier.price}</p>
                  <p className="mt-2 text-sm text-signal-inkMuted">{tier.desc}</p>
                  <Link
                    to={tier.to}
                    className="mt-4 inline-block rounded-lg border border-signal-petrol/30 bg-signal-petrol/10 px-4 py-2 text-xs font-semibold text-signal-petrol transition hover:bg-signal-petrol/20"
                  >
                    Alege
                  </Link>
                </div>
              ))}
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
