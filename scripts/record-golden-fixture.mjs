/**
 * Regenerate golden expected blocks.
 *
 * Usage:
 *   node scripts/record-golden-fixture.mjs           # all cases
 *   node scripts/record-golden-fixture.mjs late-xg-blend
 *
 * Delegates to vitest with UPDATE_GOLDEN=1.
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const filter = process.argv[2] ? process.argv[2].replace(/\.json$/, "") : "";

const env = {
  ...process.env,
  UPDATE_GOLDEN: "1"
};

const args = ["vitest", "run", "tests/pipeline/goldenFixture.test.js", "--reporter=dot"];
if (filter) {
  args.push("-t", filter);
}

console.log("Recording golden fixtures…", filter || "(all)");
const r = spawnSync("npx", args, { cwd: root, env, stdio: "inherit", shell: true });
process.exit(r.status ?? 1);
