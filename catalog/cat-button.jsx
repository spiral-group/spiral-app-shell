import { useEffect, useRef, useState } from "react";
import { Spiral, useSharedState, useRoomMembers, useChanged, useSound, useHaptic, summary } from "@spiral/sdk";
import { Scene, Stack, Fill, Text, Meta } from "@spiral/ui";

const PLAY_MS = 2600; // one chapter; the button waits for it to end

// The post's own words, in the language of whoever is looking at it.
const plural = (n, one, few, many) => {
  const d = n % 10, h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};
const WORDS = {
  uk: {
    title: "Кіт і кнопка", sign: "НЕ ТИСНИ!", meow: "Мяу!", dont: "Тільки не натискайте червону кнопку",
    count: (n) => `Натиснули ${n} ${plural(n, "раз", "рази", "разів")}`, last: (who) => `востаннє — ${who}`,
    pressed: (who, n) => `${who} тисне кнопку · ${n}`,
  },
  ru: {
    title: "Кот и кнопка", sign: "НЕ ЖМИ!", meow: "Мяу!", dont: "Только не нажимайте красную кнопку",
    count: (n) => `Нажали ${n} ${plural(n, "раз", "раза", "раз")}`, last: (who) => `последний раз — ${who}`,
    pressed: (who, n) => `${who} жмёт кнопку · ${n}`,
  },
  en: {
    title: "The cat and the button", sign: "DON'T PUSH", meow: "Meow!", dont: "Just don't press the red button",
    count: (n) => (n === 1 ? "Pressed once" : `Pressed ${n} times`), last: (who) => `last by ${who}`,
    pressed: (who, n) => `${who} pressed the button · ${n}`,
  },
};
const language = () => Spiral.language ?? String(navigator.language ?? "").slice(0, 2);
const every = (say) => Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, say(w)]));

// The story, one chapter a press, the same chapter on every phone.
const CHAPTERS = ["fright", "confetti", "dark", "fish", "leap"];
const SOUND = { fright: "lose", confetti: "win", dark: "tick", fish: "pick", leap: "pop" };

const CSS = `
.cb svg g, .cb svg path, .cb svg ellipse, .cb svg rect, .cb svg circle, .cb svg text { transform-box: fill-box; }
@keyframes cb-tail { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(-14deg); } }
@keyframes cb-blink { 0%, 93%, 100% { transform: scaleY(1); } 96% { transform: scaleY(0.1); } }
@keyframes cb-jump { 0%, 100% { transform: translateY(0); } 18% { transform: translateY(-34px) scale(1.04, 0.96); } 40% { transform: translateY(-34px); } 62% { transform: translateY(0) scale(1.06, 0.92); } 74% { transform: translateY(0); } }
@keyframes cb-pop { 0% { transform: scale(0); opacity: 0; } 20%, 80% { transform: scale(1); opacity: 1; } 100% { transform: scale(1); opacity: 0; } }
@keyframes cb-conf { 0% { transform: translate(0, 0) rotate(0deg); opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) rotate(var(--r)); opacity: 0; } }
@keyframes cb-dark { 0%, 100% { opacity: 0; } 12%, 78% { opacity: 0.9; } }
@keyframes cb-drop { 0% { transform: translateY(-160px); } 45% { transform: translateY(0); } 55% { transform: translateY(-10px); } 65%, 100% { transform: translateY(0); } }
@keyframes cb-leap { 0%, 100% { transform: translate(0, 0); } 30% { transform: translate(40px, -70px); } 45%, 70% { transform: translate(78px, -46px); } 85% { transform: translate(30px, -40px); } }
@keyframes cb-squash { 0%, 38%, 76%, 100% { transform: scaleY(1); } 46%, 70% { transform: scaleY(0.55); } }
@keyframes cb-press { 0%, 100% { transform: scaleY(1); } 10%, 30% { transform: scaleY(0.7); } }
.cb-tail { transform-origin: 100% 100%; animation: cb-tail 2.4s ease-in-out infinite; }
.cb-blink { transform-origin: center; animation: cb-blink 4.2s linear infinite; }
.cb-jump { animation: cb-jump ${PLAY_MS}ms ease-in-out both; }
.cb-pop { transform-origin: 50% 100%; animation: cb-pop ${PLAY_MS}ms ease-out both; }
.cb-conf { animation: cb-conf 1.5s cubic-bezier(0.2, 0.7, 0.4, 1) both; }
.cb-dark { animation: cb-dark ${PLAY_MS}ms ease-in-out both; }
.cb-glow { animation: cb-dark ${PLAY_MS}ms ease-in-out both; }
.cb-drop { animation: cb-drop 1.6s cubic-bezier(0.5, 0, 0.6, 1) both; }
.cb-leap { animation: cb-leap ${PLAY_MS}ms ease-in-out both; }
.cb-squash { transform-origin: 50% 100%; animation: cb-squash ${PLAY_MS}ms ease-in-out both; }
.cb-press { transform-origin: 50% 100%; animation: cb-press 0.5s ease-out both; }
@media (prefers-reduced-motion: reduce) { .cb-tail, .cb-blink { animation: none; } }
`;

