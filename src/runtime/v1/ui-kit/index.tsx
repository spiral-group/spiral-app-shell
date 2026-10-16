/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007 § 4.4. Ten components, so a generated app looks like
Spiral without being told how.

Arbitrary DOM is still allowed — this is a starting point, not a cage. What it
buys is that the common shapes (a choice with its share of the vote, a check,
a counter) come out consistent, accessible and finger-sized without the model
having to rediscover any of that per app.

Every colour is a Compound semantic token, applied through `kit.css`. Nothing
is inlined as a hex, so a shade Element changes changes here too.

Deliberately NOT here: anything that needs an icon set (a whole font to
ship), anything that navigates, anything that opens a sheet. A post is a
timeline row; a control that takes over the screen is a different feature.
*/

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

/* Where the app is shown. The bootstrap writes the host's `viewport.changed`
   to `html[data-spiral-viewport]` and fires `spiral-viewport`; the kit's CSS
   reads the attribute (`Only`, `Grid`) and this hook is for the one component
   that must COUNT differently (`List`). The SDK's `useViewport` is the same
   mark seen from the app's side; the kit does not import the SDK so that
   `ui.js` stays its own bundle. */
type ViewportMode = "row" | "expanded";

const readMode = (): ViewportMode =>
  document.documentElement.dataset["spiralViewport"] === "expanded" ? "expanded" : "row";

const useViewportMode = (): ViewportMode => {
  const [mode, setMode] = useState<ViewportMode>(readMode);
  useEffect(() => {
    const update = () => setMode(readMode());
    window.addEventListener("spiral-viewport", update);
    return () => window.removeEventListener("spiral-viewport", update);
  }, []);
  return mode;
};

/* The kit's own few words follow the viewer's language, as a post's do
   (§ 5.60): «+1 more» under a Russian scoreboard was the only English on
   it. Read off the handshake like the SDK's `Spiral.language`, and not
   imported from it, for the same reason as above. */
const kitLanguage = (): string => {
  const init = (globalThis as { __spiralInit?: { language?: unknown } }).__spiralInit;
  if (typeof init?.language === "string" && init.language.length > 0) return init.language.toLowerCase();
  const nav = typeof navigator === "undefined" ? "" : (navigator.language ?? "");
  return (nav.split("-")[0] || "en").toLowerCase();
};

/** "+K more", as the list's last line and as what VoiceOver reads. */
const MORE: Record<string, (n: number) => { readonly text: string; readonly label: string }> = {
  uk: (n) => ({ text: `ще ${n}`, label: `ще ${n}` }),
  ru: (n) => ({ text: `ещё ${n}`, label: `ещё ${n}` }),
  en: (n) => ({ text: `+${n} more`, label: `${n} more` }),
};

/*
Props the model writes are props the kit takes (2026-09-22, § 5.57).

The kit's layout components used to accept only their own few props and
drop the rest without a word — and generated code is JSX, never type-checked,
so nothing said so. Measured over 286 generated modules: `<Row gap={8}>` 273
times in 85 of them, `style` on a `<Text>` 198 times in 117, on a `<Row>` 91
times — `textAlign`, `fontWeight`, `minWidth`, all thrown away. An owner
asked for a card's text to be centred; the model wrote `textAlign: "center"`
three times out of three, and nothing moved. So the text and layout
components take `style` and `className` like any React element, and the two
props the model reaches for — `gap`, `align` — mean what it thinks they do.
None of the dropped styles in the corpus was a colour.
*/

/** Where a line sits across its box. */
export type SpiralAlign = "start" | "center" | "end";

const alignClass = (align: SpiralAlign | undefined): string => (align ? ` s-align--${align}` : "");

/** `textAlign` from a style, as an alignment, for a flex box that must follow it. */
const alignOf = (style: CSSProperties | undefined): SpiralAlign | undefined => {
  const a = style?.textAlign;
  if (a === "center") return "center";
  if (a === "right" || a === "end") return "end";
  if (a === "left" || a === "start") return "start";
  return undefined;
};

const extra = (className: string | undefined): string => (className ? ` ${className}` : "");

