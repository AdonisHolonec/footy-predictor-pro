import { useEffect, useState } from "react";

type Standing = {
  rank: number;
  team: string;
  teamId?: number;
  teamLogo?: string | null;
  points: number;
  played: number;
  win: number;
  draw: number;
  lose: number;
  goalsFor: number;
  goalsAgainst: number;
  goalsDiff: number;
  form?: string | null;
  status?: string | null;
  description?: string | null;
};

type Props = {
  leagueId: string;
  season?: string;
  maxRows?: number;
};

export default function StandingsTable({ leagueId, season, maxRows = 16 }: Props) {
  const [data, setData] = useState<Standing[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const s = season || new Date().getFullYear().toString();
        const url = `/api/standings?leagueId=${encodeURIComponent(leagueId)}&season=${encodeURIComponent(s)}`;
        const r = await fetch(url, { headers: { Accept: "application/json" } });
        const json = await r.json();

        if (!cancelled) {
          if (json.error) {
            setError(json.error);
            setData([]);
          } else {
            setData(json.data || []);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || String(err));
          setData([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [leagueId, season]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow p-4">
        <div className="flex items-center gap-3 text-gray-600">
          <div className="animate-spin h-5 w-5 rounded-full border-2 border-current border-t-transparent" />
          <span className="text-sm">Se încarcă clasamentul...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl shadow p-4 text-red-600">
        Eroare: {error}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow p-4 text-gray-600">
        Nu există clasament disponibil.
      </div>
    );
  }

  const displayed = data.slice(0, maxRows);

  const getRankColor = (rank: number) => {
    if (rank <= 2) return "bg-blue-100 text-blue-800";
    if (rank <= 4) return "bg-green-100 text-green-800";
    if (rank >= data.length - 2) return "bg-red-100 text-red-800";
    return "bg-gray-100 text-gray-800";
  };

  return (
    <div className="bg-white rounded-2xl shadow overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-gray-600">
            <th className="text-center p-3 w-12">#</th>
            <th className="text-left p-3">Echipă</th>
            <th className="text-center p-3 w-12">M</th>
            <th className="text-center p-3 w-12">V</th>
            <th className="text-center p-3 w-12">E</th>
            <th className="text-center p-3 w-12">Î</th>
            <th className="text-center p-3 w-16">Golaveraj</th>
            <th className="text-center p-3 w-12 font-semibold">Pct</th>
            <th className="text-center p-3 w-24">Formă</th>
          </tr>
        </thead>
        <tbody>
          {displayed.map((s) => (
            <tr key={`${s.teamId}-${s.rank}`} className="border-t hover:bg-gray-50">
              <td className="p-3 text-center">
                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${getRankColor(s.rank)}`}>
                  {s.rank}
                </span>
              </td>
              <td className="p-3">
                <div className="flex items-center gap-2">
                  {s.teamLogo && <img src={s.teamLogo} alt={s.team} className="h-6 w-6 object-contain rounded" />}
                  <span className="font-medium">{s.team}</span>
                </div>
              </td>
              <td className="p-3 text-center text-gray-700">{s.played}</td>
              <td className="p-3 text-center text-green-700 font-medium">{s.win}</td>
              <td className="p-3 text-center text-gray-600">{s.draw}</td>
              <td className="p-3 text-center text-red-700">{s.lose}</td>
              <td className="p-3 text-center text-gray-700">
                <span className={s.goalsDiff >= 0 ? "text-green-700" : "text-red-700"}>
                  {s.goalsFor}:{s.goalsAgainst} ({s.goalsDiff >= 0 ? "+" : ""}{s.goalsDiff})
                </span>
              </td>
              <td className="p-3 text-center font-bold text-lg">{s.points}</td>
              <td className="p-3 text-center">
                {s.form ? (
                  <div className="flex gap-0.5 justify-center">
                    {s.form.split("").slice(-5).map((c, i) => (
                      <span
                        key={i}
                        className={`inline-block w-5 h-5 rounded text-xs font-semibold flex items-center justify-center ${
                          c === "W" ? "bg-green-500 text-white" :
                          c === "D" ? "bg-gray-400 text-white" :
                          c === "L" ? "bg-red-500 text-white" :
                          "bg-gray-200 text-gray-700"
                        }`}
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-gray-400">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.length > maxRows && (
        <div className="p-3 text-center text-xs text-gray-500 border-t">
          Afișate {maxRows} din {data.length} echipe
        </div>
      )}
    </div>
  );
}
