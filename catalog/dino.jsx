import { useEffect, useRef, useState } from "react";
import { Spiral, useFrame, useSound, useHaptic, useLeaderboard } from "@spiral/sdk";
import { fitCanvas } from "@spiral/play";
import { Scene, Stack, Fill, Row, Text, Only, Leaderboard } from "@spiral/ui";

// The post's own words, in the language of whoever is looking at it.
const WORDS = {
  uk: { title: "Динозаврик", none: "рекорду ще немає", ready: "Торкніться — стрибок", over: (s) => `Бам! · ${s}`, again: "Торкніться — ще раз", best: (b) => `ваш рекорд ${b}` },
  ru: { title: "Динозаврик", none: "рекорда ещё нет", ready: "Коснитесь — прыжок", over: (s) => `Бам! · ${s}`, again: "Коснитесь — ещё раз", best: (b) => `ваш рекорд ${b}` },
  en: { title: "Dino run", none: "no record yet", ready: "Tap to jump", over: (s) => `Bonk! · ${s}`, again: "Tap to go again", best: (b) => `your best ${b}` },
};
const language = () => Spiral.language ?? String(navigator.language ?? "").slice(0, 2);

// The run is measured in U — the canvas height, but never more than a
// square's worth of the width — so a tall full screen is the same run with
// more sky; the speed is in widths per second, so a cactus takes as long to
// arrive in the row as on the screen.
const GRAVITY = 4.4;
// -1.62 peaked just under a tall cactus's clearance: until ~6 s in there
// was not one 60 Hz frame to jump from, and nearly half of all runs met such
// a cactus there. -1.75 gives 117 ms at the start and more after (simulated
// with this file's own physics, § 5.80).
const JUMP = -1.75;
const START = 0.5;
const MAX = 1.25;

const fresh = () => ({ mode: "ready", y: 0, vy: 0, speed: START, cacti: [], next: 1.2, dist: 0, t: 0, overAt: 0, far: 0, near: 0 });

// A cactus in three sizes: a trunk and one or two arms.
const cactus = (ctx, x, base, h, w) => {
  ctx.fillStyle = "#15803d";
  const r = w * 0.5;
  ctx.beginPath();
  ctx.roundRect(x, base - h, w, h, [r, r, 2, 2]);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(x - w * 0.7, base - h * 0.62, w * 0.55, h * 0.3, r * 0.5);
  ctx.roundRect(x - w * 0.7, base - h * 0.8, w * 0.5, h * 0.3, r * 0.5);
  ctx.roundRect(x + w * 1.15, base - h * 0.72, w * 0.55, h * 0.26, r * 0.5);
  ctx.roundRect(x + w * 1.2, base - h * 0.92, w * 0.5, h * 0.3, r * 0.5);
  ctx.fill();
  ctx.fillStyle = "rgb(255 255 255 / 0.18)";
  ctx.fillRect(x + w * 0.2, base - h + r, w * 0.18, h - r * 1.5);
};

