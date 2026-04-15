// src/api/_env.ts
export type Env = {
  RAPIDAPI_KEY: string;
  RAPIDAPI_HOST: string;
  RAPIDAPI_BASE_URL: string;
  FOOTY_ALLOWED_PATHS: string[]; // lista de path-uri permise
};

function read(key: string, fallback = ""): string {
  return (process.env as any)[key] ?? fallback;
}

const ENV: Env = {
  // acceptă atât RAPIDAPI_KEY cât și API_FOOTBALL_KEY (unele conturi pe RapidAPI folosesc nume diferite)
  RAPIDAPI_KEY:
    read("RAPIDAPI_KEY") ||
    read("API_FOOTBALL_KEY") ||
    read("RAPIDAPI_KEY", ""), // fallback gol → vei vedea la probe dacă nu e setată

  RAPIDAPI_HOST: read("RAPIDAPI_HOST", "api-football-v1.p.rapidapi.com"),

  RAPIDAPI_BASE_URL: read(
    "RAPIDAPI_BASE_URL",
    "https://api-football-v1.p.rapidapi.com/v3"
  ),

  FOOTY_ALLOWED_PATHS: (read(
    "FOOTY_ALLOWED_PATHS",
    "/predictions,/fixtures,/odds,/leagues,/fixtures/headtohead"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) as string[],
};

// export numit + implicit — ca să nu mai conteze cum îl imporți
export { ENV };
export default ENV;
