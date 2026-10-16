import { useEffect, useRef, useState } from "react";
import { Spiral, useFrame, useSound, useHaptic, useLeaderboard } from "@spiral/sdk";
import { fitCanvas } from "@spiral/play";
import { Scene, Stack, Fill, Row, Text, Only, Leaderboard } from "@spiral/ui";

// The post's own words, in the language of whoever is looking at it.
const WORDS = {
  uk: { title: "Лісоруб", none: "рекорду ще немає", ready: "Торкніться зліва чи справа", over: (s) => `Бац! · ${s}`, again: "Торкніться — ще раз", best: (b) => `ваш рекорд ${b}` },
  ru: { title: "Лесоруб", none: "рекорда ещё нет", ready: "Коснитесь слева или справа", over: (s) => `Бац! · ${s}`, again: "Коснитесь — ещё раз", best: (b) => `ваш рекорд ${b}` },
  en: { title: "Lumberjack", none: "no record yet", ready: "Tap left or right", over: (s) => `Thwack! · ${s}`, again: "Tap to go again", best: (b) => `your best ${b}` },
};
const language = () => Spiral.language ?? String(navigator.language ?? "").slice(0, 2);

const SEGMENTS = 7;
// A branch on either side or none. Never a branch straight over one on the
// OTHER side: with L under R there is no side left to stand on — chop from
// the right and R drops onto you, move left and you walk into L.
const nextBranch = (prev) => {
  const r = Math.random();
  if (prev !== null) return r < 0.55 ? null : prev;
  return r < 0.3 ? null : r < 0.65 ? "L" : "R";
};
const tree = () => {
  const out = [null, null];
  while (out.length < SEGMENTS) out.push(nextBranch(out[out.length - 1]));
  return out;
};
const fresh = () => ({ mode: "ready", side: "L", branches: tree(), time: 1, score: 0, swing: 0, t: 0, overAt: 0, chips: [] });

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
  const [time, setTime] = useState(1);

  const end = (g) => {
    g.mode = "over";
    g.overAt = g.t;
    setMode("over");
    sound("lose");
    haptic("warning");
  };

  useFrame(({ dt }) => {
    const el = canvas.current;
    const ctx = el ? fitCanvas(el) : null;
    if (!ctx) return;
    const { width: W, height: H } = el.getBoundingClientRect();
    const g = game.current;
    const s = dt / 1000;
    g.t += s;
    g.swing = Math.max(0, g.swing - s * 7);
    if (g.mode === "play") {
      g.time -= s * (0.22 + g.score * 0.003);
      if (Math.round(g.time * 40) !== Math.round(time * 40)) setTime(Math.max(0, g.time));
      if (g.time <= 0) end(g);
    }
    for (const c of g.chips) {
      c.vy += 900 * s;
      c.x += c.vx * s;
      c.y += c.vy * s;
    }
    g.chips = g.chips.filter((c) => c.y < H + 20);

    // A pine forest at dawn behind one tree.
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#1e3a8a");
    sky.addColorStop(1, "#7dd3fc");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#14532d";
    for (let k = 0; k < 9; k += 1) {
      const x = (k / 8) * W, h = H * (0.28 + ((k * 37) % 10) / 60);
      ctx.beginPath();
      ctx.moveTo(x - H * 0.07, H * 0.84);
      ctx.lineTo(x, H * 0.84 - h);
      ctx.lineTo(x + H * 0.07, H * 0.84);
      ctx.fill();
    }
    ctx.fillStyle = "#4d7c0f";
    ctx.fillRect(0, H * 0.84, W, H * 0.16);

    const trunk = Math.min(W * 0.2, H * 0.16);
    const cx = W / 2;
    const seg = (H * 0.84) / SEGMENTS;
    for (let i = 0; i < SEGMENTS; i += 1) {
      const y = H * 0.84 - (i + 1) * seg;
      ctx.fillStyle = i % 2 ? "#92400e" : "#a16207";
      ctx.fillRect(cx - trunk / 2, y, trunk, seg + 1);
      ctx.fillStyle = "rgb(0 0 0 / 0.12)";
      ctx.fillRect(cx - trunk * 0.18, y + seg * 0.2, trunk * 0.08, seg * 0.6);
      const b = g.branches[i];
      if (b) {
        const dir = b === "L" ? -1 : 1;
        const bx = cx + dir * trunk / 2;
        const len = Math.min(W * 0.3, H * 0.26);
        ctx.fillStyle = "#78350f";
        ctx.fillRect(dir < 0 ? bx - len : bx, y + seg * 0.35, len, seg * 0.26);
        ctx.fillStyle = "#16a34a";
        for (const f of [0.55, 0.8, 1]) {
          ctx.beginPath();
          ctx.arc(bx + dir * len * f, y + seg * 0.3, seg * 0.32, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.fillStyle = "#a16207";
    ctx.beginPath();
    ctx.ellipse(cx, H * 0.84, trunk * 0.62, trunk * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();

    // The lumberjack: red flannel, a beard, a hat, and an axe that swings.
    const dir = g.side === "L" ? -1 : 1;
    const px = cx + dir * (trunk / 2 + H * 0.1);
    const py = H * 0.84;
    const u = H * 0.03;
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(-dir, 1);
    ctx.fillStyle = "#1e3a8a";
    ctx.fillRect(-u * 1.1, -u * 2.2, u * 0.9, u * 2.2);
    ctx.fillRect(u * 0.2, -u * 2.2, u * 0.9, u * 2.2);
    ctx.fillStyle = "#dc2626";
    ctx.beginPath();
    ctx.roundRect(-u * 1.4, -u * 5.2, u * 2.8, u * 3.2, u * 0.6);
    ctx.fill();
    ctx.fillStyle = "#7f1d1d";
    ctx.fillRect(-u * 1.4, -u * 4.2, u * 2.8, u * 0.35);
    ctx.fillRect(-u * 1.4, -u * 3.1, u * 2.8, u * 0.35);
    ctx.fillStyle = "#fcd9b6";
    ctx.beginPath();
    ctx.arc(0, -u * 6, u * 1.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#92400e";
    ctx.beginPath();
    ctx.arc(0, -u * 5.5, u * 0.9, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = "#b91c1c";
    ctx.fillRect(-u * 1.2, -u * 7.3, u * 2.4, u * 0.8);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(-u * 0.5, -u * 6.3, u * 0.25, u * 0.3);
    ctx.save();
    ctx.translate(u * 1.2, -u * 4.2);
    ctx.rotate(-1.1 + g.swing * 1.6);
    ctx.fillStyle = "#78350f";
    ctx.fillRect(-u * 0.2, -u * 3.2, u * 0.4, u * 3.4);
    ctx.fillStyle = "#cbd5e1";
    ctx.beginPath();
    ctx.moveTo(u * 0.2, -u * 3.2);
    ctx.lineTo(u * 1.4, -u * 3.6);
    ctx.lineTo(u * 1.4, -u * 2.1);
    ctx.lineTo(u * 0.2, -u * 2.4);
    ctx.fill();
    ctx.restore();
    ctx.restore();

    ctx.fillStyle = "#fcd34d";
    for (const c of g.chips) ctx.fillRect(c.x, c.y, 5, 3);
  }, { running: !resting });

  useEffect(() => {
    if (mode === "over" && game.current.score > 0) board.submit(game.current.score);
  }, [mode]);

  const tap = (e) => {
    const g = game.current;
    if (g.mode === "over") {
      if (g.t - g.overAt < 0.6) return;
      Object.assign(g, fresh(), { t: g.t });
      setScore(0);
      setTime(1);
      setMode("ready");
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const side = e.clientX < r.left + r.width / 2 ? "L" : "R";
    if (g.mode === "ready") {
      g.mode = "play";
      setMode("play");
    }
    g.side = side;
    g.swing = 1;
    if (g.branches[0] === side) return end(g);
    g.branches.shift();
    g.branches.push(nextBranch(g.branches[g.branches.length - 1]));
    g.score += 1;
    g.time = Math.min(1, g.time + 0.07);
    setScore(g.score);
    const x = r.width / 2 + (side === "L" ? -12 : 12);
    for (let k = 0; k < 5; k += 1) g.chips.push({ x, y: r.height * 0.78, vx: (side === "L" ? 1 : -1) * (60 + Math.random() * 120), vy: -150 - Math.random() * 150 });
    sound("tap");
    haptic("light");
    if (g.branches[0] === side) end(g);
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
            <div style={{ position: "absolute", top: 8, left: "20%", right: "20%", height: 8, borderRadius: 4, background: "rgb(0 0 0 / 0.35)", pointerEvents: "none" }}>
              <div style={{ width: `${Math.max(0, time) * 100}%`, height: "100%", borderRadius: 4, background: time > 0.3 ? "#facc15" : "#ef4444" }} />
            </div>
            <div className="s-hud" style={{ position: "absolute", top: 20, left: 0, right: 0, textAlign: "center", fontSize: "clamp(26px, 12cqmin, 52px)", fontFamily: "ui-monospace, Menlo, monospace", pointerEvents: "none" }}>
              {score}
            </div>
            {mode !== "play" && (
              <div style={{ position: "absolute", left: 0, right: 0, top: "42%", textAlign: "center", pointerEvents: "none" }}>
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
