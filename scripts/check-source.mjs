/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

The checks a module must pass before it may be a post — a mirror of the
orchestrator's `generator::check_source`, shared by the generator harness
(gen-eval) and the catalogue packer (catalog-pack), so a template is held
to exactly what a model's module is.
*/
import { transform } from "sucrase";

// Mirror of the orchestrator's `generator::check_source`.
export const ALLOWED = ["react", "@spiral/sdk", "@spiral/ui", "@spiral/play"];
const SDK = ["Spiral", "useSharedState", "useOwnState", "useRoomMembers", "useNow", "useSpiralContext", "useViewport", "useFrame", "useSound", "useHaptic", "useExpand", "summary", "OWNED_NAMESPACE", "useSeats", "useLeaderboard", "useChanged", "useSealed"];
const PLAY = ["strokePath", "fitCanvas"];
const UI = ["Text", "Button", "Choice", "Check", "Counter", "Row", "List", "Progress", "Avatar", "Meta", "Input", "Stack", "Fill", "Grid", "Square", "Hero", "Only", "Board", "Card", "Swatch", "accent", "Leaderboard", "Scene"];
const FORBIDDEN = ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "new Worker", "eval(", "new Function", "import(", "localStorage", "Date.now"];
export const checkSource = (source) => {
  const problems = [];
  // DOES IT PARSE? The artifact ships raw source and the phone transpiles it,
  // so an unclosed tag is published, downloaded, and dies at mount with no
  // trace on the server. One edit in fifty-two did exactly that, at BOTH
  // thinking levels (2026-09-21). Mirrors the orchestrator's `check_parses`,
  // and uses the transpiler that actually runs rather than a second opinion.
  try {
    transform(source, { transforms: ["jsx", "typescript"], filePath: "app.jsx" });
  } catch (e) {
    problems.push(`the source is not valid JSX and cannot run at all: ${String(e.message).split("\n")[0]}`);
    return problems;
  }
  if (source.length > 64 * 1024) problems.push("too large");
  if (!source.includes("export default")) problems.push("no default export");
  for (const line of source.split("\n")) {
    const t = line.trimStart();
    if (!t.startsWith("import ")) continue;
    const m = /from\s+["']([^"']+)["']/.exec(t);
    if (!m) continue;
    if (!ALLOWED.includes(m[1])) problems.push(`forbidden import ${m[1]}`);
    const names = /\{([^}]*)\}/.exec(t)?.[1];
    if (!names) continue;
    const exports = m[1] === "@spiral/sdk" ? SDK : m[1] === "@spiral/ui" ? UI : m[1] === "@spiral/play" ? PLAY : null;
    if (!exports) continue;
    for (const raw of names.split(",")) {
      const name = raw.trim().split(/\s+/)[0];
      if (name && !exports.includes(name)) problems.push(`${name} is not exported by ${m[1]}`);
    }
  }
  for (const f of FORBIDDEN) if (source.includes(f)) problems.push(`uses ${f}`);
  // Layout and motion (step 6.10): the box is ≤ 300 px and never scrolls;
  // motion is CSS on transform/opacity, never a JS loop.
  for (const m of source.matchAll(/\b(width|height|minWidth|minHeight)\s*:\s*(\d{3,})\b/g)) {
    if (Number(m[2]) >= 160) problems.push(`fixed ${m[1]}: ${m[2]}px will not fit a 225–300 px box; size relative to the box`);
  }
  for (const m of source.matchAll(/\b(width|height)\s*:\s*["'](\d{3,})px["']/g)) {
    if (Number(m[2]) >= 160) problems.push(`fixed ${m[1]}: ${m[2]}px will not fit a 225–300 px box; size relative to the box`);
  }
  if (/overflow(Y|X)?\s*:\s*["'](auto|scroll)["']/.test(source)) problems.push("overflow: auto/scroll — the box never scrolls; use <Fill scroll> (viewer only) or show less");
  if (/\d+(vw|vh|vmin|vmax)\b/.test(source)) problems.push("vw/vh — that is the phone, not the box; use the kit's Stack/Square/Grid or % of the parent");
  // A loop is allowed now (step 6.12) — but through `useFrame`, which waits
  // for the first touch (WebKit throttles rAF in this frame until then) and
  // stops when the post scrolls away. A raw loop does neither.
  if (/requestAnimationFrame/.test(source) && !/useFrame/.test(source)) {
    problems.push("raw requestAnimationFrame — use useFrame from @spiral/sdk (it waits for the first touch and pauses off screen)");
  }
  // The other half of the import check, mirroring the orchestrator: a name
  // USED but never imported compiles, renders, and throws on the first tap.
  const importLines = source.split("\n").filter((l) => l.trimStart().startsWith("import ")).join("\n");
  const imported = (name) => new RegExp(`\\b${name}\\b`).test(importLines);
  for (const name of SDK) {
    const used = name === "Spiral" ? source.includes("Spiral.") : source.includes(`${name}(`);
    if (used && !imported(name)) problems.push(`uses ${name} without importing it from @spiral/sdk`);
  }
  for (const name of UI) {
    if ((source.includes(`<${name} `) || source.includes(`<${name}>`)) && !imported(name)) {
      problems.push(`uses <${name}> without importing it from @spiral/ui`);
    }
  }
  for (const name of PLAY) {
    if (source.includes(`${name}(`) && !imported(name)) problems.push(`uses ${name} without importing it from @spiral/play`);
  }
  if (/path:\s*(""|''|\[\s*\]|\[\s*(""|'')\s*\])/.test(source)) {
    problems.push("the source writes to the WHOLE state (path: \"\"), which replaces everything and loses whatever the other person did between your read and your write — name the path you are changing");
  }
  if (/<button/.test(source)) {
    problems.push("the source builds its own <button>; use <Button>, <Choice> or <Swatch> — a hand-made one comes out too small to hit");
  }
  if (/setInterval\s*\(/.test(source)) {
    problems.push("setInterval — use useFrame for motion, or useNow for a clock");
  }
  // Mirror of `check_lengths_have_units`: `height: "100"` — a length in quotes
  // with no unit, which CSS drops. The model wrote it for "100%" on edits.
  const LENGTHS = ["width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight", "top", "left", "right", "bottom", "inset", "gap", "rowGap", "columnGap", "fontSize", "borderRadius", "padding", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight", "margin", "marginTop", "marginBottom", "marginLeft", "marginRight"];
  for (const m of source.matchAll(new RegExp(`(?<![\\w$])(${LENGTHS.join("|")})\\s*:\\s*(["'])(\\d+(?:\\.\\d*)?|\\.\\d+)\\2`, "g"))) {
    if (Number(m[3]) !== 0) {
      problems.push(`\`${m[1]}: ${m[2]}${m[3]}${m[2]}\` is not a CSS length — a string needs its unit ("100%", "100px"); a bare number is pixels (100); write the one you mean`);
      break;
    }
  }
  // Mirror of `check_no_member_is_written_in`: a Matrix user id in the code.
  // Letters on both sides of the colon, so `@media (`, `@spiral/sdk` and a
  // clock `@12:30` pass; exact on the 263 corpus modules (2026-09-22).
  for (const m of source.matchAll(/@([A-Za-z0-9._=\-/+]+):([A-Za-z0-9.\-]+)/g)) {
    if (/[A-Za-z]/.test(m[1]) && /[A-Za-z]/.test(m[2])) {
      problems.push(`the source names the Matrix user \`${m[0]}\` — a post is read in whatever room it is shown in, so its people come from useRoomMembers(), never from the code; remove the list and read them`);
      break;
    }
  }
  return problems;
};

