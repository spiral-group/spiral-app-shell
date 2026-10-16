/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 step 6.11 — what a generated layout got WRONG, measured in the
frame that shows it.

A chess board came out with its empty ranks half the height of the full
ones (a grid with `aspect-ratio` and `max-height` but no row template, so
WebKit sized the rows by content), and a tap by geometry landed on the wrong
rank on both phones (2026-09-18). Nothing in the pipeline could have said
so: happy-dom has no layout, the frame's console does not reach the host,
and a screenshot is a picture, not a number.

This module asks the DOM the questions a reviewer would ask with a ruler.
It runs in the frame after paint and after every viewport change, and in
the verifier under Playwright — one code, one set of rules. It reports
PROBLEMS only; a clean layout is silent.

Rules (the numbers are the kit's, from § 4.4 and the prompt):
  overflow   — content past the box, either axis (the row never scrolls)
  clipped    — a control whose rect is partly outside the box, or cut at
               the side by an ancestor that hides overflow (a Card)
  tiny-text  — visible text under 11 px
  squeezed   — a text narrower than its own words, spilling out of its box
               (a caption crushed to nothing beside a group that took the
               line, so «Привітань: 0» fell into a column at the left)
  small-hit  — a button/input under 40 px on either side
  ragged-grid — a CSS grid whose cells are not all the same size (a board
                with collapsed rows, a keypad with a fat column)
  not-square — a grid the app asked to be square (`aspect-ratio` 1) whose
               cells are not square within 15 %
  corner     — content under the row's expand affordance (top-right 32 px)
  contrast   — text whose colour against its EFFECTIVE background is under
               WCAG 4.5:1 (3:1 for text ≥ 18 px) — white on white, grey on
               grey, a hex picked without knowing the theme
  frame      — a border around the post or its first card: a box inside the
               bubble, which the operator does not want (2026-09-18)

It also REPORTS, without judging: frames per second and the worst frame seen
since the app started, sampled by the runtime's own loop. A post that moves
is now the point (step 6.12), and "it moves but stutters" is a defect the
layout rules cannot see.
*/

export interface LayoutProblem {
  readonly code:
    | "overflow"
    | "clipped"
    | "tiny-text"
    | "small-hit"
    | "ragged-grid"
    | "not-square"
    | "corner"
    | "contrast"
    | "frame"
    | "collapsed"
    | "overlap"
    | "squeezed";
  readonly message: string;
}

export interface LayoutReport {
  readonly box: { readonly width: number; readonly height: number };
  readonly mode: "row" | "expanded";
  readonly problems: readonly LayoutProblem[];
  /** Counts a reviewer wants beside the problems. */
  readonly stats: {
    readonly controls: number;
    readonly minFontPx: number;
    readonly minContrast: number;
    readonly grids: number;
    /** 0 when the app never ran a loop. */
    readonly fps: number;
    /** The longest frame the loop saw, in ms. 0 when there was no loop. */
    readonly worstFrameMs: number;
    /** How many frames the loop has run. */
    readonly frames: number;
  };
}

/**
 * Filled by `useFrame` so the ruler can report what the loop actually got.
 *
 * A GLOBAL rather than an import, and that is not laziness. `measure.ts` is
 * loaded by the bootstrap and `useFrame` lives in the SDK; importing one from
 * the other makes the bundler hoist the shared file into a chunk, and the
 * scheme handler publishes a FIXED list of paths — the chunk 404s and the
 * whole runtime never evaluates (2026-09-19). Two modules that must not share
 * a file share a name on `globalThis` instead.
 */
export interface FrameStats {
  fps: number;
  worstMs: number;
  frames: number;
}

export const FRAME_STATS_KEY = "__spiralFrameStats";

export const frameStats = (): FrameStats => {
  const host = globalThis as unknown as Record<string, FrameStats | undefined>;
  return (host[FRAME_STATS_KEY] ??= { fps: 0, worstMs: 0, frames: 0 });
};

const MIN_FONT_PX = 11;
const MIN_HIT_PX = 40;
const CORNER_PX = 32;

/**
 * Below this, a drawing surface is not a drawing surface.
 *
 * Generous on purpose: the failure being caught is a canvas that collapsed to
 * nothing because its parent had no height to give — a sliver, not a slightly
 * small box. Anything near this number is already unusable.
 */
const MIN_CANVAS_PX = 40;

/** One line at the smallest type the kit allows; less than this is leading. */
const HIDDEN_LINE_PX = 16;

/** How much two controls may share before it counts as one covering the other. */
const OVERLAP_PX = 4;

const isVisible = (el: Element): boolean => {
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

const describe = (el: Element): string => {
  const tag = el.tagName.toLowerCase();
  const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
  const cls = el.classList.length > 0 ? `.${Array.from(el.classList).slice(0, 2).join(".")}` : "";
  return text ? `<${tag}${cls}> "${text}"` : `<${tag}${cls}>`;
};

const round = (n: number): number => Math.round(n * 10) / 10;

/**
 * The nearest ancestor below `root` that cuts off what sticks out sideways:
 * `overflow-x` hidden or clip. A scroller (`auto`, `scroll`) is not one —
 * what it hides can be reached.
 */
const clippingAncestor = (el: Element, root: Element): Element | undefined => {
  for (let at = el.parentElement; at && at !== root; at = at.parentElement) {
    const x = getComputedStyle(at).overflowX;
    if (x === "hidden" || x === "clip") return at;
  }
  return undefined;
};

type RGB = readonly [number, number, number, number];

/** `rgb(…)` / `rgba(…)` / `color(srgb …)` as WebKit's computed style writes it. */
const parseColor = (value: string): RGB | undefined => {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(value);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [parseFloat(m[1]!), parseFloat(m[2]!), parseFloat(m[3]!), a];
  }
  const c = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(value);
  if (c) return [parseFloat(c[1]!) * 255, parseFloat(c[2]!) * 255, parseFloat(c[3]!) * 255, c[4] === undefined ? 1 : parseFloat(c[4])];
  return undefined;
};

const over = (top: RGB, under: RGB): RGB => {
  const a = top[3];
  return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
};

const luminance = ([r, g, b]: RGB): number => {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const contrastRatio = (a: RGB, b: RGB): number => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** The top-level, comma-separated parts of a CSS value: `a(b, c), d` → [`a(b, c)`, `d`]. */
const splitTop = (value: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push(value.slice(from, i).trim());
      from = i + 1;
    }
  }
  const last = value.slice(from).trim();
  if (last.length > 0) out.push(last);
  return out;
};

