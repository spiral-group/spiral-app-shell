import { useRef, useState } from "react";
import { Spiral, useSharedState, useRoomMembers, useNow, useChanged, useSound, useHaptic, summary } from "@spiral/sdk";
import { Scene, Stack, Fill, Row, Text, Meta, Button, Only, accent } from "@spiral/ui";

const BURN_MS = 8 * 3600 * 1000; // a fire nobody feeds is embers in eight hours
const STAY_MS = 24 * 3600 * 1000; // who sat down today is still by the fire

// The post's own words, in the language of whoever is looking at it.
const WORDS = {
  uk: {
    title: "Вогнище", dying: "Вогнище догорає", sit: "Сісти біля вогню", stoke: "Підкинути дров",
    around: (names) => `Біля вогню: ${names}`, count: (n) => `Біля вогню: ${n}`, nobody: "Біля вогню поки нікого",
    sits: (n) => `${n} сідає біля вогнища`, stokes: (n) => `${n} підкидає дров`,
  },
  ru: {
    title: "Костёр", dying: "Костёр догорает", sit: "Сесть у костра", stoke: "Подбросить дров",
    around: (names) => `У костра: ${names}`, count: (n) => `У костра: ${n}`, nobody: "У костра пока никого",
    sits: (n) => `${n} садится у костра`, stokes: (n) => `${n} подбрасывает дров`,
  },
  en: {
    title: "Campfire", dying: "The fire is dying down", sit: "Sit by the fire", stoke: "Add a log",
    around: (names) => `By the fire: ${names}`, count: (n) => `By the fire: ${n}`, nobody: "Nobody by the fire yet",
    sits: (n) => `${n} sits by the fire`, stokes: (n) => `${n} adds a log`,
  },
};
const language = () => Spiral.language ?? String(navigator.language ?? "").slice(0, 2);
const every = (say) => Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, say(w)]));
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// Places around the fire, nearest first, alternating sides.
const SEATS = [[60, 104], [140, 104], [42, 96], [158, 96], [74, 113], [126, 113]];

const CSS = `
.cf-a, .cf-b, .cf-c, .cf-glow, .cf-spark, .cf-flare { transform-box: fill-box; }
@keyframes cf-a { 0%, 100% { transform: scale(1, 1) skewX(0deg); } 30% { transform: scale(0.94, 1.07) skewX(2deg); } 65% { transform: scale(1.04, 0.95) skewX(-2deg); } }
@keyframes cf-b { 0%, 100% { transform: scale(1, 1); } 40% { transform: scale(1.06, 0.92) skewX(-3deg); } 70% { transform: scale(0.95, 1.08) skewX(3deg); } }
@keyframes cf-glow { 0%, 100% { opacity: 0.55; transform: scale(1); } 50% { opacity: 0.8; transform: scale(1.06); } }
@keyframes cf-spark { 0% { transform: translate(0, 0); opacity: 0; } 10% { opacity: 1; } 100% { transform: translate(var(--dx), -58px); opacity: 0; } }
@keyframes cf-flare { 0%, 100% { transform: scale(1); } 30% { transform: scale(1.35); } }
@keyframes cf-lit { 0%, 100% { opacity: 0.75; } 50% { opacity: 1; } }
.cf-a { transform-origin: 50% 100%; animation: cf-a 1.1s ease-in-out infinite; }
.cf-b { transform-origin: 50% 100%; animation: cf-b 0.8s ease-in-out infinite; }
.cf-c { transform-origin: 50% 100%; animation: cf-a 0.55s ease-in-out infinite reverse; }
.cf-glow { transform-origin: center; animation: cf-glow 2.6s ease-in-out infinite; }
.cf-spark { animation: cf-spark var(--d) ease-out var(--delay) infinite; }
.cf-flare { transform-origin: 50% 100%; animation: cf-flare 1.2s ease-out both; }
.cf-lit { animation: cf-lit 1.9s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .cf-a, .cf-b, .cf-c, .cf-glow, .cf-spark, .cf-lit { animation: none; } }
`;

