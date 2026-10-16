import { useRef, useState } from "react";
import { Spiral, useFrame, useSound, useHaptic, useLeaderboard } from "@spiral/sdk";
import { Scene, Stack, Fill, Text, Meta, Only, Leaderboard } from "@spiral/ui";

const ROUND = 5; // a round is five tries; the table keeps the average
const HUMAN = 100; // faster than this is a guess, not a reaction

// The post's own words, in the language of whoever is looking at it.
const WORDS = {
  uk: {
    title: "Хто швидший", none: "рекорду ще немає", unit: "мс",
    start: "Торкніться, щоб почати", how: `${ROUND} спроб · тисніть, щойно стане зелено`,
    wait: "Чекайте…", go: "Тисніть!", early: "Зарано!", retry: "Торкніться — ще раз",
    next: "Торкніться — далі", average: "Середнє", best: (b) => `ваш рекорд ${b}`, again: "Торкніться — ще раунд",
  },
  ru: {
    title: "Кто быстрее", none: "рекорда ещё нет", unit: "мс",
    start: "Коснитесь, чтобы начать", how: `${ROUND} попыток · жмите, как только станет зелёным`,
    wait: "Ждите…", go: "Жмите!", early: "Рано!", retry: "Коснитесь — ещё раз",
    next: "Коснитесь — дальше", average: "Среднее", best: (b) => `ваш рекорд ${b}`, again: "Коснитесь — ещё раунд",
  },
  en: {
    title: "Who's faster", none: "no record yet", unit: "ms",
    start: "Tap to start", how: `${ROUND} tries · tap the moment it turns green`,
    wait: "Wait…", go: "Tap!", early: "Too soon!", retry: "Tap to try again",
    next: "Tap for the next one", average: "Average", best: (b) => `your best ${b}`, again: "Tap for another round",
  },
};
const language = () => Spiral.language ?? String(navigator.language ?? "").slice(0, 2);

// A traffic light on a poster: red while you wait, green to go.
const PANEL = { ready: "#1f2937", wait: "#dc2626", go: "#16a34a", hit: "#1f2937", early: "#9a3412", over: "#1f2937" };

