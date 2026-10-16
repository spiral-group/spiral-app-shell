/**
 * Write `eval/layout-baseline.json` from what the ruler reports today.
 *
 * Run it when a layout problem has been FIXED, never to make a new one go
 * away: the gate refuses a box that is cleaner than its baseline precisely
 * so that this file cannot drift into a list of excuses.
 *
 *   node scripts/layout-baseline.mjs
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// The run FAILS by design when a box is worse than its baseline, and its
// output is exactly what has to be read — so the exit code is ignored and
// stdout is not.
const run = spawnSync("pnpm", ["vitest", "run", "--config", "vitest.browser.config.ts"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;

const baseline = {};
let key;
for (const line of out.split("\n")) {
  const head = /^\s{2}(\S+\.jsx) · (row|expanded)$/.exec(line);
  if (head) {
    key = `${head[1]} · ${head[2]}`;
    baseline[key] = [];
    continue;
  }
  const problem = /^\s{6}\[([a-z-]+)\]/.exec(line);
  if (problem && key) baseline[key].push(problem[1]);
  if (!problem && !head && line.trim() === "") key = undefined;
}

for (const k of Object.keys(baseline)) baseline[k] = baseline[k].sort();

writeFileSync("eval/layout-baseline.json", `${JSON.stringify(baseline, null, 2)}\n`);
const boxes = Object.keys(baseline).length;
const problems = Object.values(baseline).reduce((n, v) => n + v.length, 0);
console.log(`baseline written: ${boxes} boxes carrying ${problems} problems`);
console.log("(a fixture's problems belong here too — they are what proves the ruler still sees)");
