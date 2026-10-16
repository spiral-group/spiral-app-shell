#!/usr/bin/env node
/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

The curated catalogue (§ 5.56): templates a person publishes in one tap, or
starts a conversation from. Each is held to what a model's module is — the
same checks (check-source.mjs) and the same ruler, both boxes — and a
template that fails either is not packed. What ships is static files served
by Caddy at /catalog/ on the homeserver host:

  index.json              sections and items, as catalog/index.json says
  <id>/app.jsx            the source, as is
  <id>/manifest.json      the manifest TEXT the client packs with it

No picture of the row: the catalogue runs each template itself, in the
viewer's language with the room's people (§ 5.61) — a picture would be one
language and one roster.

An item may carry `asks` — {uk, ru, en} — when it needs its owner's words
before it is a post; the client then starts it with the agent, never
publishes it as is.

  node --experimental-strip-types scripts/catalog-pack.mjs [--out <dir>]
*/
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { V1_CAPABILITIES } from "../src/artifact/container.ts";
import { checkSource } from "./check-source.mjs";
import { openRuler } from "./ruler.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const out = outFlag === -1 ? resolve(root, "../matrix-agent-platform/deploy/config/catalog") : resolve(args[outFlag + 1]);

const index = JSON.parse(readFileSync(join(root, "catalog/index.json"), "utf8"));
/** The app's languages: the two it is translated into, and the fallback. */
const LANGUAGES = ["uk", "ru", "en"];
const ruler = await openRuler({ rebuild: true });

const failures = [];
const packed = [];
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

/**
 * The runtime a post asks for — `1`, or `1.<level>` when it imports a name
 * the runtime gained later (§ 5.75). The runtime is the app's: an older build
 * has only what it shipped, and a post importing `useSeats` there fails to
 * link. The same table as the orchestrator's `RUNTIME_LEVELS` (generator.rs);
 * `check-capabilities.mjs` holds them equal.
 */
export const RUNTIME_LEVELS = [["1.1", ["useSeats", "useLeaderboard", "Leaderboard", "Scene", "useChanged", "useSealed"]]];
const importsName = (source, name) =>
  source.split("\n").filter((l) => l.trimStart().startsWith("import")).some((l) => l.split(/[^A-Za-z0-9_]/).includes(name));
const runtimeFor = (source) => {
  const found = [...RUNTIME_LEVELS].reverse().find(([, names]) => names.some((name) => importsName(source, name)));
  return found ? found[0] : "1";
};
// The phone's private corner only for a template that seals a move (§ 5.78)
// — the orchestrator's `capabilities_for`: iOS refuses, whole, a manifest
// asking for what a build cannot give.
const SEALED_CAPABILITIES = ["state.private.read", "state.private.write"];
const capabilitiesFor = (source) =>
  V1_CAPABILITIES.filter((c) => importsName(source, "useSealed") || !SEALED_CAPABILITIES.includes(c));

for (const item of index.items) {
  const source = readFileSync(join(root, "catalog", item.source), "utf8");
  const refused = checkSource(source);
  // In every language the app ships: a template's own words follow its
  // reader's (§ 5.60), and «Spin again» is not «Крутити знову» in width.
  const layout = [];
  if (refused.length === 0) {
    for (const language of LANGUAGES) {
      for (const p of await ruler.measure(source, item.aspect, language)) layout.push({ language, ...p });
    }
  }
  if (refused.length || layout.length) {
    failures.push(`${item.id}: ${[...refused, ...layout.map((p) => `[${p.language}][${p.mode}][${p.code}] ${p.message}`)].join("; ")}`);
    continue;
  }
  // The same manifest a generated draft carries, named for the template.
  // Key order is the wire order (container.rs): the client packs this TEXT.
  const runtime = runtimeFor(source);
  const manifest = JSON.stringify({
    app_id: `tpl-${item.id}`,
    runtime,
    entry: "app.jsx",
    aspect: item.aspect,
    state_channel: "matrix",
    capabilities: capabilitiesFor(source),
    limits: { max_state_bytes: 16384 },
  });
  const dir = join(out, item.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "app.jsx"), source);
  writeFileSync(join(dir, "manifest.json"), manifest);
  packed.push({
    id: item.id,
    // The base text is Ukrainian; `titles`/`descriptions` carry the other
    // languages the app ships (§ 5.59), and the client picks the app's.
    title: item.title,
    titles: item.titles ?? {},
    description: item.description,
    descriptions: item.descriptions ?? {},
    aspect: item.aspect,
    source: `${item.id}/app.jsx`,
    manifest: `${item.id}/manifest.json`,
    // A template that is only a shape until it is filled (a poll's question)
    // is never published as is: the client opens it with the agent, which
    // asks this, by language, beside Draft v1 (§ 5.60).
    ...(item.asks ? { asks: item.asks } : {}),
    // A template importing a name the runtime gained later needs a build
    // that has it; an older build leaves it out of its list (§ 5.75).
    ...(runtime !== index.runtime ? { runtime } : {}),
  });
  console.log(`ok  ${item.id.padEnd(14)} ${item.aspect}  ${source.length} B`);
}
await ruler.close();

if (failures.length) {
  console.error(`\n${failures.length} template(s) refused:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
const sections = index.sections
  .map((s) => ({ ...s, items: s.items.filter((id) => packed.some((p) => p.id === id)) }))
  .filter((s) => s.items.length > 0);
writeFileSync(join(out, "index.json"), JSON.stringify({ version: index.version, runtime: index.runtime, sections, items: packed }, null, 2));
console.log(`\ncatalogue: ${packed.length} templates → ${out}`);