/** `align` on a row or a column: where the children sit across it. */
const crossAxis = (align: SpiralAlign | "stretch" | undefined): CSSProperties | null => {
  switch (align) {
    case "start":
      return { alignItems: "flex-start" };
    case "center":
      return { alignItems: "safe center" as CSSProperties["alignItems"] };
    case "end":
      return { alignItems: "flex-end" };
    case "stretch":
      return { alignItems: "stretch" };
    default:
      return null;
  }
};

export interface TextProps {
  readonly children: ReactNode;
  /** `body` unless said otherwise. */
  readonly variant?: "title" | "body" | "caption";
  /** How its lines sit: `center` for a greeting, a caption under a picture. */
  readonly align?: SpiralAlign;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export const Text = ({ children, variant = "body", align, className, style }: TextProps): ReactNode => (
  <p className={`s-text s-text--${variant}${alignClass(align)}${extra(className)}`} style={style}>
    {children}
  </p>
);

// `onPress`/`onToggle` are called with NO arguments, never the click event.
// A generated `handle = (id) => apply({ set: { …, value: id } })` handed
// straight to `onPress` would otherwise receive a SyntheticEvent as `id`,
// and the operation would fail at the port with DataCloneError — a tap
// that does nothing, after publishing (harness, 2026-09-17).
export interface ButtonProps {
  readonly children: ReactNode;
  readonly onPress: () => void;
  readonly variant?: "primary" | "secondary";
  readonly disabled?: boolean;
}

export const Button = ({
  children,
  onPress,
  variant = "primary",
  disabled = false,
}: ButtonProps): ReactNode => (
  <button
    type="button"
    className={`s-button s-button--${variant}`}
    onClick={() => onPress()}
    disabled={disabled}
  >
    {children}
  </button>
);

export interface ChoiceProps {
  readonly label: ReactNode;
  readonly onPress: () => void;
  /** Whether this viewer picked it. */
  readonly picked?: boolean;
  /** 0…1. Draws the bar behind the label; omit before results are shown. */
  readonly share?: number;
  /** What to write at the end — usually a count. */
  readonly detail?: string;
  readonly disabled?: boolean;
}

/**
 * One option among several.
 *
 * `aria-pressed` rather than a radio: an option can usually be un-picked, and
 * several may be pickable at once, which a radio group cannot express.
 */
export const Choice = ({
  label,
  onPress,
  picked = false,
  share,
  detail,
  disabled = false,
}: ChoiceProps): ReactNode => (
  <button
    type="button"
    className={`s-choice${picked ? " s-choice--picked" : ""}`}
    onClick={() => onPress()}
    disabled={disabled}
    aria-pressed={picked}
  >
    {share === undefined ? null : (
      <span className="s-choice__fill" style={{ width: `${clamp(share) * 100}%` }} />
    )}
    <span className="s-choice__label">{label}</span>
    {detail === undefined ? null : <span className="s-choice__share">{detail}</span>}
  </button>
);

export interface CheckProps {
  readonly label: ReactNode;
  readonly done: boolean;
  readonly onToggle: () => void;
  readonly disabled?: boolean;
}

export const Check = ({ label, done, onToggle, disabled = false }: CheckProps): ReactNode => (
  <button
    type="button"
    className={`s-check${done ? " s-check--done" : ""}`}
    onClick={() => onToggle()}
    disabled={disabled}
    aria-pressed={done}
  >
    {/* The glyph is decorative — `aria-pressed` already carries the state, and
        announcing "checkmark" after "pressed" is noise. */}
    <span className="s-check__box" aria-hidden="true">
      {done ? "✓" : ""}
    </span>
    <span className="s-check__label">{label}</span>
  </button>
);

export interface CounterProps {
  readonly value: number;
  readonly onChange: (next: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly label?: string;
}

export const Counter = ({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  label,
}: CounterProps): ReactNode => (
  <span className="s-counter" role="group" aria-label={label}>
    <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="−">
      −
    </button>
    <span className="s-counter__value">{value}</span>
    <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="+">
      +
    </button>
  </span>
);

/* Layout (step 6.10). The row is small and fixed; the viewer is big; a post
   is written once. These measure the container, not the phone. */

export interface StackProps {
  readonly children: ReactNode;
  /** Centre children both ways — a hero number, a card. */
  readonly center?: boolean;
  /** Space between children, px. The kit's own when omitted. */
  readonly gap?: number;
  /** Where the children sit across the column; `center` centres their lines too. */
  readonly align?: SpiralAlign | "stretch";
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** A column that fills the box; give one child `<Fill>` to take the rest. */
export const Stack = ({ children, center = false, gap, align, className, style }: StackProps): ReactNode => (
  <div
    className={`s-stack${center ? " s-stack--center" : ""}${align === "center" ? " s-align--center" : ""}${extra(className)}`}
    style={{ ...(gap === undefined ? null : { gap }), ...crossAxis(align), ...style }}
  >
    {children}
  </div>
);

export interface FillProps {
  readonly children: ReactNode;
  /** Let this area scroll in the full-screen viewer (never in a row). */
  readonly scroll?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** What is left of a `Stack` after the fixed rows. Scrolls only when expanded. */
export const Fill = ({ children, scroll = false, className, style }: FillProps): ReactNode => (
  <div className={`s-fill${scroll ? " s-scroll" : ""}${extra(className)}`} style={style}>
    {children}
  </div>
);

export interface GridProps {
  readonly children: ReactNode;
  /** Equal columns; 2 by default. */
  readonly cols?: number;
  /** Columns in the full-screen viewer, when the row's count is too few there. */
  readonly expandedCols?: number;
}

export const Grid = ({ children, cols = 2, expandedCols }: GridProps): ReactNode => (
  <div
    className="s-grid"
    style={{ "--cols": cols, "--cols-expanded": expandedCols ?? cols } as CSSProperties}
  >
    {children}
  </div>
);

export interface BoardProps {
  readonly children: ReactNode;
  /** Columns; 8 for chess, 3 for tic-tac-toe, 4 for memory. */
  readonly cols: number;
  /** Rows; the same as `cols` when omitted. */
  readonly rows?: number;
  readonly style?: CSSProperties;
}

/**
 * A grid of EQUAL cells that fits the box: a chess board, a tic-tac-toe
 * grid, a memory game, a keypad. Every child is one cell, in reading order.
 *
 * Why this exists and `<Grid>` is not enough: a generated chess board was a
 * grid with `aspect-ratio: 1` and a `max-height` but no row template, so
 * WebKit sized the ranks by content — 38 px with a piece, 18 px without —
 * and a tap on "e4" landed on e6 on both phones (2026-09-18). A board has
 * `repeat(n, 1fr)` on BOTH axes, takes what is left of its `Stack` (a title
 * and a row of controls around it always fit), and its cells centre their
 * content and size the glyph to the cell — the model never computes a pixel.
 */
export const Board = ({ children, cols, rows, style }: BoardProps): ReactNode => (
  <div
    className="s-board"
    style={{ "--cols": cols, "--rows": rows ?? cols, ...style } as CSSProperties}
  >
    {children}
  </div>
);

export type SpiralTone =
  | "sunset" | "ocean" | "forest" | "berry" | "gold" | "night"
  | "paper" | "mint" | "sky" | "rose" | "sand";

const VIVID: readonly SpiralTone[] = ["sunset", "ocean", "forest", "berry", "gold", "night"];

export interface CardProps {
  readonly children: ReactNode;
  /** The card's surface. Vivid tones are the same in both themes and write in white; quiet tones follow the theme. */
  readonly tone?: SpiralTone;
  /** Centre everything — a greeting, a result, a big number. */
  readonly center?: boolean;
  /** Take what is left of the Stack. */
  readonly fill?: boolean;
  /** Arrive with a small rise; `pop` for a result; `float` for a loop. */
  readonly motion?: "rise" | "pop" | "float" | "none";
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * A surface of the post's own, inside the row's box.
 *
 * The one place a generated post may have a colour of its own, and the
 * reason it may: the tone decides the text colour, so a card can never
 * be white on white or grey on grey — the failure a model produces when
 * it picks a hex per element without knowing the theme (operator,
 * 2026-09-18). No border: a frame inside the bubble stops the post from
 * reading as part of the conversation.
 */
export const Card = ({
  children,
  tone = "paper",
  center = false,
  fill = false,
  motion = "rise",
  className,
  style,
}: CardProps): ReactNode => (
  <div
    className={`s-card${center ? " s-card--center" : ""}${fill ? " s-card--fill" : ""}${motion !== "none" ? ` s-${motion}` : ""}${className ? ` ${className}` : ""}`}
    data-tone={tone}
    {...(VIVID.includes(tone) ? { "data-tone-vivid": "" } : {})}
    style={style}
  >
    {children}
  </div>
);

/** The eight looks a post can have (§ 5.76). */
export type SceneTheme = "arcade" | "board" | "paper" | "party" | "poster" | "sky" | "field" | "night";

export interface SceneProps {
  readonly children: ReactNode;
  /**
   * The look: a background to the bubble's edge, a face for titles, the text
   * colours measured against that background, and the kit's controls drawn
   * for it. `sky` when nothing else fits.
   */
  readonly theme?: SceneTheme;
  /**
   * The post's own background — any CSS background: a gradient, layers.
   * The theme still sets the fonts and the ink, so keep the picture light
   * for a light theme (paper, poster, sky) and dark for the rest; the ruler
   * measures every line against what is actually behind it.
   */
  readonly bg?: string;
  /** No padding: a canvas or a board that runs to the edge. */
  readonly flush?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * THE POST'S OWN LOOK (§ 5.76). Replaces `<div className="s-root">` as the
 * root: the post paints to the bubble's edge instead of sitting on the row's
 * grey, and every kit component inside takes the scene's ink, face and
 * controls. Text colours are the scene's — measured, not chosen per element —
 * so a post has character without a line anyone cannot read.
 */
export const Scene = ({ children, theme = "sky", bg, flush = false, className, style }: SceneProps): ReactNode => (
  <div
    className={`s-root s-scene s-scene--${theme}${flush ? " s-scene--flush" : ""}${extra(className)}`}
    data-scene={theme}
    style={{ ...(bg !== undefined ? { "--s-bg": bg } : {}), ...style } as CSSProperties}
  >
    {children}
  </div>
);

export interface OnlyProps {
  readonly children: ReactNode;
  /** Which viewport shows these children; the other hides them entirely. */
  readonly in: "row" | "expanded";
}

/**
 * The mini / full split, in CSS. A post is ONE module with two looks: the
 * chat row (mini) shows the gist and the main action; the full-screen viewer
 * shows everything. `<Only in="expanded">` wraps what is only for the viewer,
 * `<Only in="row">` what is only for the row (a "+3 more", a "tap to open").
 *
 * `display: contents` when shown, so the wrapper is invisible to the parent's
 * flex/grid — a `Stack` gap does not double around it — and `display: none`
 * when hidden. The switch is the document attribute alone: no re-render, no
 * remount, the app's state does not notice the viewer opening or closing.
 */
export const Only = ({ children, in: where }: OnlyProps): ReactNode => (
  <div className={`s-only s-only--${where}`}>{children}</div>
);

export interface SquareProps {
  readonly children: ReactNode;
  /** Take most of the box — for a post that IS the square (a board, a wheel alone). */
  readonly large?: boolean;
  readonly style?: CSSProperties;
}

/** A square that fits the box: a wheel, a board, a dice, a card. */
export const Square = ({ children, large = false, style }: SquareProps): ReactNode => (
  <div className={`s-square${large ? " s-square--large" : ""}`} style={style}>
    {children}
  </div>
);

export interface SwatchProps {
  /** Any CSS colour: this is paint, not a theme token. */
  readonly color: string;
  readonly picked?: boolean;
  readonly onPick: () => void;
  /** What a screen reader says. The dot alone says nothing. */
  readonly label?: string;
}

/**
 * One colour to paint with.
 *
 * The DOT is small — a palette of eight has to fit a 322-point row — and the
 * BUTTON around it is not: 40 points, the same floor every other control
 * keeps. Written by hand, this came out as a 24 × 24 button (`draw-colour`,
 * `paint-shared`), which is a target a finger misses and the ruler refuses.
 * Here the two sizes are separate on purpose, and only one of them is small.
 */
export const Swatch = ({ color, picked = false, onPick, label }: SwatchProps): ReactNode => (
  <button
    type="button"
    className={`s-swatch${picked ? " s-swatch--picked" : ""}`}
    style={{ "--s-swatch": color } as CSSProperties}
    onClick={onPick}
    aria-pressed={picked}
    aria-label={label ?? color}
  >
    <span className="s-swatch__dot" />
  </button>
);

/**
 * The colour of the Nth thing, when colour is the information.
 *
 * A chart's series, two players, the categories of a list — cases where the
 * prompt's "never choose a colour" cannot apply, because choosing is the
 * point. Six, measured against what is behind them — the row's grey in both
 * themes, or a scene's own background (§ 5.76) — wrapping after six.
 *
 * They are told apart by HUE, so colour must never be the ONLY cue: give
 * the series a label, the player a name, the slice a shape.
 *
 * A CSS variable, so the same `accent(0)` is right in every scene. A
 * canvas cannot read a variable — it kept its default black without a word,
 * and the paint post drew black whatever swatch was picked (§ 5.74) — so the
 * kit resolves one for the canvas, against the canvas's own place in the
 * page (`installCanvasVariables`).
 */
export const accent = (index: number): string =>
  `var(--s-accent-${(Number.isFinite(index) ? Math.abs(Math.trunc(index)) % 6 : 0) + 1})`;

/**
 * Teach the 2D canvas `var(--name)`: a colour set to one is looked up where
 * the canvas stands — inside a scene, the scene's value — and the canvas
 * gets a colour it can draw. Cached for a quarter of a second per canvas and
 * name, because a game loop sets its colours every frame.
 */
const installCanvasVariables = (): void => {
  const g = globalThis as { CanvasRenderingContext2D?: { prototype: object }; CanvasGradient?: { prototype: { addColorStop: (o: number, c: string) => void } }; __spiralCanvasVars?: boolean };
  if (g.__spiralCanvasVars || g.CanvasRenderingContext2D === undefined || typeof document === "undefined") return;
  g.__spiralCanvasVars = true;
  const cache = new Map<string, { readonly value: string; readonly at: number }>();
  const ids = new WeakMap<object, number>();
  let next = 0;
  const resolve = (value: unknown, where: Element | undefined): unknown => {
    if (typeof value !== "string") return value;
    const m = /^\s*var\(\s*(--[\w-]+)\s*(?:,\s*(.+?))?\s*\)\s*$/.exec(value);
    if (m === null) return value;
    const target = where !== undefined && where.isConnected ? where : document.querySelector(".s-scene") ?? document.documentElement;
    let id = ids.get(target);
    if (id === undefined) {
      id = (next += 1);
      ids.set(target, id);
    }
    const key = `${id}|${m[1]}`;
    const now = performance.now();
    const hit = cache.get(key);
    if (hit !== undefined && now - hit.at < 250) return hit.value;
    const found = getComputedStyle(target).getPropertyValue(m[1]!).trim() || m[2]?.trim() || value;
    cache.set(key, { value: found, at: now });
    return found;
  };
  const proto = g.CanvasRenderingContext2D.prototype;
  for (const prop of ["fillStyle", "strokeStyle", "shadowColor"]) {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (d?.set === undefined) continue;
    const set = d.set;
    Object.defineProperty(proto, prop, {
      ...d,
      set(this: { canvas?: Element }, v: unknown) {
        set.call(this, resolve(v, this.canvas));
      },
    });
  }
  if (g.CanvasGradient !== undefined) {
    const add = g.CanvasGradient.prototype.addColorStop;
    g.CanvasGradient.prototype.addColorStop = function (this: unknown, offset: number, color: string) {
      add.call(this, offset, resolve(color, undefined) as string);
    };
  }
};
installCanvasVariables();

/** A number or word read from across the room; sized to the box. */
export const Hero = ({
  children,
  className,
  style,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
}): ReactNode => (
  <div className={`s-hero${extra(className)}`} style={style}>
    {children}
  </div>
);

export interface RowProps {
  readonly children: ReactNode;
  /** Push the first and last child apart. */
  readonly between?: boolean;
  /** Space between children, px. The kit's 10 when omitted. */
  readonly gap?: number;
  /** Where the children sit up and down the row; centred when omitted. */
  readonly align?: SpiralAlign | "stretch";
  readonly className?: string;
  readonly style?: CSSProperties;
}

export const Row = ({ children, between = false, gap, align, className, style }: RowProps): ReactNode => (
  <div
    className={`s-row${between ? " s-row--between" : ""}${extra(className)}`}
    style={{ ...(gap === undefined ? null : { gap }), ...crossAxis(align), ...style }}
  >
    {children}
  </div>
);

export interface ListProps<T> {
  readonly items: readonly T[];
  readonly children: (item: T, index: number) => ReactNode;
  /** A stable key per item. Index is a bug once items can be reordered. */
  readonly keyOf: (item: T, index: number) => string;
  readonly separated?: boolean;
  /** Show at most this many in the chat row, then "+K more". */
  readonly max?: number;
  /** The same for the full-screen viewer; all of them when omitted. */
  readonly expandedMax?: number;
}

/**
 * A list that fits the row by showing its top and counting the rest, and
 * shows everything in the viewer. The cut is the ONLY thing in the kit
 * decided in JS rather than CSS: a `+K more` needs the number.
 */
export const List = <T,>({
  items,
  children,
  keyOf,
  separated = false,
  max,
  expandedMax,
}: ListProps<T>): ReactNode => {
  const mode = useViewportMode();
  const limit = mode === "expanded" ? expandedMax : max;
  const shown = limit !== undefined && limit < items.length ? items.slice(0, limit) : items;
  const rest = items.length - shown.length;
  const more = (MORE[kitLanguage()] ?? MORE["en"]!)(rest);
  return (
    <ul className={`s-list${separated ? " s-list--separated" : ""}`}>
      {shown.map((item, index) => (
        <li key={keyOf(item, index)}>{children(item, index)}</li>
      ))}
      {rest > 0 ? (
        <li className="s-list__more s-meta" aria-label={more.label}>
          {more.text}
        </li>
      ) : null}
    </ul>
  );
};

export interface ProgressProps {
  /** 0…1. Out-of-range values are clamped rather than drawn past the track. */
  readonly value: number;
  readonly label?: string;
}

export const Progress = ({ value, label }: ProgressProps): ReactNode => {
  const fraction = clamp(value);
  return (
    <div
      className="s-progress"
      role="progressbar"
      aria-valuenow={Math.round(fraction * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="s-progress__fill" style={{ width: `${fraction * 100}%` }} />
    </div>
  );
};

export interface AvatarProps {
  /** Used for the initial, and as the accessible name. */
  readonly name: string;
  /**
   * Only an `https:` or `data:` URL renders. The host hands a member's
   * avatar over as a `data:` thumbnail (§ 5.64); an `mxc:` URI cannot be
   * fetched from a frame with no network, so it falls back to the initial
   * rather than to a broken image.
   */
  readonly src?: string;
  /**
   * The member's Matrix id. It picks the placeholder's colour exactly as
   * the messenger does for the same person, so a post's «A» is the same
   * green «A» as the room list's (§ 5.64). Without it, the name picks.
   */
  readonly userId?: string;
  readonly size?: number;
}

/**
 * Compound's `decorativeColor(for:)`: the sum of the id's code points, mod
 * six, one-based. The messenger and the post must agree on this or one
 * person is two colours.
 */
export const decorativeIndex = (id: string): number => {
  let sum = 0;
  for (const ch of id) sum += ch.codePointAt(0) ?? 0;
  return (sum % 6) + 1;
};

export const Avatar = ({ name, src, userId, size = 28 }: AvatarProps): ReactNode => {
  const usable = src !== undefined && /^(https|data):/.test(src);
  const n = decorativeIndex(userId ?? name);
  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.5625),
    ...(usable ? {} : { background: `var(--cpd-color-bg-decorative-${n})`, color: `var(--cpd-color-text-decorative-${n})` }),
  };

  return (
    <span className="s-avatar" style={style} title={name}>
      {usable ? <img src={src} alt={name} /> : <span aria-hidden="true">{initial(name)}</span>}
    </span>
  );
};

export interface LeaderboardEntry {
  readonly userId: string;
  readonly name: string;
  readonly best: number;
  readonly avatarUrl?: string;
}

export interface LeaderboardProps {
  /** Best first — what `useLeaderboard().entries` gives. */
  readonly entries: readonly LeaderboardEntry[];
  /** The viewer, whose row is marked. */
  readonly me?: string;
  /** Rows in the chat row; the full view shows up to `expandedMax`. */
  readonly max?: number;
  readonly expandedMax?: number;
  /** How a score reads: «42», «12.3 s». */
  readonly format?: (score: number) => string;
}

const MEDALS = ["🥇", "🥈", "🥉"] as const;

/**
 * A chat's table of best scores (§ 5.75): medal or place, face, name, score.
 * The viewer's row is marked; three rows in the chat row, the rest behind
 * «+N more» until the post is opened.
 */
export const Leaderboard = ({ entries, me, max = 3, expandedMax = 10, format = String }: LeaderboardProps): ReactNode => (
  <List items={entries} keyOf={(entry) => entry.userId} max={max} expandedMax={expandedMax}>
    {(entry, index) => (
      <div className={`s-leaderboard__row${entry.userId === me ? " s-leaderboard__row--me" : ""}`}>
        <span className="s-leaderboard__place">{MEDALS[index] ?? index + 1}</span>
        <Avatar name={entry.name} userId={entry.userId} {...(entry.avatarUrl !== undefined ? { src: entry.avatarUrl } : {})} size={24} />
        <span className="s-leaderboard__name">{entry.name}</span>
        <span className="s-leaderboard__score">{format(entry.best)}</span>
      </div>
    )}
  </List>
);

export interface MetaProps {
  readonly children: ReactNode;
  readonly align?: SpiralAlign;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export interface InputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  /** `text` by default. `number` and `password` bring up the matching keyboard. */
  readonly kind?: "text" | "number" | "password";
  readonly label?: string;
  readonly disabled?: boolean;
}

/**
 * One line of typed input: an answer, an amount, a name, a password.
 *
 * The kit turns text selection off everywhere (`.s-root`), because a post is a
 * control surface — but a field IS the one place text is meant to be touched,
 * so it turns selection back on for itself. Without that the caret never
 * appears and the keyboard never comes up, and the field reads as broken.
 */
export const Input = ({
  value,
  onChange,
  placeholder,
  kind = "text",
  label,
  disabled = false,
}: InputProps): ReactNode => (
  <label className="s-input">
    {label !== undefined && <span className="s-input__label">{label}</span>}
    <input
      className="s-input__field"
      type={kind}
      inputMode={kind === "number" ? "decimal" : undefined}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  </label>
);

/** The quiet line under everything: counts, who is left, when it closes. */
/**
 * A quiet line under the post. A flex row (an avatar may lead it), so its
 * text sits at the start whatever `textAlign` says — the alignment is
 * carried to the row as well, or «centre the text» moves nothing.
 */
export const Meta = ({ children, align, className, style }: MetaProps): ReactNode => (
  <div className={`s-meta${alignClass(align ?? alignOf(style))}${extra(className)}`} style={style}>
    {children}
  </div>
);

// MARK: - Helpers

const clamp = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/**
 * First character of a display name.
 *
 * By code point, not by UTF-16 unit: a name starting with an emoji or an
 * astral-plane character would otherwise render as half a glyph.
 */
const initial = (name: string): string => {
  const trimmed = name.replace(/^@/, "").trim();
  return [...trimmed][0]?.toUpperCase() ?? "?";
};
