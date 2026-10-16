import { useEffect, useRef, useState } from "react";
import { Spiral, useSharedState, useRoomMembers, useNow, useChanged, useSound, useHaptic, summary } from "@spiral/sdk";
import { Scene, Stack, Fill, Row, Text, Meta, Button } from "@spiral/ui";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const DROP = 3 * HOUR; // a heart of food or fun lasts three hours
const SHOW_MS = 2200; // eating, playing, hatching — as long as the animation

// The post's own words, in the language of whoever is looking at it.
const plural = (n, one, few, many) => {
  const d = n % 10, h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};
const WORDS = {
  uk: {
    name: "Пухнастик", egg: "Яйце", hatch: "Висидіти яйце", feed: "Погодувати", play: "Пограти", asleep: "спить",
    age: (d) => (d === 0 ? "перший день" : `${d} ${plural(d, "день", "дні", "днів")}`),
    food: "Ситість", fun: "Настрій", eggHint: "Хтось має його висидіти",
    hatched: "Вилупився Пухнастик!", feeds: (n) => `${n} годує Пухнастика`, plays: (n) => `${n} грається з Пухнастиком`,
  },
  ru: {
    name: "Пушистик", egg: "Яйцо", hatch: "Высидеть яйцо", feed: "Покормить", play: "Поиграть", asleep: "спит",
    age: (d) => (d === 0 ? "первый день" : `${d} ${plural(d, "день", "дня", "дней")}`),
    food: "Сытость", fun: "Настроение", eggHint: "Кто-то должен его высидеть",
    hatched: "Вылупился Пушистик!", feeds: (n) => `${n} кормит Пушистика`, plays: (n) => `${n} играет с Пушистиком`,
  },
  en: {
    name: "Fluffy", egg: "An egg", hatch: "Hatch the egg", feed: "Feed", play: "Play", asleep: "asleep",
    age: (d) => (d === 0 ? "day one" : `${d} ${d === 1 ? "day" : "days"}`),
    food: "Food", fun: "Fun", eggHint: "Somebody has to hatch it",
    hatched: "Fluffy hatched!", feeds: (n) => `${n} feeds Fluffy`, plays: (n) => `${n} plays with Fluffy`,
  },
};
const language = () => Spiral.language ?? String(navigator.language ?? "").slice(0, 2);
const every = (say) => Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, say(w)]));

const INK = "#1f2a1a"; // the LCD's own black
const hearts = (n) => "♥".repeat(n) + "♡".repeat(4 - n);

const CSS = `
.tg-walk, .tg-hop, .tg-egg, .tg-z, .tg-ball, .tg-chew, .tg-crack { transform-box: fill-box; }
@keyframes tg-walk { 0%, 100% { transform: translateX(-14px); } 50% { transform: translateX(14px); } }
@keyframes tg-hop { 0%, 60%, 100% { transform: translateY(0); } 75% { transform: translateY(-5px); } }
@keyframes tg-egg { 0%, 70%, 100% { transform: rotate(0deg); } 78% { transform: rotate(-8deg); } 86% { transform: rotate(8deg); } 94% { transform: rotate(-4deg); } }
@keyframes tg-z { 0% { transform: translate(0, 0); opacity: 0; } 30% { opacity: 1; } 100% { transform: translate(8px, -16px); opacity: 0; } }
@keyframes tg-ball { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-18px); } }
@keyframes tg-chew { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(0.4); } }
@keyframes tg-crack { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(1.6); opacity: 0; } }
.tg-walk { animation: tg-walk 7s ease-in-out infinite; }
.tg-hop { transform-origin: 50% 100%; animation: tg-hop 1.3s ease-in-out infinite; }
.tg-egg { transform-origin: 50% 100%; animation: tg-egg 2.4s ease-in-out infinite; }
.tg-z { animation: tg-z 2.2s ease-out infinite; }
.tg-ball { animation: tg-ball 0.55s ease-in-out infinite; }
.tg-chew { transform-origin: center; animation: tg-chew 0.3s ease-in-out infinite; }
.tg-crack { transform-origin: center; animation: tg-crack 0.9s ease-out both; }
@media (prefers-reduced-motion: reduce) { .tg-walk, .tg-hop, .tg-egg, .tg-z { animation: none; } }
`;

