# League Profiles

Every competition behaves differently. Profiles are **configurable data**, not hardcoded magic numbers in predict logic.

## Config source

`server-utils/leagueProfiles/leagueProfiles.config.json`

Overrides (no code change required):

| Mechanism | Example |
|-----------|---------|
| Full replace | `LEAGUE_PROFILES_JSON='{...}'` |
| Alternate file | `LEAGUE_PROFILES_PATH=/path/to/profiles.json` |
| Single league patch | `LEAGUE_PROFILE_39_JSON='{"homeAdvantage":1.1,"bttsRate":0.55}'` |
| Market prior blend | `LEAGUE_PROFILE_MARKET_BLEND=0.12` (0 disables soft BTTS/O/U/draw blend) |

## Rates stored per profile

| Field | Meaning |
|-------|---------|
| `goalFrequency` | Goals per match (total) |
| `drawFrequency` | Share of draws (0–1) |
| `cards` | Avg cards / match |
| `corners` | Avg corners / match |
| `homeAdvantage` | λ home multiplier |
| `bttsRate` | Both-teams-score rate |
| `overFrequency` | Over 2.5 rate |
| `possessionTendency` | Home possession bias (~0.5 balanced) |

## Automatic apply

`getLeagueParams(leagueId)` → `resolveLeagueParams()`:

1. Load profile from config (+ env overlays)  
2. Derive `leagueAvg` / home-away split / `rho` / `awayAdv`  
3. Predict uses these for λ, Dixon–Coles ρ, corners baselines, stake caps, blend weights  
4. Soft market priors blend BTTS / Over 2.5 / draw toward profile rates  
5. Prediction payload includes `leagueProfile` snapshot  

## Catalogued competitions

Premier League · La Liga · Serie A · Bundesliga · Ligue 1 · Romania SuperLiga · MLS · Champions League · Conference League (+ Europa League & Eredivisie for continuity)

Unknown league ids → `default` profile rates.
