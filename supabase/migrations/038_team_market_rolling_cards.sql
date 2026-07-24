-- 038: Rolling cards averages per echipă, aditiv pe team_market_rolling (015).
--       Aceeaşi sursă (/fixtures/statistics) deja consumată pentru cornere/şuturi.
--
--       Convenţie de agregare: "weighted points", NU număr brut de cartonaşe.
--       Fiecare meci contribuie cu (redCards * 2 + yellowCards) înainte de mediere.
--       Un cartonaş roşu valorează 2 puncte, un galben 1 punct. Liniile Poisson pentru
--       piaţa Cards (Stage05Simulation.js) sunt exprimate în aceste puncte, nu în
--       număr fizic de cartonaşe — a nu se confunda cele două la citirea rezultatelor.

alter table public.team_market_rolling
  add column if not exists cards_for_avg numeric,
  add column if not exists cards_against_avg numeric,
  add column if not exists cards_for_home_avg numeric,
  add column if not exists cards_against_home_avg numeric,
  add column if not exists cards_for_away_avg numeric,
  add column if not exists cards_against_away_avg numeric;

comment on column public.team_market_rolling.cards_for_avg is
  'Medie rolling puncte-cartonaş (red*2 + yellow) marcate de echipă, ambele reprize, home+away.';
comment on column public.team_market_rolling.cards_against_avg is
  'Medie rolling puncte-cartonaş (red*2 + yellow) primite de echipă, ambele reprize, home+away.';