const COLOR_RE = /rgba?\([^)]*\)|color\(srgb[^)]*\)|transparent/;

interface Stop {
  readonly color: RGB;
  /** 0…1 along the gradient line, or undefined to be spread evenly. */
  at: number | undefined;
}

/** A length along a gradient line of `length` px, as a fraction. */
const fraction = (token: string, length: number): number | undefined => {
  const n = parseFloat(token);
  if (!Number.isFinite(n)) return undefined;
  if (token.endsWith("%")) return n / 100;
  if (token.endsWith("px")) return length > 0 ? n / length : 0;
  return undefined;
};

/** Evenly spread stops without a position, as CSS does. */
const fixStops = (stops: Stop[]): Stop[] => {
  if (stops.length === 0) return stops;
  if (stops[0]!.at === undefined) stops[0]!.at = 0;
  if (stops[stops.length - 1]!.at === undefined) stops[stops.length - 1]!.at = 1;
  let last = stops[0]!.at!;
  for (let i = 1; i < stops.length; i += 1) {
    if (stops[i]!.at === undefined) {
      let j = i;
      while (stops[j]!.at === undefined) j += 1;
      const end = stops[j]!.at!;
      for (let k = i; k < j; k += 1) stops[k]!.at = last + ((end - last) * (k - i + 1)) / (j - i + 1);
    }
    stops[i]!.at = Math.max(stops[i]!.at!, last);
    last = stops[i]!.at!;
  }
  return stops;
};

const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
  a[3] + (b[3] - a[3]) * t,
];

const colorAt = (stops: readonly Stop[], t: number): RGB => {
  if (t <= stops[0]!.at!) return stops[0]!.color;
  for (let i = 1; i < stops.length; i += 1) {
    const a = stops[i - 1]!;
    const b = stops[i]!;
    if (t <= b.at!) return b.at! === a.at! ? b.color : mix(a.color, b.color, (t - a.at!) / (b.at! - a.at!));
  }
  return stops[stops.length - 1]!.color;
};

