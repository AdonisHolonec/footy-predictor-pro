/** Reference art shipped in /public/brand (editorial + sci-fi soft mockups). */
export const BRAND_IMAGES = {
  /** Primary Footy Predictor logo */
  logoPrimary: "/brand/footy-logo3.svg",
  /** Landing hero — “Foresight on the pitch” atmosphere */
  heroForesight: "/brand/hero-foresight.png",
  /** Nav + floating cards — platform preview */
  heroPlatform: "/brand/hero-platform.png",
  /** Full dashboard composition — user / admin mood board */
  refDashboard: "/brand/ref-dashboard.png",
  /** Admin observatory reference (editorial glass dashboard) */
  adminObservatoryRef: "/brand/admin-observatory-ref.png",
  /** Prediction dossier focus — cards & analytics */
  refDossier: "/brand/ref-dossier.png",
  /** Landing / access hero (nav + floating cards) */
  landingAccessHero: "/brand/landing-access-hero.png"
} as const;

/** Static match preview on landing — same CDN as API-Football fixture logos. */
export const LANDING_PREVIEW_LOGOS = {
  league: "https://media.api-sports.io/football/leagues/39.png",
  home: "https://media.api-sports.io/football/teams/40.png",
  away: "https://media.api-sports.io/football/teams/47.png"
} as const;