export default function App() {
  const w = WORDS[language()] ?? WORDS.en;
  const [state, apply] = useSharedState();
  const members = useRoomMembers();
  const now = useNow(30000);
  const sound = useSound();
  const haptic = useHaptic();
  const me = Spiral.viewer;

  const nameOf = (id) => members?.find((m) => m.userId === id)?.displayName ?? id.replace(/^@/, "").split(":")[0];
  const by = isObject(state.by) ? state.by : {};
  const around = Object.entries(by)
    // Nobody sits until the host's clock has answered: before it, everyone
    // who ever sat was drawn round the fire for a moment (§ 5.80).
    .filter(([, own]) => isObject(own) && typeof own.sat === "number" && now !== undefined && now - own.sat < STAY_MS)
    .sort(([, a], [, b]) => a.sat - b.sat)
    .map(([id]) => id);
  const sitting = around.includes(me);
  const stokedAt = Number(state.stokedAt) || 0;
  // A new fire burns; a fed one burns down over eight hours to embers.
  const heat = stokedAt === 0 || now === undefined ? 0.85 : Math.max(0.25, 1 - (now - stokedAt) / BURN_MS);
  const dying = heat < 0.45;

  const [flare, setFlare] = useState(0);
  const lastStoke = useRef(0);
  useChanged(stokedAt, (t) => { setFlare(t); lastStoke.current = performance.now(); });

  const myName = nameOf(me);
  const sit = async () => {
    haptic("light");
    const at = await Spiral.time.now();
    apply({ set: { path: Spiral.mine("sat"), value: at } }, summary({ line: every((w) => w.sits(myName)) }));
  };
  // A log already catching needs no other: taps while it flares are not
  // actions, each of which wakes every phone in the room.
  const stoke = async () => {
    if (performance.now() - lastStoke.current < 3000) return;
    lastStoke.current = performance.now();
    sound("pop");
    haptic("medium");
    const at = await Spiral.time.now();
    apply({ set: { path: "stokedAt", value: at } }, summary({ line: every((w) => w.stokes(myName)) }));
  };

  // A clearing at night (§ 5.76): stars, a line of pines, stones round a
  // fire that flickers in three layers and throws sparks, and the chat's
  // people sitting in its light.
  const s = 0.55 + heat * 0.45;
  return (
    <Scene theme="night">
      <style>{CSS}</style>
      <Stack>
        <Text variant="title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dying ? w.dying : w.title}</Text>
        <Fill>
          <div className="cf" style={{ height: "100%" }}>
            <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMax meet" style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }} aria-hidden="true">
              <defs>
                <radialGradient id="cf-glow">
                  <stop offset="0" stopColor="#fb923c" stopOpacity="0.75" />
                  <stop offset="0.45" stopColor="#f97316" stopOpacity="0.28" />
                  <stop offset="1" stopColor="#f97316" stopOpacity="0" />
                </radialGradient>
              </defs>
              <path d="M-60 88 L-50 70 L-40 88 L-34 64 L-22 88 L-12 72 L-2 88 L6 60 L18 88 L28 74 L38 88 L46 66 L58 88 L150 88 L156 68 L166 88 L174 58 L186 88 L194 72 L204 88 L212 62 L224 88 L234 74 L246 88 L260 88 L260 130 L-60 130 Z" fill="#0b0720" />
              <rect x="-60" y="86" width="320" height="44" fill="#140d2e" />
              <ellipse className="cf-glow" cx="100" cy="92" rx={46 * s} ry={30 * s} fill="url(#cf-glow)" />
              {around.slice(0, SEATS.length).map((id, i) => {
                const [x, y] = SEATS[i];
                return (
                  <g key={id}>
                    <ellipse cx={x} cy={y + 8} rx="9" ry="2.5" fill="#000000" opacity="0.35" />
                    <circle className="cf-lit" cx={x} cy={y} r="10" fill="none" stroke="#fdba74" strokeWidth="1.3" />
                    <circle cx={x} cy={y} r="8.5" style={{ fill: accent(i) }} stroke="#1e1b4b" strokeWidth="1.2" />
                    <text x={x} y={y + 0.5} textAnchor="middle" dominantBaseline="central" fontSize="8.5" fontWeight="700" fill="#1e1b4b">
                      {nameOf(id)[0]?.toUpperCase()}
                    </text>
                  </g>
                );
              })}
              {[[84, 104], [95, 107], [108, 107], [118, 103], [79, 99], [122, 98]].map(([x, y], i) => (
                <ellipse key={i} cx={x} cy={y} rx="6" ry="3.6" fill={i % 2 ? "#57534e" : "#78716c"} stroke="#1c1917" strokeWidth="0.8" />
              ))}
              <rect x="84" y="95" width="34" height="6" rx="3" fill="#78350f" stroke="#1c1917" strokeWidth="0.8" transform="rotate(-14 101 98)" />
              <rect x="84" y="95" width="34" height="6" rx="3" fill="#92400e" stroke="#1c1917" strokeWidth="0.8" transform="rotate(14 101 98)" />
              <g key={flare} className={flare ? "cf-flare" : undefined}>
                <g transform={`translate(100 99) scale(${s}) translate(-100 -99)`}>
                  <path className="cf-a" d="M100 44 C113 60 122 74 116 88 C112 98 88 98 84 88 C78 74 87 60 100 44 Z" fill="#ef4444" />
                  <path className="cf-b" d="M100 56 C110 68 115 78 111 89 C108 96 92 96 89 89 C85 78 90 68 100 56 Z" fill="#f97316" />
                  <path className="cf-c" d="M100 68 C106 76 109 82 106 90 C104 94 96 94 94 90 C91 82 94 76 100 68 Z" fill="#fde047" />
                </g>
              </g>
              {Array.from({ length: 8 }, (_, i) => (
                <circle
                  key={i} className="cf-spark" cx={96 + (i % 4) * 3} cy={74} r={i % 3 ? 1 : 1.4} fill="#fde68a"
                  style={{ "--dx": `${((i * 7) % 13) - 6}px`, "--d": `${1.8 + (i % 3) * 0.5}s`, "--delay": `${-i * 0.37}s`, opacity: heat }}
                />
              ))}
            </svg>
          </div>
        </Fill>
        <Only in="expanded">
          <Meta>{around.length ? w.around(around.map((id) => nameOf(id).split(" ")[0]).join(", ")) : w.nobody}</Meta>
        </Only>
        <Row between>
          <Meta><Only in="row">{around.length ? w.count(around.length) : w.nobody}</Only></Meta>
          {sitting ? <Button onPress={stoke}>{w.stoke}</Button> : <Button onPress={sit}>{w.sit}</Button>}
        </Row>
      </Stack>
    </Scene>
  );
}
