/**
 * Golden fixture harness — locks λ / pRaw / 1X2 / pick through Stage03–09.
 * Regenerate: UPDATE_GOLDEN=1 npm run test:golden
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  goldenOddsPayload,
  goldenEloPair,
  setGoldenMocks,
  buildDefaultOddsPayload,
  DEFAULT_ELO
} from "./goldenMocks.js";

vi.mock("../../server-utils/oddsPrefetch.js", async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    getOddsForFixture: async () => ({
      ok: Boolean(goldenOddsPayload),
      data: goldenOddsPayload
    })
  };
});

vi.mock("../../server-utils/teamElo.js", async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    lookupEloPair: async () => goldenEloPair
  };
});

vi.mock("../../server-utils/fetcher.js", async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    getWithCache: async () => ({ ok: false, error: "golden_offline", status: 503 })
  };
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.resolve(__dirname, "../fixtures/golden");
const UPDATE = String(process.env.UPDATE_GOLDEN || "") === "1";

function listCases() {
  return fs
    .readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(GOLDEN_DIR, f));
}

function loadCase(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

describe("Predictor V3 golden fixtures", () => {
  let buildGoldenContext;
  let runGoldenPipeline;
  let extractGoldenSnapshot;
  let assertGoldenSnapshot;

  beforeAll(async () => {
    process.env.MONTE_CARLO_ADAPTIVE = "0";
    process.env.MONTE_CARLO_SIMS = "1000";

    ({ buildGoldenContext } = await import("../../server-utils/pipeline/golden/buildGoldenContext.js"));
    ({ runGoldenPipeline } = await import("../../server-utils/pipeline/golden/runGoldenPipeline.js"));
    ({ extractGoldenSnapshot, assertGoldenSnapshot } = await import(
      "../../server-utils/pipeline/golden/extractGoldenSnapshot.js"
    ));
  });

  beforeEach(() => {
    setGoldenMocks({
      odds: buildDefaultOddsPayload(),
      elo: DEFAULT_ELO
    });
  });

  for (const filePath of listCases()) {
    const base = path.basename(filePath);
    it(base, async () => {
      const goldenCase = loadCase(filePath);
      const odds =
        goldenCase.mocks?.odds != null
          ? goldenCase.mocks.odds
          : buildDefaultOddsPayload();
      const elo = goldenCase.mocks?.elo || DEFAULT_ELO;
      setGoldenMocks({ odds, elo });

      const context = buildGoldenContext(goldenCase);
      await runGoldenPipeline(context, {
        startStage: goldenCase.startStage || "Stage03LambdaGeneration"
      });

      const actual = extractGoldenSnapshot(context);

      if (UPDATE) {
        goldenCase.expected = {
          lambdaHome: actual.lambdaHome,
          lambdaAway: actual.lambdaAway,
          pRaw: actual.pRaw,
          probs1x2: actual.probs1x2,
          pick: actual.pick,
          method: actual.method,
          aborted: actual.aborted,
          insufficientReason: actual.insufficientReason
        };
        // Keep mocks.odds as null → default builder in tests (avoid huge JSON).
        if (goldenCase.mocks) goldenCase.mocks.odds = null;
        fs.writeFileSync(filePath, JSON.stringify(goldenCase, null, 2) + "\n", "utf8");
        return;
      }

      expect(goldenCase.expected, `${base}: run UPDATE_GOLDEN=1 to record expected`).toBeTruthy();
      const errors = assertGoldenSnapshot(actual, goldenCase.expected, 0.1);
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }
});