export default function App() {
  const w = WORDS[language()] ?? WORDS.en;
  const board = useLeaderboard();
  const sound = useSound();
  const haptic = useHaptic();
  const canvas = useRef(null);
  const game = useRef(fresh());
  const [score, setScore] = useState(0);
  const [mode, setMode] = useState("ready");
  // The loop stops a moment after a game ends (§ 5.80): a finished game
  // was redrawn at the display's rate for as long as it stayed on screen.
  // `useFrame` keeps its still frame, and the next tap starts it again.
  const [resting, setResting] = useState(false);
  useEffect(() => {
    if (mode !== "over") { setResting(false); return undefined; }
    const t = setTimeout(() => setResting(true), 1500);
    return () => clearTimeout(t);
  }, [mode]);

  useFrame(({ dt }) => {
    const el = canvas.current;
    const ctx = el ? fitCanvas(el) : null;
    if (!ctx) return;
    const { width: W, height: H } = el.getBoundingClientRect();
    const g = game.current;
    const s = dt / 1000;
    const U = Math.min(H, W * 0.85);
    const base = H - U * 0.2;
    const size = 0.17 * U;
    const dx = W * 0.14;
    g.t += s;

    if (g.mode === "play") {
      g.speed = Math.min(MAX, g.speed + 0.018 * s);
      const step = g.speed * W * s;
      g.dist += step;
      g.far = (g.far + step * 0.2) % W;
      g.near = (g.near + step) % 40;
      g.vy += GRAVITY * s;
      g.y = Math.min(0, g.y + g.vy * s);
      if (g.y === 0) g.vy = 0;
      g.next -= s;
      if (g.next <= 0) {
        const kind = Math.random();
        g.cacti.push({ x: W + 20, h: kind < 0.5 ? 0.16 : kind < 0.85 ? 0.22 : 0.28, w: kind < 0.5 ? 0.05 : 0.065 });
        g.next = (0.75 + Math.random() * 0.9) * (START / g.speed + 0.3);
      }
      for (const c of g.cacti) c.x -= step;
      g.cacti = g.cacti.filter((c) => c.x > -60);
      const top = base + g.y * U - size;
      for (const c of g.cacti) {
        const cw = c.w * U, ch = c.h * U;
        if (dx + size * 0.75 > c.x && dx + size * 0.15 < c.x + cw && top + size * 0.85 > base - ch) {
          g.mode = "over";
          g.overAt = g.t;
          setMode("over");
          sound("lose");
          haptic("warning");
        }
      }
      const shown = Math.floor((g.dist / W) * 10);
      if (shown !== score) setScore(shown);
    }

    // Dawn over the desert: the sky, the sun, far mesas, the sand and pebbles.
    const sky = ctx.createLinearGradient(0, 0, 0, base);
    sky.addColorStop(0, "#fb923c");
    sky.addColorStop(1, "#fde68a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, base);
    ctx.fillStyle = "#fef3c7";
    ctx.beginPath();
    ctx.arc(W * 0.78, base - U * 0.62, U * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c2410c";
    for (let k = -1; k < 3; k += 1) {
      const x = k * W * 0.6 - g.far;
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.lineTo(x + W * 0.08, base - U * 0.2);
      ctx.lineTo(x + W * 0.28, base - U * 0.2);
      ctx.lineTo(x + W * 0.36, base);
      ctx.fill();
    }
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(0, base, W, H - base);
    ctx.fillStyle = "#b45309";
    ctx.fillRect(0, base, W, 3);
    ctx.fillStyle = "rgb(120 53 15 / 0.35)";
    for (let x = -g.near; x < W; x += 40) {
      ctx.fillRect(x, base + U * 0.06, 6, 3);
      ctx.fillRect(x + 22, base + U * 0.12, 4, 3);
    }
    for (const c of g.cacti) cactus(ctx, c.x, base, c.h * U, c.w * U);

    // The dinosaur: round body, a tail, spikes, an eye, legs that run.
    const top = base + g.y * U - size;
    const run = g.mode === "play" && g.y === 0 ? Math.floor(g.t * 12) % 2 : 0;
    ctx.fillStyle = "#16a34a";
    ctx.beginPath();
    ctx.moveTo(dx - size * 0.25, top + size * 0.55);
    ctx.lineTo(dx + size * 0.2, top + size * 0.4);
    ctx.lineTo(dx + size * 0.2, top + size * 0.7);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(dx + size * 0.12, top + size * 0.3, size * 0.55, size * 0.5, size * 0.2);
    ctx.roundRect(dx + size * 0.45, top, size * 0.5, size * 0.4, size * 0.16);
    ctx.fill();
    ctx.fillStyle = "#15803d";
    ctx.fillRect(dx + size * (run ? 0.22 : 0.3), top + size * 0.78, size * 0.12, size * 0.22);
    ctx.fillRect(dx + size * (run ? 0.5 : 0.44), top + size * 0.78, size * 0.12, size * 0.22);
    for (let k = 0; k < 3; k += 1) {
      ctx.beginPath();
      ctx.moveTo(dx + size * (0.15 + k * 0.14), top + size * 0.32);
      ctx.lineTo(dx + size * (0.22 + k * 0.14), top + size * 0.2);
      ctx.lineTo(dx + size * (0.29 + k * 0.14), top + size * 0.32);
      ctx.fill();
    }
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(dx + size * 0.75, top + size * 0.14, size * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.arc(dx + size * (g.mode === "over" ? 0.75 : 0.78), top + size * 0.14, size * 0.04, 0, Math.PI * 2);
    ctx.fill();
  }, { running: !resting });

  useEffect(() => {
    if (mode === "over" && score > 0) board.submit(score);
  }, [mode]);

  const tap = () => {
    const g = game.current;
    if (g.mode === "over") {
      if (g.t - g.overAt < 0.6) return;
      Object.assign(g, fresh(), { t: g.t });
      setScore(0);
    }
    if (g.mode === "ready") {
      g.mode = "play";
      setMode("play");
    }
    if (g.y === 0) {
      g.vy = JUMP;
      sound("tap");
      haptic("light");
    }
  };

  const leader = board.leader;
  const mine = board.mine?.best;
  const digits = String(score).padStart(5, "0");
  return (
    <Scene theme="arcade">
      <Stack>
        <Row between>
          <Text variant="title">{w.title}</Text>
          <Text variant="caption">🏆 {leader ? `${leader.name.split(" ")[0]} · ${leader.best}` : w.none}</Text>
        </Row>
        <Fill>
          <div onPointerDown={tap} style={{ position: "relative", height: "100%", borderRadius: 12, overflow: "hidden", touchAction: "none" }}>
            <canvas ref={canvas} style={{ width: "100%", height: "100%", display: "block" }} />
            <div className="s-hud" style={{ position: "absolute", top: 8, right: 10, fontSize: "clamp(16px, 6.5cqmin, 28px)", fontFamily: "ui-monospace, Menlo, monospace", pointerEvents: "none" }}>
              {digits}
            </div>
            {mode !== "play" && (
              <div style={{ position: "absolute", left: 0, right: 0, top: "30%", textAlign: "center", pointerEvents: "none" }}>
                <div className="s-hud" style={{ fontSize: "clamp(15px, 6cqmin, 24px)" }}>{mode === "over" ? w.over(score) : w.ready}</div>
                {mode === "over" && (
                  <div className="s-hud" style={{ fontSize: "clamp(12px, 4.5cqmin, 17px)", marginTop: 4 }}>
                    {mine ? `${w.best(mine)} · ` : ""}{w.again}
                  </div>
                )}
              </div>
            )}
          </div>
        </Fill>
        <Only in="expanded">
          <Leaderboard entries={board.entries} me={Spiral.viewer} max={8} />
        </Only>
      </Stack>
    </Scene>
  );
}
