/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Bundle a corpus of *.jsx for the device's layout lab:

  node scripts/lab-bundle.mjs [--dir eval/chain-pi] [ids…]

Each module is preceded by `// ===== <id> <aspect>` (aspect from report.json,
4:3 when unknown). The lab screen splits on that line, mounts each in the
row box at its aspect, then in the viewer's box, and the runtime's ruler
writes its verdict to the app log. `scripts/lab-report.sh` reads it back.
*/
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// `--dir` because a trial corpus lives beside the standing one and the
// device is where the Mac ruler's verdict is arbitrated (§ 5.45).
const argv = process.argv.slice(2);
const dirFlag = argv.indexOf("--dir");
const dir = dirFlag === -1 ? "eval/generated" : argv[dirFlag + 1];
if (dirFlag !== -1) argv.splice(dirFlag, 2);
const report = (() => {
  try {
    return JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
  } catch {
    return [];
  }
})();
const aspectOf = (id) => report.find((r) => r.id === id)?.aspect ?? "4:3";
const only = argv;
const files = readdirSync(dir).filter((f) => f.endsWith(".jsx")).sort();
const out = [];
for (const file of files) {
  const id = file.replace(/\.jsx$/, "");
  if (only.length > 0 && !only.includes(id)) continue;
  out.push(`// ===== ${id} ${aspectOf(id)}`);
  out.push(readFileSync(join(dir, file), "utf8"));
}
process.stdout.write(out.join("\n"));
