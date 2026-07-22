import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveEloInfo } from "../../../server-utils/pipeline/modelFusion/deriveEloInfo.js";

test("deriveEloInfo returns null when either team id is missing", async () => {
  assert.equal(await deriveEloInfo({ lId: 39, homeIdStr: null, awayIdStr: "50", homeAdv: 1.06 }), null);
  assert.equal(await deriveEloInfo({ lId: 39, homeIdStr: "33", awayIdStr: null, homeAdv: 1.06 }), null);
});

test("deriveEloInfo returns a well-shaped result for real ids (falls back to default Elo without Supabase config)", async () => {
  const out = await deriveEloInfo({ lId: 39, homeIdStr: "33", awayIdStr: "50", homeAdv: 1.06 });
  assert.ok(out === null || (typeof out === "object" && Number.isFinite(out.eloHome) && Number.isFinite(out.eloAway)));
  if (out) {
    assert.ok(Number.isFinite(out.eloSpread));
    assert.ok(out.probs && Number.isFinite(out.probs.p1) && Number.isFinite(out.probs.pX) && Number.isFinite(out.probs.p2));
  }
});
