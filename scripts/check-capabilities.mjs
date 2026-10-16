/**
 * One capability, four lists, no thread between them.
 *
 * A capability has to be written down in four places before an app can use
 * it: the backend's manifest array (every generated post asks for exactly
 * that), this repo's artifact list, this repo's protocol list, and the set
 * iOS is willing to grant. iOS grants precisely what a manifest asks for, so
 * a capability missing from the BACKEND list is not a mismatch that shows up
 * as an error — it is a feature that silently does nothing.
 *
 * That is what happened to `ui.haptic` and `ui.expand`: shipped in the shell
 * and on iOS on 2026-09-19, absent from the backend array, and therefore
 * dead in every agent-made post until 2026-09-20 — including the drawing
 * posts the prompt tells to call `useExpand()`, because a timeline row eats
 * the swipe. It was found by decrypting a published artifact and reading its
 * manifest, which is not a thing anyone should have to do twice.
 *
 * So: read all four, compare, fail loudly. A sibling repo that is not on
 * this machine is skipped with a word, never assumed to agree.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const siblings = resolve(repo, "..");

/**
 * The quoted capability names in the array ASSIGNED at `name`.
 *
 * Anchored on `= [` rather than the first bracket, because both the Rust and
 * the TypeScript declarations carry a bracket in their TYPE first —
 * `[&str; 7]`, `readonly SpiralMethod[]` — and reading that one finds an
 * empty list and calls it a disagreement.
 */