// The pet, drawn round its feet at (0, 0): bigger, with ears and a tail as it
// grows; its face says how it is.
const Pet = ({ stage, face, doing }) => {
  const r = [13, 16, 19][stage];
  const eyes = {
    happy: <><path d={`M${-r * 0.5} ${-r * 1.1} q3 -4 6 0`} /><path d={`M${r * 0.5 - 6} ${-r * 1.1} q3 -4 6 0`} /></>,
    sleep: <><path d={`M${-r * 0.5} ${-r * 1.08} h6`} /><path d={`M${r * 0.5 - 6} ${-r * 1.08} h6`} /></>,
  }[face] ?? (
    <>
      <circle cx={-r * 0.38} cy={-r * 1.12} r="2.1" fill={INK} stroke="none" />
      <circle cx={r * 0.38} cy={-r * 1.12} r="2.1" fill={INK} stroke="none" />
    </>
  );
  const mouth = face === "sad" ? `M-4 ${-r * 0.62} q4 -3.5 8 0` : face === "sleep" ? `M-2 ${-r * 0.7} h4` : `M-4 ${-r * 0.72} q4 4 8 0`;
  return (
    <g stroke={INK} strokeWidth="2" strokeLinecap="round" fill="none">
      {stage > 0 && <path d={`M${-r * 0.75} ${-r * 1.55} l-3 -${r * 0.55} l${r * 0.5} ${r * 0.25}`} fill={INK} />}
      {stage > 0 && <path d={`M${r * 0.75} ${-r * 1.55} l3 -${r * 0.55} l${-r * 0.5} ${r * 0.25}`} fill={INK} />}
      {stage > 1 && <path d={`M${-r} ${-r * 0.5} q-9 -2 -8 -11`} />}
      <ellipse cx="0" cy={-r} rx={r} ry={r * 0.92} fill="#dfe6c4" />
      {stage > 1 && <><path d={`M${-r * 0.5} -1 v2`} /><path d={`M${r * 0.5} -1 v2`} /></>}
      {eyes}
      <path className={doing === "eat" ? "tg-chew" : undefined} d={mouth} />
      {face === "sad" && <path d={`M${r * 0.38 + 2} ${-r * 0.95} v3`} strokeWidth="1.4" />}
      {doing === "eat" && <g transform={`translate(${r + 6} ${-r * 0.55})`} fill={INK}><path d="M-6 4 L0 -6 L6 4 Z" fill="#f8fafc" /><rect x="-4" y="0" width="8" height="4" fill={INK} stroke="none" /></g>}
    </g>
  );
};