/** A linear gradient's angle in CSS degrees (0 = to top, 90 = to right). */
const angleOf = (first: string): number | undefined => {
  const deg = /^(-?[\d.]+)deg$/.exec(first.trim());
  if (deg) return parseFloat(deg[1]!);
  const to = /^to\s+(.+)$/.exec(first.trim());
  if (!to) return undefined;
  const words = to[1]!.split(/\s+/);
  const x = words.includes("right") ? 1 : words.includes("left") ? -1 : 0;
  const y = words.includes("bottom") ? 1 : words.includes("top") ? -1 : 0;
  return (Math.atan2(x, -y) * 180) / Math.PI;
};

/**
 * The colour ONE background layer paints at (x, y) of a `w`×`h` box, or
 * undefined for a layer that says nothing about a point (a radial glow, a
 * dot pattern, an image).
 *
 * The average of the stops was measured before (§ 5.58) and it lies about a
 * scene: a sky that is navy at the top and pale at the bottom averaged to a
 * blue that navy text passes on, wherever the text actually sat. So a
 * LINEAR gradient is sampled where the text is. A radial one is decoration
 * — clouds, confetti, stars — except when it is the only picture and fully
 * opaque, when its average stands in as before.
 */
const layerAt = (layer: string, x: number, y: number, w: number, h: number, alone: boolean): RGB | undefined => {
  const kind = /^(repeating-)?(linear|radial|conic)-gradient\((.*)\)$/s.exec(layer.trim());
  if (!kind) return undefined;
  const args = splitTop(kind[3]!);
  const repeating = kind[1] !== undefined;
  if (kind[2] !== "linear") {
    if (!alone) return undefined;
    const colors = args.map((a) => COLOR_RE.exec(a)?.[0]).filter((c): c is string => c !== undefined).map((c) => (c === "transparent" ? [0, 0, 0, 0] as RGB : parseColor(c))).filter((c): c is RGB => c !== undefined);
    if (colors.length === 0 || colors.some((c) => c[3] < 1)) return undefined;
    const sum = colors.reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2], 1] as RGB, [0, 0, 0, 1] as RGB);
    return [sum[0] / colors.length, sum[1] / colors.length, sum[2] / colors.length, 1];
  }
  const angle = args.length > 0 && !COLOR_RE.test(args[0]!) ? angleOf(args[0]!) ?? 180 : 180;
  const stopArgs = args.length > 0 && !COLOR_RE.test(args[0]!) ? args.slice(1) : args;
  const rad = (angle * Math.PI) / 180;
  const length = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
  const stops: Stop[] = [];
  for (const arg of stopArgs) {
    const color = COLOR_RE.exec(arg)?.[0];
    if (color === undefined) continue;
    const rgb: RGB | undefined = color === "transparent" ? [0, 0, 0, 0] : parseColor(color);
    if (rgb === undefined) continue;
    const positions = arg.replace(color, "").trim().split(/\s+/).filter((t) => t.length > 0);
    if (positions.length === 0) stops.push({ color: rgb, at: undefined });
    for (const position of positions) stops.push({ color: rgb, at: fraction(position, length) });
  }
  if (stops.length === 0) return undefined;
  fixStops(stops);
  let t = length > 0 ? ((x - w / 2) * Math.sin(rad) - (y - h / 2) * Math.cos(rad)) / length + 0.5 : 0;
  if (repeating) {
    const first = stops[0]!.at!;
    const period = stops[stops.length - 1]!.at! - first;
    if (period > 0) t = first + ((((t - first) % period) + period) % period);
  }
  return colorAt(stops, t);
};

/**
 * What an element paints at a point of the page: its background colour,
 * with its image layers over it (the first layer on top). Partly
 * transparent when it lets what is behind show.
 */
