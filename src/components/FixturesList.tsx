// src/components/FixturesList.tsx
import React from "react";
import useFootyByDate from "@hooks/useFootyByDate"; // sau "../hooks/useFootyByDate"

export default function FixturesList() {
  // exemplu rapid: Liga 1, sezon 2025, data 16 Aug 2025
  const { items, loading, error } = useFootyByDate("08/16/2025", 283, 2025, {
    limit: 3,
  });

  if (loading) return <p>Se încarcă…</p>;
  if (error) return <p style={{ color: "red" }}>Eroare: {error}</p>;

  if (!items.length) return <p>Nu s-au găsit meciuri.</p>;

  return (
    <ul style={{ lineHeight: 1.6 }}>
      {items.map((m) => (
        <li key={m.fixtureId}>
          <strong>{m.homeTeam}</strong> vs <strong>{m.awayTeam}</strong>
          <br />
          <small>
            {m.datetime} {m.venue ? `• ${m.venue}` : ""} (fixture #{m.fixtureId})
          </small>
        </li>
      ))}
    </ul>
  );
}
