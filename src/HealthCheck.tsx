import React, { useState } from "react";

type AnyJson = unknown;

function pretty(x: AnyJson) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

/** Data de azi în fusul orar RO (YYYY-MM-DD) */
function todayRO(): string {
  // 'sv-SE' dă "YYYY-MM-DD HH:mm:ss" -> tăiem la primele 10 caractere
  return new Date()
    .toLocaleString("sv-SE", { timeZone: "Europe/Bucharest" })
    .slice(0, 10);
}

export default function HealthCheck() {
  const [envResp, setEnvResp] = useState<AnyJson>(null);
  const [fixResp, setFixResp] = useState<AnyJson>(null);
  const [busyEnv, setBusyEnv] = useState(false);
  const [busyFix, setBusyFix] = useState(false);

  async function probeEnv() {
    setBusyEnv(true);
    setEnvResp(null);
    try {
      const res = await fetch("/api/_probe-env");
      setEnvResp(await res.json());
    } catch (err) {
      setEnvResp({ error: String(err) });
    } finally {
      setBusyEnv(false);
    }
  }

  async function testFixturesRO() {
    setBusyFix(true);
    setFixResp(null);
    try {
      // --- Parametri VALIZI pentru test ---
      const date = todayRO();        // ex: "2025-08-16"
      const league = "283";          // Liga 1 (RO)
      const season = "2025";         // sezonul curent din UI-ul tău

      // backend-ul tău /api/footy-predictor așteaptă un parametru "path"
      // care este ruta de mai departe la API-Football; restul sunt query-uri.
      const qs = new URLSearchParams({
        path: "/fixtures",
        date,
        league,
        season,
      });

      const res = await fetch(`/api/footy-predictor?${qs.toString()}`);
      const json = await res.json();
      setFixResp(json);
    } catch (err) {
      setFixResp({ error: String(err) });
    } finally {
      setBusyFix(false);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "40px auto", padding: "0 16px" }}>
      <h1>Footy Predictor – Health Check</h1>

      {/* 1) /api/_probe-env */}
      <section style={{ marginTop: 24 }}>
        <h2>1) /api/_probe-env</h2>
        <button onClick={probeEnv} disabled={busyEnv}>
          {busyEnv ? "Verific..." : "Verifică"}
        </button>
        <p>Răspuns:</p>
        <pre
          style={{
            background: "#0b1220",
            color: "#e7efff",
            padding: 16,
            borderRadius: 8,
            overflowX: "auto",
          }}
        >
          {pretty(envResp)}
        </pre>
      </section>

      {/* 2) /api/footy-predictor (fixtures azi RO) */}
      <section style={{ marginTop: 24 }}>
        <h2>2) /api/footy-predictor (fixtures azi RO)</h2>
        <button onClick={testFixturesRO} disabled={busyFix}>
          {busyFix ? "Rulez testul..." : "Rulează test"}
        </button>
        <p>Răspuns:</p>
        <pre
          style={{
            background: "#0b1220",
            color: "#e7efff",
            padding: 16,
            borderRadius: 8,
            overflowX: "auto",
          }}
        >
          {pretty(fixResp)}
        </pre>
      </section>

      <p style={{ marginTop: 24, color: "#667085" }}>
        Dacă vezi un 403 (Forbidden) cu mesaj „Path nepermis”, înseamnă că ai
        scos din whitelist <code>/fixtures</code> în server. Pune-l înapoi în
        <code>FOOTY_ALLOWED_PATHS</code> sau în handler.
      </p>
    </div>
  );
}
