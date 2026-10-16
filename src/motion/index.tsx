/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 step 6.10 — the MOTION AND LAYOUT probe.

A generated wheel (2026-09-17) drew itself in fixed pixels, overflowed the
card, and its spin did not look right. Before touching the prompt, this
first-party artifact asks WebKit the questions directly, in the same frame,
pool and row a generated post gets:

  1. What size IS the frame? (innerWidth × innerHeight, devicePixelRatio,
     the aspect the manifest claimed vs what the row gave)
  2. Does a CSS `transition: transform` spin run smoothly and land where
     it was told? (the wheel's technique — a transform with an easing)
  3. Does a CSS `@keyframes` animation run? (the spinner's technique)
  4. How many frames a second does `requestAnimationFrame` deliver while
     the row is on screen? (the number that says "lags")
  5. Is `prefers-reduced-motion` on? (the kit disables motion for it)

Everything is local — no shared state — so it can be previewed with nothing
behind it and run on the device without an event.
*/

import { useEffect, useRef, useState } from "react";
import { useViewport } from "@spiral/sdk";
import { Button, Fill, Meta, Row, Square, Stack, Text } from "@spiral/ui";

const SEGMENTS = ["Піца", "Кіно", "Бар", "Настілки", "Караоке", "Похід"];
const COLOURS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#06b6d4"];

const useFrameSize = () => {
  const read = () => ({
    w: window.innerWidth,
    h: window.innerHeight,
    dpr: window.devicePixelRatio,
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
};

/** Frames per second over the last second, from rAF. */
const useFps = (running: boolean) => {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    if (!running) return;
    let frames = 0;
    let last = performance.now();
    let handle = 0;
    const tick = (t: number) => {
      frames += 1;
      if (t - last >= 1000) {
        setFps(Math.round((frames * 1000) / (t - last)));
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

export default function Motion() {
  const size = useFrameSize();
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [landed, setLanded] = useState<string | null>(null);
  const [spins, setSpins] = useState(0);
  const [transitionEnds, setTransitionEnds] = useState(0);
  const [spinMs, setSpinMs] = useState<number | null>(null);
  const startedAt = useRef(0);
  const fps = useFps(true);

  // The wheel's technique: one `transform: rotate()` with a long easing.
  // 5 full turns plus a random landing; the pointer is at the top, so the
  // segment under it is read off the final angle.
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
    const under = ((360 - (angle % 360)) % 360) / step;
    setLanded(SEGMENTS[Math.floor(under)] ?? "?");
  };

  const viewport = useViewport();

  // No sizes anywhere: `Stack` is the box, `Square` is the largest square
  // that fits what `Stack` leaves, in both the row and the viewer.
  return (
    <div className="s-root" style={{ padding: 10 }}>
      <Stack>
      <Row between>
        <Text variant="title">Motion</Text>
        <Text variant="caption">
          {viewport.mode} {size.w}×{size.h} @{size.dpr}x · {fps} fps{size.reduced ? " · reduced" : ""}
        </Text>
      </Row>

      <Fill>
      <Square>
        {/* pointer */}
        <div
          style={{
            position: "absolute",
            top: -2,
            left: "50%",
            marginLeft: -8,
            width: 0,
            height: 0,
            borderLeft: "8px solid transparent",
            borderRight: "8px solid transparent",
            borderTop: "14px solid var(--cpd-color-text-primary, #000)",
            zIndex: 2,
          }}
        />
        <div
          onTransitionEnd={onTransitionEnd}
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            background: wheelBackground(),
            border: "3px solid var(--cpd-color-border-interactive-primary, #999)",
            transform: `rotate(${angle}deg)`,
            transition: spinning ? "transform 3s cubic-bezier(0.17, 0.67, 0.12, 0.99)" : "none",
            willChange: "transform",
          }}
        />
        {/* keyframes spinner in the hub */}
        <div
          style={{
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
            background: "rgba(0,0,0,0.35)",
          }}
        />
        <style>{`@keyframes motion-hub { to { transform: rotate(360deg); } }`}</style>
      </Square>
      </Fill>

      <Row between>
        <Button onPress={spin} disabled={spinning}>
          {spinning ? "Крутиться…" : "Крутити"}
        </Button>
        <Text variant="body">{landed ? `→ ${landed}` : spins ? "…" : ""}</Text>
      </Row>
      <Meta>
        spins {spins} · ends {transitionEnds}
        {spinMs !== null ? ` · last ${spinMs} ms (asked 3000)` : ""}
      </Meta>
      </Stack>
    </div>
  );
}
