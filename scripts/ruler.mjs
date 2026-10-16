/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

The ruler as a function: `measure(source, aspect) -> problems`.

WebKit, because the kit is written for the engine the post will run in —
`cqmin`, `:has()`, `justify-content: safe center` — and a pass in Chromium
is a pass in an engine no reader has (§ 5.45).

One browser, one page, reused across calls: launching WebKit per post
would cost more than the model. The page loads the SAME harness the gate
loads, so a number an agent optimises against is the number the gate
reports.

  import { openRuler } from "./ruler.mjs";
  const ruler = await openRuler();
  await ruler.measure(source, "4:3");   // [{code, message}, ...] both boxes
  await ruler.measure(source, "4:3", "en");   // as an English reader sees it
  await ruler.close();
*/

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { webkit } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = resolve(root, ".ruler");

/** Build the page bundle unless it is already there and `rebuild` is false. */
const buildBundle = (rebuild) => {
  if (!rebuild && existsSync(resolve(outDir, "ruler.js"))) return;
  execFileSync("npx", ["vite", "build", "--config", "vite.ruler.config.ts"], {
    cwd: root,
    stdio: "inherit",
  });
};

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="./spiral-app-shell.css">
</head><body><script type="module" src="./ruler.js"></script></body></html>`;

export const openRuler = async ({ rebuild = false } = {}) => {
  buildBundle(rebuild);
  writeFileSync(resolve(outDir, "ruler.html"), PAGE);

  // Served over HTTP, not `file://`: WebKit refuses a module script from a
  // null origin ("Origin null is not allowed by Access-Control-Allow-Origin"),
  // so the page would load and the ruler would never appear.
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" };
  const server = createServer((req, res) => {
    const name = (req.url ?? "/").split("?")[0];
    const file = resolve(outDir, name === "/" ? "ruler.html" : name.slice(1));
    if (!existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    const ext = file.slice(file.lastIndexOf("."));
    res.writeHead(200, { "content-type": types[ext] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const browser = await webkit.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${origin}/ruler.html`);
  await page.waitForFunction(() => Boolean(window.__spiralRuler));
  await page.evaluate(() => window.__spiralRuler.ready);

  return {
    /**
     * Both boxes, as the gate measures them: a post is wrong if it is wrong
     * in either. Returns `[{ mode, code, message }]`.
     */
    measure: async (source, aspect = "4:3", language = "uk", state = undefined) => {
      const out = [];
      for (const mode of ["row", "expanded"]) {
        // The page IS the box: the ruler asks the document how far its
        // content scrolls, so the viewport has to be the box (§ 5.45).
        const [w, h] = await page.evaluate(
          ([a, m]) => {
            const ROW = { "4:3": [322, 242], "1:1": [322, 322], "3:2": [322, 215], "16:9": [322, 181], "3:4": [225, 300] };
            return m === "row" ? (ROW[a] ?? ROW["4:3"]) : [402, 724];
          },
          [aspect, mode],
        );
        await page.setViewportSize({ width: w, height: h });
        const problems = await page.evaluate(
          ([src, a, m, l, st]) => window.__spiralRuler.measure(src, a, m, l, st ?? undefined),
          [source, aspect, mode, language, state ?? null],
        );
        for (const p of problems) out.push({ mode, ...p });
      }
      return out;
    },
    /**
     * A PNG of the post as the ruler mounted it, for an eye: the row by
     * default. The ruler reads rects; a screenshot is how a blind spot in
     * it gets found (§ 5.54, a name pushing «+1» out of a card it clipped).
     */
    shot: async (source, aspect = "4:3", path, mode = "row", language = "uk", state = undefined) => {
      const [w, h] = await page.evaluate(
        ([a, m]) => {
          const ROW = { "4:3": [322, 242], "1:1": [322, 322], "3:2": [322, 215], "16:9": [322, 181], "3:4": [225, 300] };
          return m === "row" ? (ROW[a] ?? ROW["4:3"]) : [402, 724];
        },
        [aspect, mode],
      );
      await page.setViewportSize({ width: w, height: h });
      await page.evaluate(([src, a, m, l, st]) => window.__spiralRuler.show(src, a, m, l, st ?? undefined), [source, aspect, mode, language, state ?? null]);
      await page.screenshot({ path, clip: { x: 0, y: 0, width: w, height: h } });
      await page.evaluate(() => window.__spiralRuler.unmount());
      return path;
    },
    /**
     * What the post's canvases hold before anyone touches it: for each
     * visible canvas, its size and the share of sampled pixels with any ink.
     * The ruler reads the DOM and cannot see a canvas's pixels (§ 7 #28); a
     * canvas drawn only in a loop that waits for a touch was blank in every
     * chat and clean in every measurement (§ 5.58).
     */
    ink: async (source, aspect = "4:3", mode = "row", waitMs = 400) => {
      const [w, h] = await page.evaluate(
        ([a, m]) => {
          const ROW = { "4:3": [322, 242], "1:1": [322, 322], "3:2": [322, 215], "16:9": [322, 181], "3:4": [225, 300] };
          return m === "row" ? (ROW[a] ?? ROW["4:3"]) : [402, 724];
        },
        [aspect, mode],
      );
      await page.setViewportSize({ width: w, height: h });
      await page.evaluate(([src, a, m]) => window.__spiralRuler.show(src, a, m), [source, aspect, mode]);
      await page.waitForTimeout(waitMs);
      const found = await page.evaluate(() =>
        [...document.querySelectorAll("canvas")]
          .filter((c) => {
            const r = c.getBoundingClientRect();
            return r.width >= 40 && r.height >= 40;
          })
          .map((c) => {
            const r = c.getBoundingClientRect();
            const probe = document.createElement("canvas");
            probe.width = 24;
            probe.height = 24;
            const x = probe.getContext("2d");
            let inked = 0;
            try {
              x.drawImage(c, 0, 0, 24, 24);
              const px = x.getImageData(0, 0, 24, 24).data;
              for (let i = 3; i < px.length; i += 4) if (px[i] > 0) inked += 1;
            } catch {
              inked = -1;
            }
            return { w: Math.round(r.width), h: Math.round(r.height), ink: inked < 0 ? null : inked / 576 };
          }),
      );
      await page.evaluate(() => window.__spiralRuler.unmount());
      return found;
    },
    errors,
    close: async () => {
      await browser.close();
      await new Promise((r) => server.close(r));
    },
  };
};

/** `node scripts/ruler.mjs <file.jsx> [aspect]` — one post, for a human. */
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const [, , file, aspect = "4:3"] = process.argv;
  if (!file) {
    console.error("usage: node scripts/ruler.mjs <file.jsx> [aspect]");
    process.exit(2);
  }
  const ruler = await openRuler();
  const problems = await ruler.measure(readFileSync(file, "utf8"), aspect);
  await ruler.close();
  if (problems.length === 0) console.log("clean");
  for (const p of problems) console.log(`[${p.mode}] [${p.code}] ${p.message}`);
}