export default function App() {
  const w = WORDS[language()] ?? WORDS.en;
  const ms = (n) => `${n} ${w.unit}`;
  // A time's unit is a word, so the card says it in each reader's language.
  const board = useLeaderboard({ better: "lower", format: (n, l) => `${n} ${(WORDS[l] ?? w).unit}` });
  const sound = useSound();
  const haptic = useHaptic();
  const panel = useRef(null);
  const game = useRef({ mode: "ready", times: [], goAt: 0, start: 0, overAt: 0 });
  const [view, setView] = useState({ mode: "ready", times: [], last: 0 });

  const show = (mode, last = 0) => {
    game.current.mode = mode;
    setView({ mode, times: game.current.times.slice(), last });
  };
  const arm = () => {
    game.current.goAt = performance.now() + 1200 + Math.random() * 2300;
    show("wait");
  };

  // Green is painted from the frame itself, not through a React render, and
  // the clock starts in the same frame — a render's delay is not the player's.
  useFrame(() => {
    const g = game.current;
    if (g.mode !== "wait" || performance.now() < g.goAt) return;
    g.mode = "go";
    if (panel.current) panel.current.style.background = PANEL.go;
    g.start = performance.now();
    // Green reaches the glass a refresh after this frame — 17 ms on a 60 Hz
    // phone, 8 ms on a 120 Hz one — so the clock starts then, or the same
    // hand scores worse on the slower screen (§ 5.80).
    requestAnimationFrame(() => { if (g.mode === "go") g.start = performance.now(); });
    setView((v) => ({ ...v, mode: "go" }));
  }, { running: view.mode === "wait" });

  const tap = (e) => {
    const g = game.current;
    const now = performance.now();
    // The touch's own time when the event carries it: a busy frame between
    // the finger and this handler is not the player's either.
    const at = Number.isFinite(e.timeStamp) && Math.abs(now - e.timeStamp) < 1000 ? e.timeStamp : now;
    if (g.mode === "wait" || (g.mode === "go" && at - g.start < HUMAN)) {
      show("early");
      sound("lose");
      haptic("warning");
      return;
    }
    if (g.mode === "go") {
      const t = Math.round(at - g.start);
      g.times.push(t);
      if (g.times.length < ROUND) {
        show("hit", t);
        sound("tap");
        haptic("light");
        return;
      }
      const average = Math.round(g.times.reduce((a, b) => a + b, 0) / ROUND);
      g.overAt = now;
      show("over", average);
      board.submit(average);
      sound("win");
      haptic("success");
      return;
    }
    if (g.mode === "over") {
      if (now - g.overAt < 800) return;
      g.times = [];
    }
    arm();
    haptic("light");
  };

  const { mode, times, last } = view;
  const mine = board.mine?.best;
  const leader = board.leader;
  const big = "clamp(30px, 17cqmin, 68px)";
  const word = "clamp(24px, 12cqmin, 48px)";
  const small = "clamp(12px, 4.5cqmin, 17px)";
  // The poster's face; words in capitals like a sign, a time as it is written.
  const display = { fontFamily: "var(--s-font-display)", lineHeight: 1.05 };
  const shout = { ...display, textTransform: "uppercase" };
  const main = {
    ready: <div className="s-hud" style={{ ...shout, fontSize: word }}>{w.start}</div>,
    wait: <div className="s-hud" style={{ ...shout, fontSize: word }}>{w.wait}</div>,
    go: <div className="s-hud" style={{ ...shout, fontSize: big }}>{w.go}</div>,
    hit: <div className="s-hud" style={{ ...display, fontSize: big }}>{ms(last)}</div>,
    early: <div className="s-hud" style={{ ...shout, fontSize: word }}>{w.early}</div>,
    over: (
      <>
        <div className="s-hud" style={{ fontSize: small }}>{w.average}</div>
        <div className="s-hud" style={{ ...display, fontSize: big }}>{ms(last)}</div>
      </>
    ),
  }[mode];
  const sub = {
    ready: w.how, wait: "", go: "", hit: w.next, early: w.retry,
    over: `${mine ? `${w.best(ms(mine))} · ` : ""}${w.again}`,
  }[mode];

  return (
    <Scene theme="poster">
      <Stack>
        <Text variant="title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.title}</Text>
        <Fill>
          <div
            ref={panel}
            onPointerDown={tap}
            style={{
              position: "relative", height: "100%", borderRadius: 16, background: PANEL[mode],
              boxShadow: "0 4px 0 rgb(0 0 0 / 0.25)", touchAction: "none", userSelect: "none", WebkitUserSelect: "none",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 6, padding: "10px 14px", textAlign: "center", boxSizing: "border-box",
            }}
          >
            <div style={{ position: "absolute", top: 12, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 7 }}>
              {Array.from({ length: ROUND }, (_, i) => (
                <span key={i} style={{ width: 9, height: 9, borderRadius: 5, background: i < times.length ? "#fde047" : "rgb(255 255 255 / 0.3)" }} />
              ))}
            </div>
            {main}
            {sub && <div className="s-hud" style={{ fontSize: small }}>{sub}</div>}
            {mode === "over" && <div className="s-hud" style={{ fontSize: small, opacity: 0.9 }}>{times.join(" · ")}</div>}
          </div>
        </Fill>
        <Only in="row">
          <Meta>🏆 {leader ? `${leader.name.split(" ")[0]} · ${ms(leader.best)}` : w.none}</Meta>
        </Only>
        <Only in="expanded">
          <Leaderboard entries={board.entries} me={Spiral.viewer} max={8} format={ms} />
        </Only>
      </Stack>
    </Scene>
  );
}