const assignedList = (text, name) => {
  const start = text.indexOf(name);
  if (start === -1) return undefined;
  const after = text.slice(start);
  const assign = after.search(/=\s*\[/);
  if (assign === -1) return undefined;
  const open = start + assign + after.slice(assign).indexOf("[");
  const close = text.indexOf("]", open);
  if (close === -1) return undefined;
  return [...text.slice(open, close).matchAll(/"([a-z]+(?:\.[a-z]+)+)"/g)].map((m) => m[1]);
};

/** The quoted names in the array `name` is assigned — identifiers, not capabilities. */
const assignedNames = (text, name) => {
  const start = text.indexOf(name);
  if (start === -1) return undefined;
  // Past the `=`: a Rust list is typed `[&str; N] = [` first.
  const assign = text.indexOf("=", start);
  const open = text.indexOf("[", assign);
  const close = text.indexOf("]", open);
  if (assign === -1 || open === -1 || close === -1) return undefined;
  return [...text.slice(open, close).matchAll(/"(\w+)"/g)].map((m) => m[1]);
};

const sources = [
  {
    name: "shell protocol",
    path: resolve(repo, "src/shell/protocol.ts"),
    read: (text) => assignedList(text, "export const V1_CAPABILITIES"),
  },
  {
    name: "shell artifact",
    path: resolve(repo, "src/artifact/container.ts"),
    read: (text) => assignedList(text, "export const V1_CAPABILITIES"),
  },
  {
    name: "backend manifest",
    path: resolve(siblings, "matrix-agent-platform/src/domain/spiral_app/container.rs"),
    read: (text) => assignedList(text, "pub const V1_CAPABILITIES"),
  },
  {
    name: "iOS granted",
    path: resolve(siblings, "agent-x-ios/ElementX/Sources/Services/AgentPlatform/SpiralApp/SpiralAppRuntimeModels.swift"),
    // `production` is a Swift array of enum CASES, so the raw values have to
    // come from the enum above it. Its opening bracket sits inside a computed
    // property body, past the type's own brackets.
    read: (text) => {
      const raws = new Map(
        [...text.matchAll(/case\s+(\w+)\s*=\s*"([a-z]+(?:\.[a-z]+)+)"/g)].map((m) => [m[1], m[2]]),
      );
      const start = text.indexOf("static var production");
      if (start === -1) return undefined;
      const body = text.indexOf("{", start);
      const open = text.indexOf("[", body);
      const close = text.indexOf("]", open);
      if (body === -1 || open === -1 || close === -1) return undefined;
      return [...text.slice(open, close).matchAll(/\.(\w+)/g)]
        .map((m) => raws.get(m[1]))
        .filter((value) => value !== undefined);
    },
  },
];

let reference;
let failed = false;

for (const source of sources) {
  if (!existsSync(source.path)) {
    console.log(`skip  ${source.name.padEnd(17)} not on this machine`);
    continue;
  }
  const found = source.read(readFileSync(source.path, "utf8"));
  if (!found || found.length === 0) {
    console.error(`FAIL  ${source.name.padEnd(17)} could not be read — has the list moved?`);
    failed = true;
    continue;
  }
  const sorted = [...found].sort();
  if (!reference) {
    reference = { name: source.name, list: sorted };
    console.log(`ok    ${source.name.padEnd(17)} ${found.length}: ${found.join(", ")}`);
    continue;
  }
  const same =
    sorted.length === reference.list.length && sorted.every((value, i) => value === reference.list[i]);
  if (same) {
    console.log(`ok    ${source.name.padEnd(17)} ${found.length}`);
  } else {
    const missing = reference.list.filter((value) => !sorted.includes(value));
    const extra = sorted.filter((value) => !reference.list.includes(value));
    console.error(
      `FAIL  ${source.name.padEnd(17)} disagrees with ${reference.name}` +
        (missing.length ? `\n        missing: ${missing.join(", ")}` : "") +
        (extra.length ? `\n        extra:   ${extra.join(", ")}` : ""),
    );
    failed = true;
  }
}

// The same for what `@spiral/ui` and `@spiral/sdk` export: the orchestrator
// refuses a module that imports a name not in ITS list, and the packer's
// mirror (check-source.mjs) must refuse the same — the mirror lagged the
// orchestrator by `Swatch` and `accent`, and refused a template the
// orchestrator would have passed (2026-09-25).
const exportLists = [
  ["@spiral/ui", "const UI = ", "const UI_EXPORTS"],
  ["@spiral/sdk", "const SDK = ", "const SDK_EXPORTS"],
  ["@spiral/play", "const PLAY = ", "const PLAY_EXPORTS"],
];
const mirror = resolve(repo, "scripts/check-source.mjs");
const generator = resolve(siblings, "matrix-agent-platform/src/domain/spiral_app/generator.rs");
if (existsSync(generator)) {
  const mirrorText = readFileSync(mirror, "utf8");
  const generatorText = readFileSync(generator, "utf8");
  for (const [name, mirrorList, generatorList] of exportLists) {
    const a = assignedNames(mirrorText, mirrorList)?.sort();
    const b = assignedNames(generatorText, generatorList)?.sort();
    if (!a || !b) {
      console.error(`FAIL  ${name.padEnd(17)} could not read the export lists`);
      failed = true;
      continue;
    }
    const same = a.length === b.length && a.every((v, i) => v === b[i]);
    if (same) {
      console.log(`ok    ${name.padEnd(17)} ${a.length} exports, mirror and orchestrator agree`);
    } else {
      console.error(`FAIL  ${name.padEnd(17)} check-source.mjs and generator.rs disagree: mirror ${a.join(", ")} · orchestrator ${b.join(", ")}`);
      failed = true;
    }
  }
  // The runtime levels (§ 5.75): which imports need which build. The
  // orchestrator names a generated post's runtime from them and the
  // catalogue a template's; two tables that differ would publish the same
  // source under two runtimes.
  const levels = (text) =>
    [...text.matchAll(/\(\s*"?(1\.\d+)"?,\s*&?\[([^\]]*)\],?\s*\)|\["(1\.\d+)",\s*\[([^\]]*)\]\]/g)]
      .map((m) => `${m[1] ?? m[3]}:${[...(m[2] ?? m[4]).matchAll(/"([^"]+)"/g)].map((n) => n[1]).sort().join(",")}`)
      .sort()
      .join(" ");
  const pack = readFileSync(resolve(repo, "scripts/catalog-pack.mjs"), "utf8");
  const ours = levels(pack.slice(pack.indexOf("RUNTIME_LEVELS")));
  const theirs = levels(generatorText.slice(generatorText.indexOf("RUNTIME_LEVELS")));
  if (ours.length > 0 && ours === theirs) {
    console.log(`ok    runtime levels    ${ours}`);
  } else {
    console.error(`FAIL  runtime levels    catalog-pack.mjs ${ours || "(none)"} · generator.rs ${theirs || "(none)"}`);
    failed = true;
  }
} else {
  console.log("skip  export lists     the orchestrator is not on this machine");
}

if (failed) {
  console.error(
    "\nA capability must be in all four lists. The backend one is the one that\n" +
      "fails quietly: iOS grants exactly what a manifest asks for, so anything\n" +
      "missing there is simply dead in every generated post.",
  );
  process.exit(1);
}
