import { jsx, jsxs } from "react/jsx-runtime";
import { useState, useRef, useEffect } from "react";
import { useViewport } from "@spiral/sdk";
import { Stack, Row, Text, Fill, Square, Button, Meta } from "@spiral/ui";
const SEGMENTS = ["Піца", "Кіно", "Бар", "Настілки", "Караоке", "Похід"];
const COLOURS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#06b6d4"];
const useFrameSize = () => {
  const read = () => ({
    w: window.innerWidth,
    h: window.innerHeight,
    dpr: window.devicePixelRatio,
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches
  });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
};
const useFps = (running) => {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let handle = 0;
    const tick = (t) => {
      frames += 1;
      if (t - last >= 1e3) {
        setFps(Math.round(frames * 1e3 / (t - last)));
        frames = 0;
        last = t;
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [running]);
  return fps;
};
const wheelBackground = () => {
  const step = 360 / SEGMENTS.length;
  const stops = SEGMENTS.map((_, i) => `${COLOURS[i]} ${i * step}deg ${(i + 1) * step}deg`);
  return `conic-gradient(${stops.join(", ")})`;
};
function Motion() {
  const size = useFrameSize();
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [landed, setLanded] = useState(null);
  const [spins, setSpins] = useState(0);
  const [transitionEnds, setTransitionEnds] = useState(0);
  const [spinMs, setSpinMs] = useState(null);
  const startedAt = useRef(0);
  const fps = useFps(true);
  const spin = () => {
    const extra = Math.floor(Math.random() * 360);
    const next = angle + 5 * 360 + extra;
    startedAt.current = performance.now();
    setSpinning(true);
    setLanded(null);
    setAngle(next);
    setSpins((n) => n + 1);
  };
  const onTransitionEnd = () => {
    setSpinning(false);
    setSpinMs(Math.round(performance.now() - startedAt.current));
    setTransitionEnds((n) => n + 1);
    const step = 360 / SEGMENTS.length;
    const under = (360 - angle % 360) % 360 / step;
    setLanded(SEGMENTS[Math.floor(under)] ?? "?");
  };
  const viewport = useViewport();
  return /* @__PURE__ */ jsx("div", { className: "s-root", style: { padding: 10 }, children: /* @__PURE__ */ jsxs(Stack, { children: [
    /* @__PURE__ */ jsxs(Row, { between: true, children: [
      /* @__PURE__ */ jsx(Text, { variant: "title", children: "Motion" }),
      /* @__PURE__ */ jsxs(Text, { variant: "caption", children: [
        viewport.mode,
        " ",
        size.w,
        "×",
        size.h,
        " @",
        size.dpr,
        "x · ",
        fps,
        " fps",
        size.reduced ? " · reduced" : ""
      ] })
    ] }),
    /* @__PURE__ */ jsx(Fill, { children: /* @__PURE__ */ jsxs(Square, { children: [
      /* @__PURE__ */ jsx(
        "div",
        {
          style: {
            position: "absolute",
            top: -2,
            left: "50%",
            marginLeft: -8,
            width: 0,
            height: 0,
            borderLeft: "8px solid transparent",
            borderRight: "8px solid transparent",
            borderTop: "14px solid var(--cpd-color-text-primary, #000)",
            zIndex: 2
          }
        }
      ),
      /* @__PURE__ */ jsx(
        "div",
        {
          onTransitionEnd,
          style: {
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            background: wheelBackground(),
            border: "3px solid var(--cpd-color-border-interactive-primary, #999)",
            transform: `rotate(${angle}deg)`,
            transition: spinning ? "transform 3s cubic-bezier(0.17, 0.67, 0.12, 0.99)" : "none",
            willChange: "transform"
          }
        }
      ),
      /* @__PURE__ */ jsx(
        "div",
        {
          style: {
            position: "absolute",
            top: "50%",
            left: "50%",
            width: 28,
            height: 28,
            marginTop: -14,
            marginLeft: -14,
            borderRadius: "50%",
            border: "4px solid rgba(255,255,255,0.5)",
            borderTopColor: "#fff",
            animation: "motion-hub 1s linear infinite",
            background: "rgba(0,0,0,0.35)"
          }
        }
      ),
      /* @__PURE__ */ jsx("style", { children: `@keyframes motion-hub { to { transform: rotate(360deg); } }` })
    ] }) }),
    /* @__PURE__ */ jsxs(Row, { between: true, children: [
      /* @__PURE__ */ jsx(Button, { onPress: spin, disabled: spinning, children: spinning ? "Крутиться…" : "Крутити" }),
      /* @__PURE__ */ jsx(Text, { variant: "body", children: landed ? `→ ${landed}` : spins ? "…" : "" })
    ] }),
    /* @__PURE__ */ jsxs(Meta, { children: [
      "spins ",
      spins,
      " · ends ",
      transitionEnds,
      spinMs !== null ? ` · last ${spinMs} ms (asked 3000)` : ""
    ] })
  ] }) });
}
export {
  Motion as default
};
