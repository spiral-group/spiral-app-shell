/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 step 6.12 — `@spiral/play`: the parts of a moving post that are
too fiddly to rewrite per generation.

IT USED TO SHIP THREE LIBRARIES AND THEY WERE NEVER ONCE USED.

Motion (`animate`, `inView`, `stagger`), @use-gesture (`useDrag`,
`useGesture`, `usePinch`, `useWheel`) and perfect-freehand (`getStroke`)
were here because a sandboxed frame has no network, so anything a post
imports must already be on our origin, and these are genuinely fiddly to
rewrite per generation. Counted on 2026-09-21 across **181 generated
modules — the corpus, an edit of every post in it, and two chains of eight
— every one of those nine exports was imported ZERO times.** What the
model reaches for instead is CSS transitions, `useFrame`, and a plain
canvas with `lineTo`.

They cost 189.4 KB of the 189.4 KB this file weighed, downloaded and parsed
by the eighteen posts that import `fitCanvas` — a twenty-line helper — and
six lines of a system prompt paid for on every generation.

Removed rather than kept against a use that has not appeared in 181 tries.
Putting any of them back is one dependency and one export; what is not
recoverable is the attention spent reading about them in a prompt.

`strokePath` stays and is ours: the SVG/Path2D `d` string an outline wants,
for a post that computes its own. `fitCanvas` is the one thing here that is
actually used.
*/

/** A point in a stroke: x, y and an optional pressure 0…1. */
export type StrokePoint = readonly [number, number] | readonly [number, number, number];

/**
 * The outline `getStroke` returns, as a closed path.
 *
 * Feed it to `new Path2D(d)` for a canvas or to `<path d={d}>` for SVG. A
 * quadratic through the midpoints, which is what makes the corners look
 * rounded instead of chipped.
 */
export const strokePath = (outline: readonly (readonly number[])[]): string => {
  if (outline.length === 0) return "";
  const d: (string | number)[] = ["M", outline[0]![0]!, outline[0]![1]!, "Q"];
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    d.push(a[0]!, a[1]!, (a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2);
  }
  d.push("Z");
  return d.join(" ");
};

/**
 * Keep a box's drawing surface in step with its CSS size and the screen's
 * pixel density, and hand back a context already scaled to CSS pixels.
 *
 * Every canvas app gets this wrong in the same way: it sets width/height
 * once, in CSS pixels, and draws a blurry half-resolution picture on a
 * phone. Call it from a `ref` callback or an effect.
 */
export const fitCanvas = (canvas: HTMLCanvasElement): CanvasRenderingContext2D | null => {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
};
