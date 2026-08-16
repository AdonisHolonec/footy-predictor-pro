import { Link } from "react-router-dom";
import TrackRecordSection from "../components/TrackRecordSection";
import { BRAND_IMAGES } from "../constants/brandAssets";
import { useAuth } from "../hooks/useAuth";

export default function TrackRecordPage() {
  const { user } = useAuth();
  const workspace = "/workspace";
  const login = "/login";
  const signup = "/login?mode=signup";

  return (
    <div className="lab-page min-h-screen">
      <div className="lab-bg" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 z-[1] bg-cover bg-center opacity-[0.16] saturate-125"
        style={{ backgroundImage: `url(${BRAND_IMAGES.heroPlatform})` }}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-fp-bg-elevated/15 via-fp-bg/50 to-fp-bg/98" aria-hidden />

      <div className="relative z-10">
        <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-fp-bg-elevated/70 px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="mx-auto flex max-w-[var(--fp-container)] items-center justify-between gap-4">
            <Link to="/" className="flex items-center gap-2.5 text-[var(--fp-text)] transition hover:text-[var(--fp-accent)]">
              <img
                src={BRAND_IMAGES.logoPrimary}
                alt="Footy Predictor"
                className="h-12 w-12 rounded-xl border border-cyan-300/50 object-contain p-0.5"
              />
              <span className="font-display text-sm font-semibold tracking-tight">Footy Predictor · Track Record</span>
            </Link>
            <div className="flex items-center gap-2">
              <Link
                to="/"
                className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-[var(--fp-text)]"
              >
                Home
              </Link>
              <Link
                to={user ? workspace : login}
                className="rounded-xl border border-fp-accent/50 bg-fp-accent/20 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--fp-accent)]"
              >
                {user ? "Workspace" : "Login"}
              </Link>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[var(--fp-container)] px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
          <TrackRecordSection days={45} showLinkToFull={false} />

          <div className="mt-10 rounded-[var(--fp-radius)] border border-fp-accent/40 bg-fp-accent/15 p-5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--fp-accent)]">Next step</p>
            <p className="mt-2 text-sm text-[var(--fp-text-muted)]">
              Vrei aceleași semnale în timp real? Pornește free sau upgrade la Premium/Ultra.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                to={user ? workspace : signup}
                className="rounded-xl border border-fp-accent/70 bg-fp-accent/40 px-4 py-2 text-sm font-semibold text-white"
              >
                {user ? "Open Workspace" : "Start Gratuit"}
              </Link>
              <Link to="/#pricing" className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-sm text-[var(--fp-text)]">
                Vezi planurile
              </Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