const INK = "#1c1917";
const FUR = "#44403c";
const BELLY = "#a8a29e";

export default function App() {
  const w = WORDS[language()] ?? WORDS.en;
  const [state, apply] = useSharedState();
  const members = useRoomMembers();
  const sound = useSound();
  const haptic = useHaptic();
  const me = Spiral.viewer;

  const presses = Number(state.presses) || 0;
  const lastBy = typeof state.lastBy === "string" ? state.lastBy : null;
  const nameOf = (id) => members?.find((m) => m.userId === id)?.displayName ?? id.replace(/^@/, "").split(":")[0];

  // A chapter plays when a press lands while the post is open — this
  // viewer's or anyone's — and not when an old post is opened.
  const [playing, setPlaying] = useState(null);
  const timer = useRef(undefined);
  useChanged(presses, (n, before) => {
    if (n <= before) return;
    const chapter = CHAPTERS[(n - 1) % CHAPTERS.length];
    setPlaying({ chapter, n });
    sound(SOUND[chapter]);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPlaying(null), PLAY_MS);
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  const press = () => {
    if (playing) return;
    const n = presses + 1;
    const who = nameOf(me);
    apply({ batch: { ops: [{ incr: { path: "presses", by: 1 } }, { set: { path: "lastBy", value: me } }] } }, summary({ line: every((w) => w.pressed(who, n)) }));
    haptic("medium");
  };

  const chapter = playing?.chapter;
  const happy = chapter === "confetti" || chapter === "fish";
  const status = presses === 0 ? w.dont : `${w.count(presses)}${lastBy ? ` · ${w.last(nameOf(lastBy).split(" ")[0])}` : ""}`;

  // A comic on a yellow poster (§ 5.76): a grey cat, a red button on a
  // pedestal, and a sign that asks for exactly what everyone will do.
  const eyes = happy ? (
    <g>
      <path d="M64 77 Q69 71 74 77" stroke={INK} strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M82 77 Q87 71 92 77" stroke={INK} strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </g>
  ) : (
    <g className="cb-blink">
      <ellipse cx="69" cy="76" rx="6" ry={chapter === "fright" ? 7.5 : 6.5} fill="#ffffff" stroke={INK} strokeWidth="1.2" />
      <ellipse cx="87" cy="76" rx="6" ry={chapter === "fright" ? 7.5 : 6.5} fill="#ffffff" stroke={INK} strokeWidth="1.2" />
      <circle cx={chapter === "fright" ? 69 : 71.5} cy="76.5" r={chapter === "fright" ? 2 : 3.2} fill={INK} />
      <circle cx={chapter === "fright" ? 87 : 89.5} cy="76.5" r={chapter === "fright" ? 2 : 3.2} fill={INK} />
    </g>
  );
  const cat = (
    <g className={chapter === "fright" ? "cb-jump" : chapter === "leap" ? "cb-leap" : undefined} key={playing?.n ?? "idle"}>
      <path className="cb-tail" d="M46 128 C22 130 12 104 24 92 C30 86 38 92 32 98 C24 106 28 120 48 119 Z" fill={FUR} stroke={INK} strokeWidth="1.5" />
      <ellipse cx="72" cy="116" rx="28" ry="25" fill={FUR} stroke={INK} strokeWidth="1.5" />
      <ellipse cx="75" cy="122" rx="13" ry="16" fill={BELLY} />
      <ellipse cx="63" cy="139" rx="8" ry="4.5" fill={FUR} stroke={INK} strokeWidth="1.5" />
      <ellipse cx="85" cy="139" rx="8" ry="4.5" fill={FUR} stroke={INK} strokeWidth="1.5" />
      <path d="M56 66 L58 42 L74 57 Z" fill={FUR} stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M100 66 L98 42 L82 57 Z" fill={FUR} stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M60 59 L60 49 L68 56 Z" fill="#f9a8d4" />
      <path d="M96 59 L96 49 L88 56 Z" fill="#f9a8d4" />
      <circle cx="78" cy="75" r="24" fill={FUR} stroke={INK} strokeWidth="1.5" />
      <ellipse cx="78" cy="88" rx="12" ry="8" fill={BELLY} />
      {eyes}
      <path d="M75 84 L81 84 L78 87.5 Z" fill="#f472b6" stroke={INK} strokeWidth="0.8" strokeLinejoin="round" />
      <path d={chapter === "fright" ? "M74 92 Q78 89 82 92" : "M74 90 Q76 92.5 78 90 Q80 92.5 82 90"} stroke={INK} strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <g stroke={INK} strokeWidth="0.9" strokeLinecap="round">
        <line x1="66" y1="87" x2="50" y2="84" /><line x1="66" y1="90" x2="50" y2="92" />
        <line x1="90" y1="87" x2="106" y2="84" /><line x1="90" y1="90" x2="106" y2="92" />
      </g>
      {chapter === "fish" && (
        <g className="cb-drop">
          <path d="M68 131 L60 125 L60 137 Z" fill="#f97316" stroke={INK} strokeWidth="1" />
          <ellipse cx="78" cy="131" rx="12" ry="6.5" fill="#fb923c" stroke={INK} strokeWidth="1" />
          <circle cx="85" cy="129.5" r="1.4" fill={INK} />
        </g>
      )}
    </g>
  );

  return (
    <Scene theme="poster">
      <style>{CSS}</style>
      <Stack>
        <Text variant="title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.title}</Text>
        <Fill>
          <div className="cb" style={{ position: "relative", height: "100%" }}>
            <svg viewBox="0 0 200 150" preserveAspectRatio="xMidYMax meet" style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}>
              <line x1="-200" y1="143" x2="400" y2="143" stroke={INK} strokeWidth="1.6" />
              <rect x="128" y="98" width="44" height="45" rx="3" fill="#e7e5e4" stroke={INK} strokeWidth="1.5" />
              <rect x="124" y="91" width="52" height="8" rx="2" fill="#a8a29e" stroke={INK} strokeWidth="1.5" />
              <g key={`dome-${playing?.n ?? 0}`} className={chapter === "leap" ? "cb-squash" : playing ? "cb-press" : undefined}>
                <path d="M135 91 Q135 72 150 72 Q165 72 165 91 Z" fill="#dc2626" stroke={INK} strokeWidth="1.5" />
                <path d="M141 81 Q144 76 150 75.5" stroke="#fca5a5" strokeWidth="2.6" fill="none" strokeLinecap="round" />
              </g>
              <rect x="129" y="106" width="42" height="17" rx="2" fill="#ffffff" stroke={INK} strokeWidth="1.2" />
              <text x="150" y="118" textAnchor="middle" fontSize="9.5" fill="#b91c1c" style={{ fontFamily: "var(--s-font-display)", letterSpacing: "0.02em" }}>{w.sign}</text>
              {cat}
              {chapter === "fright" && <text key={`bang-${playing.n}`} className="cb-pop" x="104" y="44" fontSize="22" fill="#dc2626" style={{ fontFamily: "var(--s-font-display)" }}>!</text>}
              {chapter === "confetti" && Array.from({ length: 16 }, (_, i) => {
                const a = (i / 16) * Math.PI * 2;
                return (
                  <rect
                    key={`c-${playing.n}-${i}`} className="cb-conf" x="148" y="74" width="4" height="6" rx="1"
                    fill={["#dc2626", "#2563eb", "#16a34a", "#9333ea", "#ea580c"][i % 5]}
                    style={{ "--dx": `${Math.cos(a) * (44 + (i % 3) * 14)}px`, "--dy": `${Math.sin(a) * 38 - 30}px`, "--r": `${i * 47}deg` }}
                  />
                );
              })}
              {chapter === "dark" && (
                <g key={`dark-${playing.n}`}>
                  <rect className="cb-dark" x="-200" y="-100" width="600" height="300" fill="#0c0a09" />
                  <g className="cb-glow">
                    <ellipse cx="69" cy="76" rx="6" ry="6.5" fill="#bef264" />
                    <ellipse cx="87" cy="76" rx="6" ry="6.5" fill="#bef264" />
                    <ellipse cx="70" cy="76.5" rx="1.4" ry="4.5" fill={INK} />
                    <ellipse cx="88" cy="76.5" rx="1.4" ry="4.5" fill={INK} />
                  </g>
                </g>
              )}
              {chapter === "leap" && (
                <g key={`meow-${playing.n}`} className="cb-pop">
                  <rect x="150" y="16" width="44" height="20" rx="10" fill="#ffffff" stroke={INK} strokeWidth="1.3" />
                  <path d="M160 35 L156 42 L166 35 Z" fill="#ffffff" stroke={INK} strokeWidth="1.3" strokeLinejoin="round" />
                  <text x="172" y="30" textAnchor="middle" fontSize="11" fill={INK} style={{ fontFamily: "var(--s-font-display)" }}>{w.meow}</text>
                </g>
              )}
              <rect x="118" y="62" width="66" height="84" fill="transparent" onClick={press} />
            </svg>
          </div>
        </Fill>
        <Meta>{status}</Meta>
      </Stack>
    </Scene>
  );
}