export default function App() {
  const w = WORDS[language()] ?? WORDS.en;
  const [state, apply] = useSharedState();
  const members = useRoomMembers();
  const now = useNow(60000);
  const sound = useSound();
  const haptic = useHaptic();
  const me = Spiral.viewer;

  const born = Number(state.born) || 0;
  const fedAt = Number(state.fedAt) || born;
  const playedAt = Number(state.playedAt) || born;
  const t = now ?? born;
  const level = (at) => Math.max(0, Math.min(4, 4 - Math.floor((t - at) / DROP)));
  const food = level(fedAt), fun = level(playedAt);
  const days = born ? Math.max(0, Math.floor((t - born) / DAY)) : 0;
  const stage = days < 1 ? 0 : days < 3 ? 1 : 2;
  const hour = new Date(t || 0).getHours();
  const night = born > 0 && now !== undefined && (hour >= 23 || hour < 7);

  // What the room just did to it, for everyone watching: eating, playing,
  // hatching — never replayed on opening the post.
  const [doing, setDoing] = useState(null);
  const timer = useRef(undefined);
  const show = (what) => {
    setDoing(what);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDoing(null), SHOW_MS);
  };
  // Any change, not only a later one: a feeder whose clock runs behind
  // wrote an earlier time, and the pet did not eat (§ 5.80).
  useChanged(fedAt, (v, before) => { if (v !== before && state.fedAt) show("eat"); });
  useChanged(playedAt, (v, before) => { if (v !== before && state.playedAt) show("play"); });
  useChanged(born, (v, before) => { if (v && !before) show("hatch"); });
  useEffect(() => () => clearTimeout(timer.current), []);

  const face = doing === "eat" || doing === "play" ? "happy"
    : night ? "sleep"
    : food <= 1 || fun <= 1 ? "sad"
    : food >= 3 && fun >= 3 ? "happy" : "plain";
  const wants = born > 0 && !doing && !night && (food <= 1 ? "food" : fun <= 1 ? "fun" : null);

  const myName = members?.find((m) => m.userId === me)?.displayName ?? me.replace(/^@/, "").split(":")[0];
  const act = async (what) => {
    haptic(what === "hatch" ? "success" : "light");
    sound(what === "hatch" ? "win" : what === "feed" ? "pick" : "pop");
    const at = await Spiral.time.now();
    if (what === "hatch") apply({ setIfAbsent: { path: "born", value: at } }, summary({ line: every((w) => w.hatched) }));
    if (what === "feed") apply({ batch: { ops: [{ set: { path: "fedAt", value: at } }, { incr: { path: "meals", by: 1 } }] } }, summary({ line: every((w) => w.feeds(myName)) }));
    if (what === "play") apply({ batch: { ops: [{ set: { path: "playedAt", value: at } }, { incr: { path: "games", by: 1 } }] } }, summary({ line: every((w) => w.plays(myName)) }));
  };

  const title = born ? `${w.name} · ${night && !doing ? w.asleep : w.age(days)}` : w.egg;

  // A toy from the nineties on a sky (§ 5.76): a pink egg with a white
  // bezel and a green LCD, the pet in the LCD's own black.
  return (
    <Scene theme="sky">
      <style>{CSS}</style>
      <Stack>
        <Text variant="title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</Text>
        <Fill>
          <svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "100%", display: "block" }} aria-hidden="true">
            <defs>
              <linearGradient id="tg-shell" x1="0" y1="0" x2="0.3" y2="1">
                <stop offset="0" stopColor="#f9a8d4" />
                <stop offset="1" stopColor="#db2777" />
              </linearGradient>
              <linearGradient id="tg-lcd" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#cdd8a6" />
                <stop offset="1" stopColor="#b3c28a" />
              </linearGradient>
              <pattern id="tg-px" width="3" height="3" patternUnits="userSpaceOnUse">
                <path d="M0 0 H3 M0 0 V3" stroke={INK} strokeWidth="0.3" opacity="0.12" />
              </pattern>
            </defs>
            <path d="M100 8 C152 8 186 66 186 116 C186 166 148 196 100 196 C52 196 14 166 14 116 C14 66 48 8 100 8 Z" fill="url(#tg-shell)" stroke="#831843" strokeWidth="2.5" />
            <ellipse cx="66" cy="44" rx="20" ry="11" fill="#ffffff" opacity="0.35" transform="rotate(-30 66 44)" />
            <rect x="36" y="48" width="128" height="104" rx="18" fill="#fdf2f8" stroke="#831843" strokeWidth="2" />
            <rect x="46" y="58" width="108" height="84" rx="8" fill="url(#tg-lcd)" stroke="#6b7a55" strokeWidth="1.5" />
            <rect x="46" y="58" width="108" height="84" rx="8" fill="url(#tg-px)" />
            <g transform="translate(100 136) scale(1.25)">
              {!born ? (
                <g className="tg-egg">
                  <path d="M0 -38 C12 -38 20 -20 20 -10 C20 0 11 4 0 4 C-11 4 -20 0 -20 -10 C-20 -20 -12 -38 0 -38 Z" fill="#dfe6c4" stroke={INK} strokeWidth="2" />
                  <path d="M-12 -18 l5 4 l5 -5 l5 5 l5 -4 l5 4" stroke={INK} strokeWidth="1.6" fill="none" strokeLinejoin="round" />
                </g>
              ) : (
                <g className={doing || night || face === "sad" ? undefined : "tg-walk"}>
                  <g className={night && !doing ? undefined : "tg-hop"}>
                    <Pet stage={stage} face={face} doing={doing} />
                  </g>
                  {doing === "play" && <circle className="tg-ball" cx="30" cy="-6" r="6" fill="#f8fafc" stroke={INK} strokeWidth="2" />}
                </g>
              )}
              {doing === "hatch" && <g className="tg-crack"><path d="M-20 -10 C-20 -24 -10 -38 0 -38 C10 -38 20 -24 20 -10" fill="none" stroke={INK} strokeWidth="2" /></g>}
              {night && !doing && born > 0 && (
                <g stroke={INK} strokeWidth="1.8" fill="none" strokeLinejoin="round">
                  <path className="tg-z" d="M18 -44 h6 l-6 7 h6" />
                  <path className="tg-z" d="M28 -58 h8 l-8 9 h8" style={{ animationDelay: "-1.1s" }} />
                </g>
              )}
            </g>
            {wants && (
              <g transform="translate(138 74)">
                <rect x="-13" y="-11" width="26" height="22" rx="6" fill="#f8fafc" stroke={INK} strokeWidth="1.6" />
                {wants === "food"
                  ? <><path d="M-6 5 L0 -6 L6 5 Z" fill="#f8fafc" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" /><rect x="-4.5" y="1" width="9" height="4" fill={INK} /></>
                  : <><circle cx="0" cy="0" r="6" fill="#f8fafc" stroke={INK} strokeWidth="1.6" /><path d="M-6 0 H6 M0 -6 V6" stroke={INK} strokeWidth="1.2" /></>}
              </g>
            )}
            {[["feed", 70, 170], ["hatch", 100, 176], ["play", 130, 170]].map(([what, x, y]) => (
              <circle key={what} cx={x} cy={y} r="9" fill="#fde68a" stroke="#831843" strokeWidth="2" onClick={() => act(born ? (what === "hatch" ? "feed" : what) : "hatch")} />
            ))}
          </svg>
        </Fill>
        <Meta>{born ? `${w.food} ${hearts(food)} · ${w.fun} ${hearts(fun)}` : w.eggHint}</Meta>
        <Row>
          {born
            ? <><Button onPress={() => act("feed")}>{w.feed}</Button><Button variant="secondary" onPress={() => act("play")}>{w.play}</Button></>
            : <Button onPress={() => act("hatch")}>{w.hatch}</Button>}
        </Row>
      </Stack>
    </Scene>
  );
}
