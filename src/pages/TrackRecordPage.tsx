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
      <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-signal-mist/15 via-signal-void/50 to-signal-void/98" aria-hidden />

      <div className="relative z-10">
        <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-signal-mist/70 px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <Link to="/" className="flex items-center gap-2.5 text-signal-ink transition hover:text-signal-petrol">
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
                className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-signal-ink"
              >
                Home
              </Link>
              <Link
                to={user ? workspace : login}
                className="rounded-xl border border-signal-petrol/50 bg-signal-petrol/20 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-signal-petrol"
              >
                {user ? "Workspace" : "Login"}
              </Link>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-14">
          <TrackRecordSection days={45} showLinkToFull={false} />

          <div className="mt-10 rounded-2xl border border-signal-petrol/40 bg-signal-petrol/15 p-5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-signal-petrol">Next step</p>
            <p className="mt-2 text-sm text-signal-inkMuted">
              Vrei aceleași semnale în timp real? Pornește free sau upgrade la Premium/Ultra.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                to={user ? workspace : signup}
                className="rounded-xl border border-signal-petrol/70 bg-signal-petrol/40 px-4 py-2 text-sm font-semibold text-signal-mist"
              >
                {user ? "Open Workspace" : "Start Gratuit"}
              </Link>
              <Link to="/#pricing" className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-sm text-signal-ink">
                Vezi planurile
              </Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
