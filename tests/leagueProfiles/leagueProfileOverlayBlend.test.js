import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { getLeagueProfile } from "../../server-utils/leagueProfiles/LeagueProfile.js";
import {
  setRuntimeLeagueOverlays,
  clearRuntimeLeagueOverlays
} from "../../server-utils/leagueProfiles/leagueProfileOverlayRuntime.js";

const PREMIER_LEAGUE_ID = 39;
// Static config values for league 39 (leagueProfiles.config.json), asserted directly
// so this test fails loudly (not silently) if the fixture config ever changes.
const STATIC_OVER_FREQUENCY = 0.55;

afterEach(() => {
  clearRuntimeLeagueOverlays();
  delete process.env.LEAGUE_PROFILE_OVERLAY_ENABLED;
  delete process.env.LEAGUE_PROFILE_OVERLAY_MAX_DELTA;
});

test("getLeagueProfile falls back to pure static when the runtime overlay cache is cold", () => {
  clearRuntimeLeagueOverlays();
  const profile = getLeagueProfile(PREMIER_LEAGUE_ID);
  assert.equal(profile.overFrequency, STATIC_OVER_FREQUENCY);
});

test("getLeagueProfile applies an overlay fully when within the max-delta budget", () => {
  setRuntimeLeagueOverlays(
    new Map([[PREMIER_LEAGUE_ID, { leagueId: PREMIER_LEAGUE_ID, values: { overFrequency: STATIC_OVER_FREQUENCY + 0.03 } }]]),
    "test-model"
  );
  const profile = getLeagueProfile(PREMIER_LEAGUE_ID);
  assert.ok(Math.abs(profile.overFrequency - (STATIC_OVER_FREQUENCY + 0.03)) < 1e-9);
});

test("getLeagueProfile clamps an overlay that exceeds the max-delta budget", () => {
  process.env.LEAGUE_PROFILE_OVERLAY_MAX_DELTA = "0.06";
  setRuntimeLeagueOverlays(
    new Map([[PREMIER_LEAGUE_ID, { leagueId: PREMIER_LEAGUE_ID, values: { overFrequency: 0.95 } }]]),
    "test-model"
  );
  const profile = getLeagueProfile(PREMIER_LEAGUE_ID);
  assert.ok(Math.abs(profile.overFrequency - (STATIC_OVER_FREQUENCY + 0.06)) < 1e-9);
});

test("getLeagueProfile ignores the overlay entirely when LEAGUE_PROFILE_OVERLAY_ENABLED=0", () => {
  setRuntimeLeagueOverlays(
    new Map([[PREMIER_LEAGUE_ID, { leagueId: PREMIER_LEAGUE_ID, values: { overFrequency: 0.7 } }]]),
    "test-model"
  );
  process.env.LEAGUE_PROFILE_OVERLAY_ENABLED = "0";
  const profile = getLeagueProfile(PREMIER_LEAGUE_ID);
  assert.equal(profile.overFrequency, STATIC_OVER_FREQUENCY);
});
