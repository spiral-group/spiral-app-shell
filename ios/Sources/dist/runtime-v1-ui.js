import { jsx, jsxs } from "/runtime/v1/react.js";
import { useState, useEffect } from "/runtime/v1/react.js";
const readMode = () => document.documentElement.dataset["spiralViewport"] === "expanded" ? "expanded" : "row";
const useViewportMode = () => {
  const [mode, setMode] = useState(readMode);
  useEffect(() => {
    const update = () => setMode(readMode());
    window.addEventListener("spiral-viewport", update);
    return () => window.removeEventListener("spiral-viewport", update);
  }, []);
  return mode;
};
const kitLanguage = () => {
  const init = globalThis.__spiralInit;
  if (typeof init?.language === "string" && init.language.length > 0) return init.language.toLowerCase();
  const nav = typeof navigator === "undefined" ? "" : navigator.language ?? "";
  return (nav.split("-")[0] || "en").toLowerCase();
};
const MORE = {
  uk: (n) => ({ text: `ще ${n}`, label: `ще ${n}` }),
  ru: (n) => ({ text: `ещё ${n}`, label: `ещё ${n}` }),
  en: (n) => ({ text: `+${n} more`, label: `${n} more` })
};
const alignClass = (align) => align ? ` s-align--${align}` : "";
const alignOf = (style) => {
  const a = style?.textAlign;
  if (a === "center") return "center";
  if (a === "right" || a === "end") return "end";
  if (a === "left" || a === "start") return "start";
  return void 0;
};
const extra = (className) => className ? ` ${className}` : "";
const crossAxis = (align) => {
  switch (align) {
    case "start":
      return { alignItems: "flex-start" };
    case "center":
      return { alignItems: "safe center" };
    case "end":
      return { alignItems: "flex-end" };
    case "stretch":
      return { alignItems: "stretch" };
    default:
      return null;
  }
};
const Text = ({ children, variant = "body", align, className, style }) => /* @__PURE__ */ jsx("p", { className: `s-text s-text--${variant}${alignClass(align)}${extra(className)}`, style, children });
const Button = ({
  children,
  onPress,
  variant = "primary",
  disabled = false
}) => /* @__PURE__ */ jsx(
  "button",
  {
    type: "button",
    className: `s-button s-button--${variant}`,
    onClick: () => onPress(),
    disabled,
    children
  }
);
const Choice = ({
  label,
  onPress,
  picked = false,
  share,
  detail,
  disabled = false
}) => /* @__PURE__ */ jsxs(
  "button",
  {
    type: "button",
    className: `s-choice${picked ? " s-choice--picked" : ""}`,
    onClick: () => onPress(),
    disabled,
    "aria-pressed": picked,
    children: [
      share === void 0 ? null : /* @__PURE__ */ jsx("span", { className: "s-choice__fill", style: { width: `${clamp(share) * 100}%` } }),
      /* @__PURE__ */ jsx("span", { className: "s-choice__label", children: label }),
      detail === void 0 ? null : /* @__PURE__ */ jsx("span", { className: "s-choice__share", children: detail })
    ]
  }
);
const Check = ({ label, done, onToggle, disabled = false }) => /* @__PURE__ */ jsxs(
  "button",
  {
    type: "button",
    className: `s-check${done ? " s-check--done" : ""}`,
    onClick: () => onToggle(),
    disabled,
    "aria-pressed": done,
    children: [
      /* @__PURE__ */ jsx("span", { className: "s-check__box", "aria-hidden": "true", children: done ? "✓" : "" }),
      /* @__PURE__ */ jsx("span", { className: "s-check__label", children: label })
    ]
  }
);
const Counter = ({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  label
}) => /* @__PURE__ */ jsxs("span", { className: "s-counter", role: "group", "aria-label": label, children: [
  /* @__PURE__ */ jsx("button", { type: "button", onClick: () => onChange(value - 1), disabled: value <= min, "aria-label": "−", children: "−" }),
  /* @__PURE__ */ jsx("span", { className: "s-counter__value", children: value }),
  /* @__PURE__ */ jsx("button", { type: "button", onClick: () => onChange(value + 1), disabled: value >= max, "aria-label": "+", children: "+" })
] });
const Stack = ({ children, center = false, gap, align, className, style }) => /* @__PURE__ */ jsx(
  "div",
  {
    className: `s-stack${center ? " s-stack--center" : ""}${align === "center" ? " s-align--center" : ""}${extra(className)}`,
    style: { ...gap === void 0 ? null : { gap }, ...crossAxis(align), ...style },
    children
  }
);
const Fill = ({ children, scroll = false, className, style }) => /* @__PURE__ */ jsx("div", { className: `s-fill${scroll ? " s-scroll" : ""}${extra(className)}`, style, children });
const Grid = ({ children, cols = 2, expandedCols }) => /* @__PURE__ */ jsx(
  "div",
  {
    className: "s-grid",
    style: { "--cols": cols, "--cols-expanded": expandedCols ?? cols },
    children
  }
);
const Board = ({ children, cols, rows, style }) => /* @__PURE__ */ jsx(
  "div",
  {
    className: "s-board",
    style: { "--cols": cols, "--rows": rows ?? cols, ...style },
    children
  }
);
const VIVID = ["sunset", "ocean", "forest", "berry", "gold", "night"];
const Card = ({
  children,
  tone = "paper",
  center = false,
  fill = false,
  motion = "rise",
  className,
  style
}) => /* @__PURE__ */ jsx(
  "div",
  {
    className: `s-card${center ? " s-card--center" : ""}${fill ? " s-card--fill" : ""}${motion !== "none" ? ` s-${motion}` : ""}${className ? ` ${className}` : ""}`,
    "data-tone": tone,
    ...VIVID.includes(tone) ? { "data-tone-vivid": "" } : {},
    style,
    children
  }
);
const Scene = ({ children, theme = "sky", bg, flush = false, className, style }) => /* @__PURE__ */ jsx(
  "div",
  {
    className: `s-root s-scene s-scene--${theme}${flush ? " s-scene--flush" : ""}${extra(className)}`,
    "data-scene": theme,
    style: { ...bg !== void 0 ? { "--s-bg": bg } : {}, ...style },
    children
  }
);
const Only = ({ children, in: where }) => /* @__PURE__ */ jsx("div", { className: `s-only s-only--${where}`, children });
const Square = ({ children, large = false, style }) => /* @__PURE__ */ jsx("div", { className: `s-square${large ? " s-square--large" : ""}`, style, children });
const Swatch = ({ color, picked = false, onPick, label }) => /* @__PURE__ */ jsx(
  "button",
  {
    type: "button",
    className: `s-swatch${picked ? " s-swatch--picked" : ""}`,
    style: { "--s-swatch": color },
    onClick: onPick,
    "aria-pressed": picked,
    "aria-label": label ?? color,
    children: /* @__PURE__ */ jsx("span", { className: "s-swatch__dot" })
  }
);
const accent = (index) => `var(--s-accent-${(Number.isFinite(index) ? Math.abs(Math.trunc(index)) % 6 : 0) + 1})`;
const installCanvasVariables = () => {
  const g = globalThis;
  if (g.__spiralCanvasVars || g.CanvasRenderingContext2D === void 0 || typeof document === "undefined") return;
  g.__spiralCanvasVars = true;
  const cache = /* @__PURE__ */ new Map();
  const ids = /* @__PURE__ */ new WeakMap();
  let next = 0;
  const resolve = (value, where) => {
    if (typeof value !== "string") return value;
    const m = /^\s*var\(\s*(--[\w-]+)\s*(?:,\s*(.+?))?\s*\)\s*$/.exec(value);
    if (m === null) return value;
    const target = where !== void 0 && where.isConnected ? where : document.querySelector(".s-scene") ?? document.documentElement;
    let id = ids.get(target);
    if (id === void 0) {
      id = next += 1;
      ids.set(target, id);
    }
    const key = `${id}|${m[1]}`;
    const now = performance.now();
    const hit = cache.get(key);
    if (hit !== void 0 && now - hit.at < 250) return hit.value;
    const found = getComputedStyle(target).getPropertyValue(m[1]).trim() || m[2]?.trim() || value;
    cache.set(key, { value: found, at: now });
    return found;
  };
  const proto = g.CanvasRenderingContext2D.prototype;
  for (const prop of ["fillStyle", "strokeStyle", "shadowColor"]) {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (d?.set === void 0) continue;
    const set = d.set;
    Object.defineProperty(proto, prop, {
      ...d,
      set(v) {
        set.call(this, resolve(v, this.canvas));
      }
    });
  }
  if (g.CanvasGradient !== void 0) {
    const add = g.CanvasGradient.prototype.addColorStop;
    g.CanvasGradient.prototype.addColorStop = function(offset, color) {
      add.call(this, offset, resolve(color, void 0));
    };
  }
};
installCanvasVariables();
const Hero = ({
  children,
  className,
  style
}) => /* @__PURE__ */ jsx("div", { className: `s-hero${extra(className)}`, style, children });
const Row = ({ children, between = false, gap, align, className, style }) => /* @__PURE__ */ jsx(
  "div",
  {
    className: `s-row${between ? " s-row--between" : ""}${extra(className)}`,
    style: { ...gap === void 0 ? null : { gap }, ...crossAxis(align), ...style },
    children
  }
);
const List = ({
  items,
  children,
  keyOf,
  separated = false,
  max,
  expandedMax
}) => {
  const mode = useViewportMode();
  const limit = mode === "expanded" ? expandedMax : max;
  const shown = limit !== void 0 && limit < items.length ? items.slice(0, limit) : items;
  const rest = items.length - shown.length;
  const more = (MORE[kitLanguage()] ?? MORE["en"])(rest);
  return /* @__PURE__ */ jsxs("ul", { className: `s-list${separated ? " s-list--separated" : ""}`, children: [
    shown.map((item, index) => /* @__PURE__ */ jsx("li", { children: children(item, index) }, keyOf(item, index))),
    rest > 0 ? /* @__PURE__ */ jsx("li", { className: "s-list__more s-meta", "aria-label": more.label, children: more.text }) : null
  ] });
};
const Progress = ({ value, label }) => {
  const fraction = clamp(value);
  return /* @__PURE__ */ jsx(
    "div",
    {
      className: "s-progress",
      role: "progressbar",
      "aria-valuenow": Math.round(fraction * 100),
      "aria-valuemin": 0,
      "aria-valuemax": 100,
      "aria-label": label,
      children: /* @__PURE__ */ jsx("div", { className: "s-progress__fill", style: { width: `${fraction * 100}%` } })
    }
  );
};
const decorativeIndex = (id) => {
  let sum = 0;
  for (const ch of id) sum += ch.codePointAt(0) ?? 0;
  return sum % 6 + 1;
};
const Avatar = ({ name, src, userId, size = 28 }) => {
  const usable = src !== void 0 && /^(https|data):/.test(src);
  const n = decorativeIndex(userId ?? name);
  const style = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.5625),
    ...usable ? {} : { background: `var(--cpd-color-bg-decorative-${n})`, color: `var(--cpd-color-text-decorative-${n})` }
  };
  return /* @__PURE__ */ jsx("span", { className: "s-avatar", style, title: name, children: usable ? /* @__PURE__ */ jsx("img", { src, alt: name }) : /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: initial(name) }) });
};
const MEDALS = ["🥇", "🥈", "🥉"];
const Leaderboard = ({ entries, me, max = 3, expandedMax = 10, format = String }) => /* @__PURE__ */ jsx(List, { items: entries, keyOf: (entry) => entry.userId, max, expandedMax, children: (entry, index) => /* @__PURE__ */ jsxs("div", { className: `s-leaderboard__row${entry.userId === me ? " s-leaderboard__row--me" : ""}`, children: [
  /* @__PURE__ */ jsx("span", { className: "s-leaderboard__place", children: MEDALS[index] ?? index + 1 }),
  /* @__PURE__ */ jsx(Avatar, { name: entry.name, userId: entry.userId, ...entry.avatarUrl !== void 0 ? { src: entry.avatarUrl } : {}, size: 24 }),
  /* @__PURE__ */ jsx("span", { className: "s-leaderboard__name", children: entry.name }),
  /* @__PURE__ */ jsx("span", { className: "s-leaderboard__score", children: format(entry.best) })
] }) });
const Input = ({
  value,
  onChange,
  placeholder,
  kind = "text",
  label,
  disabled = false
}) => /* @__PURE__ */ jsxs("label", { className: "s-input", children: [
  label !== void 0 && /* @__PURE__ */ jsx("span", { className: "s-input__label", children: label }),
  /* @__PURE__ */ jsx(
    "input",
    {
      className: "s-input__field",
      type: kind,
      inputMode: kind === "number" ? "decimal" : void 0,
      value,
      placeholder,
      disabled,
      onChange: (event) => onChange(event.currentTarget.value)
    }
  )
] });
const Meta = ({ children, align, className, style }) => /* @__PURE__ */ jsx("div", { className: `s-meta${alignClass(align ?? alignOf(style))}${extra(className)}`, style, children });
const clamp = (value) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
const initial = (name) => {
  const trimmed = name.replace(/^@/, "").trim();
  return [...trimmed][0]?.toUpperCase() ?? "?";
};
export {
  Avatar,
  Board,
  Button,
  Card,
  Check,
  Choice,
  Counter,
  Fill,
  Grid,
  Hero,
  Input,
  Leaderboard,
  List,
  Meta,
  Only,
  Progress,
  Row,
  Scene,
  Square,
  Stack,
  Swatch,
  Text,
  accent,
  decorativeIndex
};
//# sourceMappingURL=runtime-v1-ui.js.map
