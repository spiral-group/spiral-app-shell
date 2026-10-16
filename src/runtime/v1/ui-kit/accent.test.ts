/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066. Colour that means something.

The palettes are measured in kit.css — the row's six per theme and each
scene's own six (§ 5.76). What is testable here is the INDEXING — that a post
with more series than the palette has keeps working, and that nothing it can
pass names a variable that does not exist — and that every scene gives all
six. A canvas reading them is the ruler's to see (`ink`), on a real canvas.
*/

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { accent } from "./index";

describe("the accent a post picks by index", () => {
  it("gives a different colour to each of the six", () => {
    const six = [0, 1, 2, 3, 4, 5].map(accent);
    expect(new Set(six).size).toBe(6);
  });

  it("wraps rather than running out", () => {
    // A chart with nine series is a bad chart, not a crash.
    expect(accent(6)).toBe(accent(0));
    expect(accent(13)).toBe(accent(1));
  });

  it("names a variable that exists, whatever it is handed", () => {
    for (const odd of [-1, -7, 2.7, 0.4, Number.NaN]) {
      expect(accent(odd)).toMatch(/^var\(--s-accent-[1-6]\)$/);
    }
  });

  it("is defined for the row in both themes and for every scene", () => {
    const css = readFileSync(new URL("./kit.css", import.meta.url), "utf8");
    for (const theme of ["arcade", "board", "paper", "party", "poster", "sky", "field", "night"]) {
      const line = css.split("\n").find((l) => new RegExp(`^\\.s-scene--${theme}\\s+\\{`).test(l) && l.includes("--s-accent-1"));
      expect(line, theme).toBeDefined();
      for (let n = 1; n <= 6; n += 1) expect(line).toMatch(new RegExp(`--s-accent-${n}: #[0-9a-f]{6}`));
    }
    expect(css.match(/--s-accent-6: #[0-9a-f]{6};\n/g)?.length).toBe(2);
  });
});
