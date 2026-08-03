import type { Locale } from "./types";

/**
 * Night-owl greeting pool (23:00–04:59), split by whether live matches exist.
 * `{count}` in a "live" message is replaced with the current live match count.
 * Kept out of the Dict/translate system since these are pools, not single strings.
 */
export const NIGHT_OWL_MESSAGES: Record<Locale, { live: string[]; idle: string[] }> = {
  ro: {
    live: [
      "⚽ Ora e târzie, dar avem {count} meciuri LIVE chiar acum.",
      "🌙 {count} meciuri LIVE la ora asta — se pare că ai ochiul format.",
      "🔴 {count} meciuri în direct. Noaptea abia a-nceput pentru fotbal.",
      "🏟️ {count} terenuri încă luminate la ora asta. Perfect pentru tine.",
      "⚡ {count} meciuri LIVE — exact genul de noapte pe care o cauți.",
      "🎯 {count} meciuri în desfășurare. Ai nimerit momentul potrivit.",
      "📡 {count} meciuri LIVE pe radar. Hai să vedem ce se-ntâmplă.",
      "🌃 Noapte târzie, {count} meciuri LIVE — combinația preferată a fanilor adevărați.",
      "🔥 {count} meciuri LIVE chiar acum. Nimic nu scapă unui ochi antrenat.",
      "🌙 {count} meciuri în direct la ora asta — se joacă și pentru tine."
    ],
    idle: [
      "🌙 Încă treaz? Cele mai bune idei tactice vin uneori după miezul nopții.",
      "⚽ Se pare că somnul mai poate aștepta puțin.",
      "☕ O cafea acum ar avea perfect sens.",
      "🌙 Campionii verifică forma până și la ora asta.",
      "🌅 Aproape s-a făcut dimineață — hai să vedem ce urmează.",
      "😄 Dacă ceva merită văzut la ora asta, știm că nu-ți scapă.",
      "🏆 Respect pentru dedicare! Puțini se uită la predicții la ora asta.",
      "🌙 Liniște pe teren, dar mintea ta e tot pe fotbal.",
      "⭐ Nopțile astea sunt pentru cei care chiar iubesc jocul.",
      "🌃 Orașul doarme, tu analizezi meciuri. Respect.",
      "🎧 Modul concentrare activat, chiar și la ora asta.",
      "🌙 Un pont bun nu are program de somn."
    ]
  },
  en: {
    live: [
      "⚽ It's late, but there are {count} matches LIVE right now.",
      "🌙 {count} live matches at this hour — you've got the eye for it.",
      "🔴 {count} matches in play. The night is just getting started.",
      "🏟️ {count} pitches still lit up at this hour. Right up your alley.",
      "⚡ {count} live matches — exactly the kind of night you were after.",
      "🎯 {count} matches in progress. Perfect timing on your part.",
      "📡 {count} live matches on the radar. Let's see what's happening.",
      "🌃 Late night, {count} live matches — a true fan's favorite combo.",
      "🔥 {count} matches live right now. Nothing gets past a trained eye.",
      "🌙 {count} matches live at this hour — the game's on for you too."
    ],
    idle: [
      "🌙 Still up? The best tactical ideas sometimes arrive after midnight.",
      "⚽ Sleep can apparently wait a little longer.",
      "☕ A coffee right about now would make perfect sense.",
      "🌙 Champions check their form even at this hour.",
      "🌅 Morning's almost here — let's see what football has in store.",
      "😄 If there's something worth catching at this hour, you won't miss it.",
      "🏆 Respect for the dedication! Not many check predictions this late.",
      "🌙 Quiet on the pitch, but your mind's still on football.",
      "⭐ Nights like these are for people who truly love the game.",
      "🌃 The city sleeps, you're analyzing matches. Respect.",
      "🎧 Focus mode on, even at this hour.",
      "🌙 A good pick doesn't keep a bedtime."
    ]
  }
};

/**
 * Contextual live-football greeting pool, used by the Contextual Greeting
 * Engine's live-football provider (src/utils/greeting.ts) when today's
 * already-loaded matches make one of these signals true. `{count}` in a
 * "manyLive" message is replaced with the current live match count.
 */
export const LIVE_CONTEXT_MESSAGES: Record<
  Locale,
  { manyLive: string[]; championsLeague: string[]; europaLeague: string[]; weekend: string[] }
> = {
  ro: {
    manyLive: [
      "🔥 Mare seară de fotbal! Chiar acum sunt {count} meciuri LIVE.",
      "⚡ {count} meciuri LIVE în acest moment — o seară plină pentru orice fan.",
      "🌍 Fotbalul nu se oprește: {count} meciuri LIVE chiar acum.",
      "🏆 {count} meciuri LIVE simultan. O seară memorabilă pentru fotbal.",
      "🎯 {count} meciuri LIVE acum — momentul perfect să urmărești tot ce contează."
    ],
    championsLeague: [
      "🌟 Liga Campionilor e în direct. Seara mare a Europei a început.",
      "🏆 Noapte de Champions League — fotbalul de cel mai înalt nivel e live acum.",
      "⭐ Seară de Champions League. Cele mai bune echipe ale Europei sunt pe teren.",
      "🌍 Champions League live acum — genul de seară pentru care merită să fii pregătit."
    ],
    europaLeague: [
      "⚽ Europa League e în direct chiar acum.",
      "🔵 Seară de Europa League — acțiune europeană live pe teren.",
      "🌍 Europa League live — o seară bună pentru fotbalul continental.",
      "⚡ Europa League acum în direct. Fotbal european de urmărit."
    ],
    weekend: [
      "⚽ Weekend perfect pentru fotbal.",
      "🏟️ E weekend — ziua ideală pentru meciuri și predicții bune.",
      "🎉 Weekend de fotbal. Exact genul de zi pe care o aștepți.",
      "⚽ Ziua perfectă pentru fotbal a sosit — e weekend."
    ]
  },
  en: {
    manyLive: [
      "🔥 Big football night! There are {count} matches LIVE right now.",
      "⚡ {count} matches LIVE at this very moment — a stacked night for any fan.",
      "🌍 Football never stops: {count} matches LIVE right now.",
      "🏆 {count} matches LIVE simultaneously. A night worth remembering.",
      "🎯 {count} matches LIVE right now — perfect timing to catch what matters."
    ],
    championsLeague: [
      "🌟 Champions League is underway. Europe's biggest night has begun.",
      "🏆 Champions League night — the highest level of football is live right now.",
      "⭐ Champions League evening. Europe's best teams are on the pitch.",
      "🌍 Champions League live right now — the kind of night worth being ready for."
    ],
    europaLeague: [
      "⚽ Europa League action is live right now.",
      "🔵 Europa League night — European action live on the pitch.",
      "🌍 Europa League is live — a good night for continental football.",
      "⚡ Europa League live right now. European football worth watching."
    ],
    weekend: [
      "⚽ Perfect day for football.",
      "🏟️ It's the weekend — the ideal day for matches and sharp predictions.",
      "🎉 Football weekend. Exactly the kind of day you've been waiting for.",
      "⚽ The perfect football day has arrived — it's the weekend."
    ]
  }
};