const paintAt = (node: Element, px: number, py: number): RGB | undefined => {
  const style = getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  let result: RGB | undefined = parseColor(style.backgroundColor);
  if (result && result[3] === 0) result = undefined;
  const image = style.backgroundImage;
  if (image && image !== "none") {
    const layers = splitTop(image);
    const sizes = splitTop(style.backgroundSize || "auto");
    for (let i = layers.length - 1; i >= 0; i -= 1) {
      // A tiled layer (`16px 16px`) repeats: the point within its tile.
      let w = rect.width;
      let h = rect.height;
      const size = (sizes[i] ?? sizes[sizes.length - 1] ?? "auto").split(/\s+/);
      const sw = size[0] !== undefined && size[0].endsWith("px") ? parseFloat(size[0]) : undefined;
      const sh = size[1] !== undefined && size[1].endsWith("px") ? parseFloat(size[1]) : sw;
      let x = px - rect.left;
      let y = py - rect.top;
      if (sw !== undefined && sw > 0) {
        w = sw;
        x = ((x % sw) + sw) % sw;
      }
      if (sh !== undefined && sh > 0) {
        h = sh;
        y = ((y % sh) + sh) % sh;
      }
      const at = layerAt(layers[i]!, x, y, w, h, layers.length === 1 && result === undefined);
      if (at === undefined || at[3] === 0) continue;
      result = result === undefined ? at : over(at, result);
    }
  }
  return result;
};

/**
 * What is actually behind an element at a point: its ancestors' paint
 * composited over the row's own surface. The document is transparent (the
 * row paints the surface natively), so the walk ends at the theme's grey,
 * read from the kit's token on the root — unless a scene or a card has
 * painted the whole thing first.
 */
const backgroundAt = (el: Element, root: HTMLElement, x: number, y: number): RGB => {
  const rowSurface = parseColor(getComputedStyle(root).getPropertyValue("--cpd-color-bg-subtle-secondary").trim() || "") ??
    (matchMedia("(prefers-color-scheme: dark)").matches ? [30, 30, 32, 1] : [240, 240, 243, 1]);
  const layers: RGB[] = [];
  let node: Element | null = el;
  while (node && node !== root.parentElement) {
    const paint = paintAt(node, x, y);
    if (paint) {
      layers.push(paint);
      if (paint[3] >= 1) break;
    }
    node = node.parentElement;
  }
  let result: RGB = rowSurface;
  for (const layer of layers.reverse()) result = over(layer, result);
  return result;
};

/** Where an element's own words are drawn: the rect of its text nodes. */
const textRect = (el: Element): DOMRect | undefined => {
  let box: DOMRect | undefined;
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType !== Node.TEXT_NODE || (n.textContent ?? "").trim().length === 0) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    box = box === undefined ? r : new DOMRect(
      Math.min(box.left, r.left),
      Math.min(box.top, r.top),
      Math.max(box.right, r.right) - Math.min(box.left, r.left),
      Math.max(box.bottom, r.bottom) - Math.min(box.top, r.top),
    );
  }
  return box;
};

/**
 * Measure the document's layout against the box it is in.
 *
 * `root` is the app's mount point (`#root` in a frame, the container in the
 * verifier). The box is the root's own rect — the frame is exactly the box,
 * and in the verifier the container is sized to it.
 */
