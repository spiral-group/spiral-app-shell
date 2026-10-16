import { useEffect, useRef, useState } from "react";
import { Spiral, useFrame, useSound, useHaptic, useLeaderboard } from "@spiral/sdk";
import { fitCanvas } from "@spiral/play";
import { Scene, Stack, Fill, Row, Text, Only, Leaderboard } from "@spiral/ui";

// The post's own words, in the language of whoever is looking at it.
const WORDS = {
  uk: { title: "Пташка", none: "рекорду ще немає", ready: "Торкніться, щоб летіти", over: (s) => `Кінець · ${s}`, again: "Торкніться — ще раз", best: (b) => `ваш рекорд ${b}` },
  ru: { title: "Птичка", none: "рекорда ещё нет", ready: "Коснитесь, чтобы лететь", over: (s) => `Конец · ${s}`, again: "Коснитесь — ещё раз", best: (b) => `ваш рекорд ${b}` },
  en: { title: "Birdie", none: "no record yet", ready: "Tap to fly", over: (s) => `Game over · ${s}`, again: "Tap to go again", best: (b) => `your best ${b}` },
};
const language = () => Spiral.language ?? String(navigator.language ?? "").slice(0, 2);

// Vertical things in shares of the canvas height; horizontal ones in U, the
// height but never more than the row's own shape allows (§ 5.80) — the full
// screen is tall, and pipes paced by its height reached the bird in 1.7 s
// there against 2.8 s in the chat, on the same leaderboard.
const GRAVITY = 3.1;
const FLAP = -0.92;
const SPEED = 0.36;
const GAP = 0.36;
const PIPE = 0.17;
const SPACING = 0.62;
const R = 0.045;

const fresh = () => ({ mode: "ready", y: 0.45, vy: 0, pipes: [], score: 0, t: 0, overAt: 0, ground: 0 });

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
    const groundY = H * 0.86;
    const U = Math.min(H, W / 1.15);
    g.t += s;

    if (g.mode === "ready") g.y = 0.45 + Math.sin(g.t * 4) * 0.02;
    if (g.mode === "play") {
      g.vy += GRAVITY * s;
      g.y += g.vy * s;
      g.ground = (g.ground + SPEED * U * s) % 24;
      for (const p of g.pipes) p.x -= SPEED * U * s;
      if (g.pipes.length === 0 || g.pipes[g.pipes.length - 1].x < W - SPACING * U) {
        g.pipes.push({ x: W + PIPE * U, gap: 0.2 + Math.random() * (0.86 - GAP - 0.28), scored: false });
      }
      g.pipes = g.pipes.filter((p) => p.x > -PIPE * U);
      const bx = W * 0.28, by = g.y * H, r = R * H;
      for (const p of g.pipes) {
        if (!p.scored && p.x + PIPE * U < bx) {
          p.scored = true;
          g.score += 1;
          setScore(g.score);
          sound("pick");
        }
        const inX = bx + r * 0.8 > p.x && bx - r * 0.8 < p.x + PIPE * U;
        if (inX && (by - r * 0.8 < p.gap * H || by + r * 0.8 > (p.gap + GAP) * H)) g.mode = "over";
      }
      if (by + r > groundY || by - r < 0) g.mode = "over";
      if (g.mode === "over") {
        g.overAt = g.t;
        setMode("over");
        sound("lose");
        haptic("warning");
      }
    }
    if (g.mode === "over" && g.y * H + R * H < groundY) {
      g.vy += GRAVITY * s;
      g.y = Math.min(g.y + g.vy * s, (groundY - R * H) / H);
    }

    // The sky, the clouds drifting slower than the world, the pipes, the ground.
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#38bdf8");
    sky.addColorStop(1, "#bae6fd");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgb(255 255 255 / 0.8)";
    for (const [cx, cy, cw] of [[0.1, 0.18, 0.3], [0.55, 0.1, 0.36], [0.85, 0.3, 0.24]]) {
      const x = ((cx * W - g.t * H * 0.04) % (W + cw * H) + W + cw * H) % (W + cw * H) - cw * H * 0.5;
      ctx.beginPath();
      ctx.ellipse(x, cy * H, cw * H * 0.5, cw * H * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of g.pipes) {
      const top = p.gap * H, bottom = (p.gap + GAP) * H, pw = PIPE * U, cap = pw * 0.22;
      ctx.fillStyle = "#22c55e";
      ctx.fillRect(p.x, 0, pw, top);
      ctx.fillRect(p.x, bottom, pw, groundY - bottom);
      ctx.fillStyle = "#16a34a";
      ctx.fillRect(p.x - pw * 0.08, top - cap, pw * 1.16, cap);
      ctx.fillRect(p.x - pw * 0.08, bottom, pw * 1.16, cap);
      ctx.fillStyle = "rgb(255 255 255 / 0.25)";
      ctx.fillRect(p.x + pw * 0.15, 0, pw * 0.12, top - cap);
      ctx.fillRect(p.x + pw * 0.15, bottom + cap, pw * 0.12, groundY - bottom - cap);
    }
    ctx.fillStyle = "#a3e635";
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.fillStyle = "#65a30d";
    ctx.fillRect(0, groundY, W, 4);
    ctx.fillStyle = "rgb(101 163 13 / 0.45)";
    for (let x = -g.ground; x < W; x += 24) ctx.fillRect(x, groundY + 10, 12, 4);

    // The bird: a body, a wing that beats, an eye, a beak, tilted by speed.
    const bx = W * 0.28, by = g.y * H, r = R * H;
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(Math.max(-0.5, Math.min(1.1, g.vy * 0.9)));
    ctx.lineWidth = Math.max(1.5, r * 0.12);
    ctx.strokeStyle = "#1f2937";
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.15, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fde68a";
    ctx.beginPath();
    ctx.ellipse(-r * 0.35, r * 0.15 + Math.sin(g.t * 22) * r * 0.25, r * 0.55, r * 0.32, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(r * 0.45, -r * 0.3, r * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#1f2937";
    ctx.beginPath();
    ctx.arc(r * 0.55, -r * 0.3, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f97316";
    ctx.beginPath();
    ctx.moveTo(r * 0.95, -r * 0.05);
    ctx.lineTo(r * 1.55, r * 0.15);
    ctx.lineTo(r * 0.95, r * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }, { running: !resting });

  // A finished game goes to the chat's table once; a record beaten pings
  // whoever held it (useLeaderboard).
  useEffect(() => {
    if (mode === "over" && game.current.score > 0) board.submit(game.current.score);
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
    g.vy = FLAP;
    sound("tap");
    haptic("light");
  };

  const leader = board.leader;
  const mine = board.mine?.best;
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
            <div className="s-hud" style={{ position: "absolute", top: 6, left: 0, right: 0, textAlign: "center", fontSize: "clamp(28px, 13cqmin, 56px)", fontFamily: "ui-monospace, Menlo, monospace", pointerEvents: "none" }}>
              {mode === "ready" ? "" : score}
            </div>
            {mode !== "play" && (
              <div style={{ position: "absolute", left: 0, right: 0, bottom: "18%", textAlign: "center", pointerEvents: "none" }}>
                <div className="s-hud" style={{ fontSize: "clamp(15px, 6cqmin, 24px)" }}>{mode === "over" ? w.over(game.current.score) : w.ready}</div>
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
