import { useEffect, useMemo, useState } from "react";
import LeaguePanel from "../components/LeaguePanel";
import MatchCard from "../components/MatchCard";
import MatchModal from "../components/MatchModal";
import SuccessRateTracker from "../components/SuccessRateTracker";
import { ELITE_LEAGUES } from "../constants/appConstants";
import { useAuth } from "../hooks/useAuth";
import { DayResponse, HistoryStats, League, PredictionRow } from "../types";
import { hashColor, inferSeason, isoToday, normalizeSelectedDates, useLocalStorageState } from "../utils/appUtils";

export default function UserDashboard() {
  const { user, logout, updateFavoriteLeagues, updateNotificationPreferences, markOnboardingComplete } = useAuth();
  const [date, setDate] = useLocalStorageState<string>("footy.user.date", isoToday());
  const [selectedDates, setSelectedDates] = useLocalStorageState<string[]>("footy.user.selectedDates", [isoToday()]);
  const [selectedLeagueIds, setSelectedLeagueIds] = useLocalStorageState<number[]>("footy.user.favoriteLeagueIds", []);
  const [searchLeague, setSearchLeague] = useState("");
  const [isLeaguesOpen, setIsLeaguesOpen] = useState(window.innerWidth >= 1024);
  const [preds, setPreds] = useState<PredictionRow[]>([]);
  const [day, setDay] = useState<DayResponse | null>(null);
  const [status, setStatus] = useState("");
  const [selectedMatch, setSelectedMatch] = useState<PredictionRow | null>(null);
  const [historyStats, setHistoryStats] = useState<HistoryStats>({ wins: 0, losses: 0, settled: 0, winRate: 0 });
  const [notifySafe, setNotifySafe] = useState<boolean>(user?.notificationPrefs?.safe ?? true);
  const [notifyValue, setNotifyValue] = useState<boolean>(user?.notificationPrefs?.value ?? true);
  const [notifyEmail, setNotifyEmail] = useState<boolean>(user?.notificationPrefs?.email ?? false);
  const [alertsPreview, setAlertsPreview] = useState<{ safe: number; value: number }>({ safe: 0, value: 0 });

  const leaguesSorted = useMemo(() => {
    const leagues = (day?.leagues ?? [])
      .filter((league) => !user?.favoriteLeagues.length || user.favoriteLeagues.includes(Number(league.id)))
      .filter((league) => league.name.toLowerCase().includes(searchLeague.toLowerCase()) || league.country.toLowerCase().includes(searchLeague.toLowerCase()));
    const elite = leagues.filter((league) => ELITE_LEAGUES.includes(Number(league.id)));
    const rest = leagues.filter((league) => !ELITE_LEAGUES.includes(Number(league.id))).sort((a, b) => b.matches - a.matches);
    return [...elite, ...rest];
  }, [day, searchLeague, user?.favoriteLeagues]);

  useEffect(() => {
    if (!user) return;
    if (user.favoriteLeagues.length) setSelectedLeagueIds(user.favoriteLeagues);
  }, [user?.id]);

  useEffect(() => {
    setNotifySafe(user?.notificationPrefs?.safe ?? true);
    setNotifyValue(user?.notificationPrefs?.value ?? true);
    setNotifyEmail(user?.notificationPrefs?.email ?? false);
  }, [user?.id, user?.notificationPrefs?.safe, user?.notificationPrefs?.value, user?.notificationPrefs?.email]);

  useEffect(() => {
    if (!user) return;
    const timer = setTimeout(() => {
      void updateFavoriteLeagues(selectedLeagueIds).catch(() => {
        setStatus("Nu am putut salva preferintele de ligi.");
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [selectedLeagueIds, user?.id, updateFavoriteLeagues]);

  useEffect(() => {
    void fetchDays(normalizeSelectedDates(selectedDates.length ? selectedDates : [date]));
    void loadHistory();
  }, []);

  useEffect(() => {
    const safeCount = preds.filter((row) => row.recommended?.confidence >= 70).length;
    const valueCount = preds.filter((row) => row.valueBet?.detected).length;
    setAlertsPreview({ safe: safeCount, value: valueCount });
  }, [preds]);

  async function fetchDays(dates: string[]) {
    const effectiveDates = normalizeSelectedDates(dates.length ? dates : [date]);
    try {
      const responses = await Promise.all(
        effectiveDates.map(async (currentDate) => {
          const response = await fetch(`/api/fixtures/day?date=${currentDate}`);
          const json = await response.json();
          if (!json.ok) throw new Error(json.error || "Eroare API");
          return json as DayResponse;
        })
      );
      const leaguesMap = new Map<number, League>();
      for (const resp of responses) {
        for (const league of resp.leagues || []) {
          const existing = leaguesMap.get(league.id);
          if (existing) existing.matches += league.matches;
          else leaguesMap.set(league.id, { ...league });
        }
      }
      setDay({
        ok: true,
        date: effectiveDates.join(", "),
        totalFixtures: responses.reduce((sum, resp) => sum + (resp.totalFixtures || 0), 0),
        leagues: Array.from(leaguesMap.values()),
        usage: responses[responses.length - 1]?.usage || { date: isoToday(), count: 0, limit: 100 }
      });
    } catch (error: any) {
      setStatus(error?.message || "Nu am putut incarca ligile.");
    }
  }

  async function loadHistory() {
    try {
      const response = await fetch("/api/history?days=30");
      const json = await response.json();
      if (!json?.ok) return;
      setHistoryStats(json.stats || { wins: 0, losses: 0, settled: 0, winRate: 0 });
    } catch {
      // keep defaults
    }
  }

  async function warm() {
    if (!selectedLeagueIds.length) return setStatus("Selecteaza o liga.");
    try {
      const dates = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
      for (const currentDate of dates) {
        const qs = new URLSearchParams({
          date: currentDate,
          leagueIds: selectedLeagueIds.join(","),
          season: String(inferSeason(currentDate))
        });
        await fetch(`/api/warm?${qs.toString()}`);
      }
      setStatus("Warm finalizat pentru ligile favorite.");
    } catch (error: any) {
      setStatus(error?.message || "Warm a esuat.");
    }
  }

  async function predict() {
    if (!selectedLeagueIds.length) return setStatus("Selecteaza o liga.");
    try {
      const dates = normalizeSelectedDates(selectedDates.length ? selectedDates : [date]);
      const batches: PredictionRow[] = [];
      for (const currentDate of dates) {
        const qs = new URLSearchParams({
          date: currentDate,
          leagueIds: selectedLeagueIds.join(","),
          season: String(inferSeason(currentDate)),
          limit: "50"
        });
        const response = await fetch(`/api/predict?${qs.toString()}`);
        const json = await response.json();
        if (Array.isArray(json)) batches.push(...json);
      }
      setPreds(Array.from(new Map(batches.map((row) => [row.id, row])).values()));
      setStatus(`Au fost generate ${batches.length} predictii.`);
    } catch (error: any) {
      setStatus(error?.message || "Predict a esuat.");
    }
  }

  async function completeOnboarding() {
    if (!selectedLeagueIds.length) {
      setStatus("Selecteaza cel putin o liga favorita pentru onboarding.");
      return;
    }
    try {
      await updateFavoriteLeagues(selectedLeagueIds);
      await markOnboardingComplete();
      setStatus("Onboarding finalizat. Preferintele tale au fost salvate.");
    } catch (error: any) {
      setStatus(error?.message || "Nu am putut finaliza onboarding-ul.");
    }
  }

  async function saveNotificationPrefs() {
    try {
      await updateNotificationPreferences({
        safe: notifySafe,
        value: notifyValue,
        email: notifyEmail
      });
      setStatus("Preferintele de notificare au fost salvate.");
    } catch (error: any) {
      setStatus(error?.message || "Nu am putut salva preferintele de notificare.");
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-[1500px] px-4 py-8 lg:px-6">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-black text-white">Footy Predictor User Dashboard</h1>
            <p className="text-xs text-slate-400">Cont: {user?.email}</p>
          </div>
          <button
            onClick={() => void logout()}
            className="rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-200 hover:bg-slate-800"
          >
            Logout
          </button>
        </header>

        <SuccessRateTracker
          stats={historyStats}
          animatedWins={historyStats.wins}
          animatedLosses={historyStats.losses}
          animatedWinRate={historyStats.winRate}
          isWinRatePulsing={false}
          isHistorySyncing={false}
          pendingHistoryCount={0}
        />

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(event) => {
              const next = event.target.value;
              setDate(next);
              setSelectedDates(normalizeSelectedDates([next]));
              void fetchDays([next]);
            }}
            className="rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm"
          />
          <button onClick={warm} className="rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm font-bold">Warm</button>
          <button onClick={predict} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-black">Predict</button>
        </div>

        {status && <div className="mt-4 rounded-xl border border-emerald-500/20 bg-slate-900/50 px-3 py-2 text-xs text-emerald-300">{status}</div>}

        {!user?.onboardingCompleted && (
          <section className="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4">
            <h2 className="text-sm font-black uppercase tracking-wide text-emerald-200">Onboarding preferinte</h2>
            <p className="mt-1 text-xs text-slate-200/80">
              Selecteaza ligile favorite din panoul de ligi, apoi confirma onboarding-ul.
            </p>
            <button
              onClick={() => void completeOnboarding()}
              className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-emerald-500"
            >
              Finalizeaza onboarding
            </button>
          </section>
        )}

        <section className="mt-4 rounded-2xl border border-cyan-400/30 bg-slate-900/60 p-4">
          <h2 className="text-sm font-black uppercase tracking-wide text-cyan-200">Notificari personalizate</h2>
          <p className="mt-1 text-xs text-slate-300">
            Configureaza alertele pentru predictii Safe / Value in functie de ligile favorite.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200">
              <input type="checkbox" checked={notifySafe} onChange={(event) => setNotifySafe(event.target.checked)} />
              Safe alerts
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200">
              <input type="checkbox" checked={notifyValue} onChange={(event) => setNotifyValue(event.target.checked)} />
              Value alerts
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200">
              <input type="checkbox" checked={notifyEmail} onChange={(event) => setNotifyEmail(event.target.checked)} />
              Email delivery (beta)
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={() => void saveNotificationPrefs()}
              className="rounded-lg border border-cyan-300/40 bg-cyan-500/15 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-cyan-200 hover:bg-cyan-500/25"
            >
              Salveaza preferinte
            </button>
            <span className="text-[11px] text-slate-400">
              Preview astazi: {alertsPreview.safe} Safe · {alertsPreview.value} Value
            </span>
          </div>
        </section>

        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="lg:col-span-4 xl:col-span-3">
            <LeaguePanel
              leaguesSorted={leaguesSorted}
              selectedSet={new Set(selectedLeagueIds)}
              selectedLeagueIds={selectedLeagueIds}
              isLeaguesOpen={isLeaguesOpen}
              searchLeague={searchLeague}
              eliteLeagues={ELITE_LEAGUES}
              setIsLeaguesOpen={setIsLeaguesOpen}
              setSearchLeague={setSearchLeague}
              setSelectedLeagueIds={setSelectedLeagueIds}
              selectEliteLeagues={() => setSelectedLeagueIds(leaguesSorted.slice(0, 8).map((league) => Number(league.id)))}
              clearLeagueSelection={() => setSelectedLeagueIds([])}
            />
          </div>
          <div className="lg:col-span-8 xl:col-span-9">
            {!preds.length ? (
              <div className="grid h-[340px] place-items-center rounded-[2rem] border border-dashed border-white/10 text-slate-500">
                Selecteaza ligile favorite si apasa Predict.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3">
                {preds.map((match) => (
                  <MatchCard
                    key={match.id}
                    row={match}
                    logoColors={{}}
                    hashColor={hashColor}
                    onClick={() => setSelectedMatch(match)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {selectedMatch && (
        <MatchModal
          match={selectedMatch}
          logoColors={{}}
          hashColor={hashColor}
          onClose={() => setSelectedMatch(null)}
        />
      )}
    </div>
  );
}