export const measureLayout = (root: HTMLElement, mode: "row" | "expanded"): LayoutReport => {
  const stats = frameStats();
  const box = root.getBoundingClientRect();
  const problems: LayoutProblem[] = [];
  const width = round(box.width);
  const height = round(box.height);

  // Overflow: the document is taller or wider than its box. In a row that
  // is content the reader cannot reach; in the viewer the box scrolls, so
  // only width counts there.
  const scroller = document.scrollingElement ?? document.documentElement;
  const overflowY = Math.max(root.scrollHeight, scroller.scrollHeight) - box.height;
  const overflowX = Math.max(root.scrollWidth, scroller.scrollWidth) - box.width;
  if (overflowX > 1) {
    problems.push({ code: "overflow", message: `content is ${round(overflowX)} px wider than the box (${width})` });
  }
  if (mode === "row" && overflowY > 1) {
    problems.push({ code: "overflow", message: `content is ${round(overflowY)} px taller than the row (${height}); the row never scrolls` });
  }

  // A DRAWING SURFACE THAT ISN'T ONE.
  //
  // Queried before the visibility filter, and that is the whole point: a
  // canvas whose parent had no height to give computes to zero, `isVisible`
  // calls it invisible, and every other check here skips it. So the app the
  // ruler was happiest about was the one with nothing to draw on — reported
  // `ok` on a full screen whose canvas was a sliver (2026-09-20).
  //
  // A canvas is measured rather than any collapsed element because it is the
  // one that fails silently: an empty <div> looks empty, while an empty
  // canvas looks like an app that simply has not been drawn on yet.
  for (const canvas of Array.from(root.querySelectorAll<HTMLCanvasElement>("canvas"))) {
    const style = getComputedStyle(canvas);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const r = canvas.getBoundingClientRect();
    if (r.width < MIN_CANVAS_PX || r.height < MIN_CANVAS_PX) {
      problems.push({
        code: "collapsed",
        message:
          `${describe(canvas)} is ${round(r.width)}×${round(r.height)} px in a ${width}×${height} box; ` +
          "a canvas only has the height its parent gives it — put it in <Fill> or set one",
      });
    }
  }

  // A FILL THAT CANNOT HOLD WHAT IS IN IT.
  //
  // The sibling of the check above: a `<Fill>` absorbs every shortfall in a
  // layout, and a `<Card>` hides its overflow — so content too tall for its
  // fill simply disappears, and nothing further down reports it, because
  // the document itself never overflows. A birthday card's greeting was
  // 125 px of text in a 48 px fill and the ruler called the post `ok`.
  //
  // In the viewer a `<Fill scroll>` is MEANT to hold more than it shows;
  // that is what the scroll is for. In a row nothing scrolls, so the same
  // shape is the reader losing the text.
  for (const fill of Array.from(root.querySelectorAll<HTMLElement>(".s-fill"))) {
    if (mode === "expanded" && fill.classList.contains("s-scroll")) continue;
    // A LINE OF TEXT is the threshold. Below it the difference is leading
    // and rounding — a checklist hiding eleven pixels is hiding nothing a
    // reader would name — and a check that fires on those teaches people to
    // ignore it.
    const hidden = fill.scrollHeight - fill.clientHeight;
    if (hidden > HIDDEN_LINE_PX) {
      // A `<Fill>` does not clip, so the overflow is not always HIDDEN: a
      // note grid 43 px too tall for its fill was drawn in full, with the
      // Play and Clear buttons lying across its bottom row (probe, lab,
      // 2026-09-21). Saying "hidden" there sent the reader looking for
      // missing content that was in plain sight, under a button.
      const clipped = getComputedStyle(fill).overflow !== "visible";
      problems.push({
        code: "collapsed",
        message:
          `${describe(fill)} holds ${round(fill.scrollHeight)} px of content in ${round(fill.clientHeight)} px; ` +
          (clipped ? "the rest is hidden" : "the rest spills over what comes after it") +
          " — give it room or move some of it to <Only in=\"expanded\">",
      });
    }
  }

  const all = Array.from(root.querySelectorAll<HTMLElement>("*")).filter(isVisible);

  // Controls: size and clipping.
  // A CONTROL IS WHAT THE AUTHOR SAYS IS TAPPABLE, not what tag it wears.
  //
  // React attaches its listeners at the root, so `onClick` leaves no mark in
  // the DOM — but an inline `cursor: pointer` does, and it is exactly what a
  // hand-rolled control writes. Both palettes in the corpus are a `<div>`
  // with a pointer cursor at 38 px, under the 40 the kit guarantees.
  // Refusing `role="button"` at the validator was tried for one afternoon
  // and made it WORSE: the model dropped the attribute, kept the 38 px, and
  // the thing became invisible to every gate we had (2026-09-21).
  // SVG shapes are excluded: a colouring picture makes its sky and its tree
  // trunk tappable, and an 11-px trunk is the drawing, not a control anyone
  // aims at from a row of them.
  const handRolled = (el: HTMLElement): boolean =>
    el.style.cursor === "pointer" && !(el instanceof SVGElement);
  const controls = all.filter(
    (el) => el.matches("button, input, select, textarea, [role=button]") || handRolled(el),
  );
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    if (r.width < MIN_HIT_PX || r.height < MIN_HIT_PX) {
      // A link-styled reset under a card is a legitimate small control;
      // flag only when it is the kind of thing a finger must land on.
      //
      // `[role=button]` BELONGS in that list and was missing from it, which
      // made the whole class of hand-rolled control invisible: the three
      // drawing posts in the corpus each build their own palette out of
      // `<div role="button">` at 38 × 38 — under the 40 the kit guarantees,
      // and the reason `<Swatch>` was written — and the ruler called all
      // three clean (2026-09-21). The exclusion reads as an oversight: the
      // allow-list names form controls, and the collection above had already
      // decided that a role is what makes something a control.
      if (el.matches("button:not(.s-list__more), input, select, textarea, [role=button]") || handRolled(el)) {
        problems.push({ code: "small-hit", message: `${describe(el)} is ${round(r.width)}×${round(r.height)} px; controls need ${MIN_HIT_PX}` });
      }
    }
    if (mode === "row" && (r.right > box.right + 1 || r.bottom > box.bottom + 1 || r.left < box.left - 1 || r.top < box.top - 1)) {
      problems.push({ code: "clipped", message: `${describe(el)} is partly outside the row` });
    } else {
      // CUT AT THE SIDE BY A CARD. A `<Card>` hides its overflow, so a row
      // too wide for it loses its last control past the card's edge while
      // the control stays inside the box — and neither the box test above
      // nor the document's scroll width (a hidden overflow does not add to
      // it) sees anything. «Alice Example» put a scoreboard's «+1» there
      // on the phone and every ruler called it clean (2026-09-22).
      // Sideways only: a Fill that hides what is below is `collapsed`.
      const cutter = clippingAncestor(el, root);
      if (cutter) {
        const c = cutter.getBoundingClientRect();
        if (r.right > c.right + 1 || r.left < c.left - 1) {
          problems.push({
            code: "clipped",
            message: `${describe(el)} is cut off at the side by ${describe(cutter).split(" ")[0]} — something in its line is too wide for it`,
          });
        }
      }
    }
  }

  // ONE CONTROL ON TOP OF ANOTHER.
  //
  // Two things a finger is meant to hit cannot share the same pixels: one of
  // them is unreachable, and which one is a matter of paint order the reader
  // cannot see. Only controls are compared, and only when neither contains
  // the other — a button inside a card overlaps its card by design, and a
  // palette drawn across a Clear button does not.
  for (let i = 0; i < controls.length; i += 1) {
    for (let j = i + 1; j < controls.length; j += 1) {
      const a = controls[i]!;
      const b = controls[j]!;
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const shareX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const shareY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (shareX > OVERLAP_PX && shareY > OVERLAP_PX) {
        problems.push({
          code: "overlap",
          message: `${describe(a)} and ${describe(b)} share ${round(shareX)}×${round(shareY)} px; one covers the other`,
        });
      }
    }
  }

  // SQUEEZED BELOW ITS WORDS. A text whose words spill sideways out of its
  // own box: a flex sibling took the line and left it less than its longest
  // word (§ 5.58). Read from EVERY element, not the visible ones — a text
  // crushed to zero width is exactly what `isVisible` drops, which is how
  // «Привітань: 0» fell into a column at the left of a centred card and the
  // ruler called it clean. Only where the spill shows (an ellipsis clips on
  // purpose), and by more than a rounding error.
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    const words = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 0);
    if (!words) continue;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.display === "contents") continue;
    if (style.overflowX !== "visible") continue;
    if (el.closest(".s-avatar")) continue;
    if (el.scrollWidth > el.clientWidth + 2) {
      problems.push({
        code: "squeezed",
        message:
          el.clientWidth === 0
            ? `${describe(el)} has no width at all for ${round(el.scrollWidth)} px of words — something beside it took the line`
            : `${describe(el)} is ${round(el.clientWidth)} px wide for ${round(el.scrollWidth)} px of words — something beside it took the line`,
      });
    }
  }

  // Text: the smallest visible font, and every run's contrast against what
  // is actually behind it.
  let minFont = Number.POSITIVE_INFINITY;
  let minContrast = Number.POSITIVE_INFINITY;
  const seenContrast = new Set<string>();
  for (const el of all) {
    const ownText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 0);
    if (!ownText) continue;
    // An avatar's initial is a glyph, not text to read.
    if (el.closest(".s-avatar")) continue;
    const style = getComputedStyle(el);
    // In an SVG the font size is in the drawing's own units, and a viewBox
    // scales the drawing: a wheel's names set at 6 in a 100-unit box are 13 px
    // on a 220-px wheel. What a reader sees is the size times the scale the
    // drawing is shown at.
    const ctm = el instanceof SVGGraphicsElement ? el.getScreenCTM() : null;
    const scale = ctm ? Math.hypot(ctm.a, ctm.b) : 1;
    const px = parseFloat(style.fontSize) * (scale > 0 ? scale : 1);
    if (!Number.isFinite(px)) continue;
    minFont = Math.min(minFont, px);
    if (px < MIN_FONT_PX) {
      problems.push({ code: "tiny-text", message: `${describe(el)} is ${round(px)} px; text needs ${MIN_FONT_PX}` });
    }

    const fg = parseColor(style.color);
    if (!fg) continue;
    // Behind the words, where they are: the centre and the four middles of
    // the text's own rect, and the worst of them — a title half over a
    // stripe is as readable as its worst half.
    const r = textRect(el) ?? el.getBoundingClientRect();
    const points: readonly (readonly [number, number])[] = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + 2, r.top + r.height / 2],
      [r.right - 2, r.top + r.height / 2],
      [r.left + r.width / 2, r.top + 2],
      [r.left + r.width / 2, r.bottom - 2],
    ];
    const behind = points.map(([x, y]) => backgroundAt(el, root, x, y));
    // AN OUTLINE IS WHAT MAKES A GLYPH LEGIBLE.
    //
    // A board alternates a light square and a dark one, so no single fill
    // reads on both, and the answer is an outline: a white knight with a
    // near-black stroke is perfectly clear on either. Judging only the fill
    // called that 1.3:1 and refused a piece a player can see plainly — a
    // false verdict is worse than a missing one, because it teaches people
    // to argue with the ruler. What is measured is therefore the BETTER of
    // the fill and the stroke, since the stroke is the edge that separates
    // the shape from what is behind it.
    const strokeWidth = parseFloat(style.webkitTextStrokeWidth || "0");
    const strokeColour = strokeWidth >= 0.5 ? parseColor(style.webkitTextStrokeColor) : undefined;
    let ratio = Number.POSITIVE_INFINITY;
    let bg = behind[0]!;
    for (const at of behind) {
      const here = Math.max(contrastRatio(over(fg, at), at), strokeColour ? contrastRatio(over(strokeColour, at), at) : 0);
      if (here < ratio) {
        ratio = here;
        bg = at;
      }
    }
    minContrast = Math.min(minContrast, ratio);
    // A control's label is bold and ≥ 15 px in the kit, and the platform's
    // own primary button (white on its blue) sits at 3.6:1 — the bar a
    // button clears is WCAG's large-text 3:1, not the body's 4.5.
    const large = px >= 18 || (px >= 14 && parseInt(style.fontWeight, 10) >= 600) || el.closest("button") !== null;
    const need = large ? 3 : 4.5;
    if (ratio < need) {
      // Emoji-only runs have no colour to speak of.
      const text = (el.textContent ?? "").trim();
      if (/^[\p{Extended_Pictographic}\s\d.,:%+\-–—]+$/u.test(text)) continue;
      const key = `${style.color}|${bg.map(Math.round).join(",")}`;
      if (seenContrast.has(key)) continue;
      seenContrast.add(key);
      problems.push({ code: "contrast", message: `${describe(el)} is ${round(ratio)}:1 (${style.color} on rgb(${bg.slice(0, 3).map(Math.round).join(" ")})); needs ${need}:1` });
    }
  }

  // Frames: a border on the root's first level — a box drawn inside the
  // bubble. A hairline between list rows or around an input is fine.
  for (const el of [root, ...Array.from(root.children), ...Array.from(root.querySelector(".s-stack")?.children ?? [])]) {
    const style = getComputedStyle(el);
    const w = parseFloat(style.borderTopWidth) || 0;
    if (w >= 1 && style.borderTopStyle !== "none" && el.matches(".s-root, .s-stack, .s-card, .s-fill, div:not(.s-list *)")) {
      const color = parseColor(style.borderTopColor);
      if (color && color[3] > 0.2) {
        problems.push({ code: "frame", message: `${describe(el)} has a ${round(w)} px border — a frame inside the bubble; use a Card tone instead` });
      }
    }
  }

  // Grids: every cell the same size; square when asked to be.
  const grids = all.filter((el) => getComputedStyle(el).display === "grid");
  for (const grid of grids) {
    const cells = Array.from(grid.children).filter(isVisible).map((c) => c.getBoundingClientRect());
    if (cells.length < 4) continue;
    const ws = cells.map((c) => c.width);
    const hs = cells.map((c) => c.height);
    const spreadW = Math.max(...ws) - Math.min(...ws);
    const spreadH = Math.max(...hs) - Math.min(...hs);
    if (spreadW > 2 || spreadH > 2) {
      problems.push({
        code: "ragged-grid",
        message: `${describe(grid)} has ${cells.length} cells from ${round(Math.min(...ws))}×${round(Math.min(...hs))} to ${round(Math.max(...ws))}×${round(Math.max(...hs))} px; give it gridTemplateRows: repeat(n, 1fr) or use <Board>`,
      });
      continue;
    }
    const style = getComputedStyle(grid);
    const wantsSquare = /^1\s*(\/\s*1)?$/.test(style.aspectRatio.trim()) || grid.classList.contains("s-board");
    if (wantsSquare) {
      const w = ws[0]!;
      const h = hs[0]!;
      if (Math.abs(w - h) / Math.max(w, h) > 0.15) {
        problems.push({ code: "not-square", message: `${describe(grid)} cells are ${round(w)}×${round(h)} px, not square` });
      }
    }
  }

  // The row's expand affordance sits over the top-right corner; text under
  // it is text the reader cannot read ("0 з 12 зібр…", 2026-09-17).
  if (mode === "row") {
    for (const el of all) {
      // The DRAWN text, not the element: a padded title's box reaches the
      // edge while its glyphs stop well before it.
      const texts = Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim().length > 0);
      // A text that clips itself (an ellipsis) is drawn only inside its
      // box; a range reports the glyphs it cut off as well, and a title
      // ending «Олександ…» well before the corner was said to sit under it.
      const cs = getComputedStyle(el);
      const clips = cs.overflowX !== "visible";
      // And inside its CONTENT box: the ellipsis ends the line where the
      // padding begins. A title padded clear of the corner, cut «Ход:
      // красные · место сво…» 34 px short of it, was said to sit under the
      // button because its padding did (four-in-row, 2026-09-30).
      const own = el.getBoundingClientRect();
      const inner = own.right - (parseFloat(cs.paddingRight) || 0) - (parseFloat(cs.borderRightWidth) || 0);
      for (const node of texts) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const drawn = range.getBoundingClientRect();
        const r = clips ? { width: drawn.width, right: Math.min(drawn.right, inner), top: drawn.top } : drawn;
        if (r.width > 0 && r.right > box.right - CORNER_PX && r.top < box.top + CORNER_PX) {
          problems.push({ code: "corner", message: `${describe(el)} sits under the expand button (top-right ${CORNER_PX} px)` });
          break;
        }
      }
    }
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      if (r.right > box.right - CORNER_PX && r.top < box.top + CORNER_PX) {
        problems.push({ code: "corner", message: `${describe(el)} sits under the expand button (top-right ${CORNER_PX} px)` });
      }
    }
  }

  return {
    box: { width, height },
    mode,
    problems,
    stats: {
      controls: controls.length,
      minFontPx: Number.isFinite(minFont) ? round(minFont) : 0,
      minContrast: Number.isFinite(minContrast) ? round(minContrast) : 0,
      grids: grids.length,
      fps: stats.fps,
      worstFrameMs: round(stats.worstMs),
      frames: stats.frames,
    },
  };
};

/** One line per report, for a log. */
export const formatReport = (report: LayoutReport): string => {
  const motion = report.stats.frames > 0 || report.stats.fps > 0
    ? ` · ${report.stats.fps} fps (worst frame ${report.stats.worstFrameMs} ms)`
    : "";
  const head = `layout ${report.mode} ${report.box.width}×${report.box.height}: ${report.problems.length === 0 ? "ok" : `${report.problems.length} problem(s)`} · ${report.stats.controls} controls · min font ${report.stats.minFontPx} px · min contrast ${report.stats.minContrast}:1 · ${report.stats.grids} grids${motion}`;
  return [head, ...report.problems.map((p) => `  [${p.code}] ${p.message}`)].join("\n");
};
