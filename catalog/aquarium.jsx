import { useRef, useState } from "react";
import { Spiral, useSharedState, useRoomMembers, useNow, useChanged, useSound, useHaptic, summary } from "@spiral/sdk";
import { Scene, Stack, Fill, Row, Text, Meta, Button, Only } from "@spiral/ui";

const HUNGRY_MS = 12 * 3600 * 1000; // unfed this long, the fish slow down and sink
const FLAKES_MS = 12 * 1000; // how long food falls after someone feeds them

// The post's own words, in the language of whoever is looking at it.
const plural = (n, one, few, many) => {
  const d = n % 10, h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};
const WORDS = {
  uk: {
    title: "Акваріум", hungry: "Рибки голодні", add: "Запустити рибку", feed: "Погодувати", change: "Інша рибка",
    fish: (n) => `${n} ${plural(n, "рибка", "рибки", "рибок")}`, empty: "У кожного своя рибка",
    fed: (a) => `годували ${a}`, never: "ще не годували", whose: "Чиї рибки",
    ago: (m) => (m < 1 ? "щойно" : m < 60 ? `${m} хв тому` : m < 1440 ? `${Math.floor(m / 60)} год тому` : `${Math.floor(m / 1440)} дн тому`),
    adds: (n) => `${n} запускає рибку`, feeds: (n) => `${n} годує рибок`,
  },
  ru: {
    title: "Аквариум", hungry: "Рыбки голодные", add: "Запустить рыбку", feed: "Покормить", change: "Другая рыбка",
    fish: (n) => `${n} ${plural(n, "рыбка", "рыбки", "рыбок")}`, empty: "У каждого своя рыбка",
    fed: (a) => `кормили ${a}`, never: "ещё не кормили", whose: "Чьи рыбки",
    ago: (m) => (m < 1 ? "только что" : m < 60 ? `${m} мин назад` : m < 1440 ? `${Math.floor(m / 60)} ч назад` : `${Math.floor(m / 1440)} дн назад`),
    adds: (n) => `${n} запускает рыбку`, feeds: (n) => `${n} кормит рыбок`,
  },
  en: {
    title: "Aquarium", hungry: "The fish are hungry", add: "Add a fish", feed: "Feed", change: "Another fish",
    fish: (n) => `${n} fish`, empty: "Everyone gets a fish",
    fed: (a) => `fed ${a}`, never: "not fed yet", whose: "Whose fish",
    ago: (m) => (m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`),
    adds: (n) => `${n} adds a fish`, feeds: (n) => `${n} feeds the fish`,
  },
};
const language = () => Spiral.language ?? String(navigator.language ?? "").slice(0, 2);
const every = (say) => Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, say(w)]));
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// Six fish: a body, fins, and a stripe of their own.
const KINDS = [
  { body: "#f97316", fin: "#ea580c", stripe: "#ffffff" }, // clownfish
  { body: "#2563eb", fin: "#facc15", stripe: "#1e3a8a" }, // blue tang
  { body: "#facc15", fin: "#eab308", stripe: "#1f2937" }, // butterflyfish
  { body: "#d946ef", fin: "#a21caf", stripe: "#f5d0fe" }, // betta
  { body: "#22c55e", fin: "#15803d", stripe: "#bbf7d0" }, // green chromis
  { body: "#ef4444", fin: "#b91c1c", stripe: "#fecaca" }, // red
];
// A kind the post can draw, whatever the state says: a negative or broken
// one threw, and the tank was gone for everyone (§ 5.80).
const kindOf = (v) => ((Math.trunc(Number(v)) || 0) % KINDS.length + KINDS.length) % KINDS.length;
const Fish = ({ kind }) => {
  const k = KINDS[kindOf(kind)];
  return (
    <svg viewBox="0 0 60 40" style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}>
      <path d="M12 20 L1 7 Q4 20 1 33 Z" fill={k.fin} />
      <path d="M25 8 Q33 -1 44 9 Z" fill={k.fin} />
      <ellipse cx="32" cy="21" rx="22" ry="13" fill={k.body} />
      <path d="M24 9 Q30 21 24 33" stroke={k.stripe} strokeWidth="4" fill="none" opacity="0.85" />
      <path d="M36 9.5 Q40 21 36 32.5" stroke={k.stripe} strokeWidth="3" fill="none" opacity="0.6" />
      <path d="M30 30 Q34 38 39 31 Z" fill={k.fin} />
      <circle cx="45" cy="17" r="4.2" fill="#ffffff" />
      <circle cx="46" cy="17" r="2.2" fill="#0f172a" />
      <path d="M52 24 Q50 26 48 25" stroke="#0f172a" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  );
};

// The same number from the same id on every phone: a fish keeps its lane.
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};

const CSS = `
@keyframes aq-swim { 0% { transform: translateX(3%); } 50% { transform: translateX(80%); } 100% { transform: translateX(3%); } }
@keyframes aq-face { 0%, 49.9% { transform: scaleX(1); } 50%, 99.9% { transform: scaleX(-1); } 100% { transform: scaleX(1); } }
@keyframes aq-bob { 0%, 100% { transform: translateY(-3px); } 50% { transform: translateY(3px); } }
@keyframes aq-rise { from { transform: translateY(0); opacity: 0.85; } to { transform: translateY(-100%); opacity: 0; } }
@keyframes aq-wobble { 0%, 100% { transform: translateX(-2px); } 50% { transform: translateX(2px); } }
@keyframes aq-fall { from { transform: translateY(-4%); opacity: 1; } to { transform: translateY(100%); opacity: 0.2; } }
@keyframes aq-sway { 0%, 100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }
.aq-lane { position: absolute; left: 0; right: 0; animation: aq-swim var(--d) ease-in-out var(--delay) infinite; }
.aq-face { width: clamp(34px, 14cqmin, 64px); aspect-ratio: 3 / 2; animation: aq-face var(--d) linear var(--delay) infinite; }
.aq-bob { width: 100%; height: 100%; animation: aq-bob 3.2s ease-in-out var(--delay) infinite; }
.aq-col { position: absolute; top: 0; bottom: 0; width: 12px; animation: aq-rise var(--d) linear var(--delay) infinite; }
.aq-bubble { position: absolute; bottom: 0; border-radius: 50%; border: 1.5px solid rgb(255 255 255 / 0.75); background: rgb(255 255 255 / 0.15); animation: aq-wobble 1.4s ease-in-out infinite; }
.aq-flake { position: absolute; top: 0; bottom: 0; width: 6px; animation: aq-fall 6s linear var(--delay) both; }
.aq-weed { position: absolute; bottom: -6px; transform-origin: 50% 100%; animation: aq-sway var(--d) ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .aq-lane, .aq-face, .aq-bob, .aq-col, .aq-bubble, .aq-weed { animation: none; } }
`;

export default function App() {
  const w = WORDS[language()] ?? WORDS.en;
  const [state, apply] = useSharedState();
  const members = useRoomMembers();
  const now = useNow(1000);
  const sound = useSound();
  const haptic = useHaptic();
  const me = Spiral.viewer;

  const nameOf = (id) => members?.find((m) => m.userId === id)?.displayName ?? id.replace(/^@/, "").split(":")[0];
  const by = isObject(state.by) ? state.by : {};
  // Every fish counts; only fourteen are DRAWN, the viewer's among them. The
  // cut came before the count: the fifteenth owner's fish was nowhere, and
  // they were offered «add a fish» for ever (§ 5.80).
  const owned = Object.entries(by)
    .filter(([, own]) => isObject(own) && isObject(own.fish))
    .map(([id, own]) => ({ id, owner: id, kind: kindOf(own.fish.kind), at: Number(own.fish.at) || 0 }))
    .sort((a, b) => a.at - b.at);
  const myFish = owned.find((f) => f.owner === me);
  const drawn = [...owned.slice(0, 14).filter((f) => f !== myFish), ...(myFish ? [myFish] : [])].slice(-14);
  // Two house fish until someone brings their own, so the tank is never empty.
  const fish = drawn.length ? drawn : [{ id: "house-a", kind: 0 }, { id: "house-b", kind: 1 }];
  // A tank nobody has fed counts from its first fish: a new tank was hungry
  // the moment the first fish went in.
  const fedAt = Number(state.fedAt) || owned[0]?.at || 0;
  const hungry = now !== undefined && owned.length > 0 && now - fedAt > HUNGRY_MS;
  // Food falls for everyone watching when someone feeds — once, keyed to
  // that feed, and not on opening a tank fed a minute ago.
  const [feeding, setFeeding] = useState(0);
  useChanged(fedAt, (t) => setFeeding(t));
  const falling = feeding > 0 && feeding === fedAt && now !== undefined && now - fedAt < FLAKES_MS;

  // The host's clock, not this phone's: a feed is «3 h ago» on every phone.
  const myName = nameOf(me);
  // One tap, one action: the clock is asked first, and a second tap while
  // it answers wrote the fish twice.
  const busy = useRef(false);
  const once = (act) => async () => {
    if (busy.current) return;
    busy.current = true;
    try { await act(); } finally { busy.current = false; }
  };
  const add = once(async () => {
    sound("pop");
    haptic("medium");
    const at = await Spiral.time.now();
    await apply({ set: { path: Spiral.mine("fish"), value: { kind: Math.floor(Math.random() * KINDS.length), at } } }, summary({ line: every((w) => w.adds(myName)) }));
  });
  const change = () => {
    if (!myFish) return;
    apply({ set: { path: Spiral.mine("fish", "kind"), value: (myFish.kind + 1) % KINDS.length } });
    sound("tap");
    haptic("light");
  };
  const feed = once(async () => {
    sound("pick");
    haptic("light");
    const at = await Spiral.time.now();
    await apply({ set: { path: "fedAt", value: at } }, summary({ line: every((w) => w.feeds(myName)) }));
  });

  const minutes = now !== undefined && Number(state.fedAt) > 0 ? Math.max(0, Math.floor((now - fedAt) / 60000)) : null;
  const status = `${owned.length ? w.fish(owned.length) : w.empty}${owned.length ? ` · ${minutes === null ? w.never : w.fed(w.ago(minutes))}` : ""}`;

  // Water to the edge (§ 5.76): a teal that deepens to dark gravel, light
  // falling through it, weed swaying, a bubbler, and the chat's fish.
  const water = [
    "linear-gradient(100deg, transparent 18%, rgb(255 255 255 / 0.05) 26%, transparent 34%)",
    "linear-gradient(80deg, transparent 52%, rgb(255 255 255 / 0.04) 60%, transparent 68%)",
    "radial-gradient(circle at 20% 6px, #57534e 0 2px, transparent 3px) left bottom / 23px 14px repeat-x",
    "radial-gradient(circle at 60% 9px, #78716c 0 2.5px, transparent 3.5px) left bottom / 31px 16px repeat-x",
    "linear-gradient(180deg, #292524, #1c1917) left bottom / 100% 64px no-repeat",
    "linear-gradient(180deg, #0e7490, #155e75 55%, #164e63)",
  ].join(", ");
  return (
    <Scene theme="night" bg={water}>
      <style>{CSS}</style>
      <Stack>
        <Text variant="title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{hungry ? w.hungry : w.title}</Text>
        <Fill>
          <div style={{ position: "relative", height: "100%", overflow: "hidden" }} aria-hidden="true">
            {[{ x: 6, h: 46, d: 5.5, c: "#15803d" }, { x: 12, h: 30, d: 4.2, c: "#16a34a" }, { x: 70, h: 38, d: 6.1, c: "#166534" }].map((wd, i) => (
              <svg key={i} className="aq-weed" viewBox="0 0 20 100" preserveAspectRatio="none" style={{ left: `${wd.x}%`, height: `${wd.h}%`, width: "clamp(14px, 6cqmin, 26px)", "--d": `${wd.d}s` }}>
                <path d="M10 100 C2 80 18 62 9 44 C2 30 16 16 10 0 C20 18 8 30 15 46 C22 64 6 80 14 100 Z" fill={wd.c} />
              </svg>
            ))}
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="aq-col" style={{ left: `${86 + (i % 2) * 3}%`, "--d": `${3.4 + i * 0.5}s`, "--delay": `${-i * 0.9}s` }}>
                <div className="aq-bubble" style={{ width: 6 + (i % 3) * 3, height: 6 + (i % 3) * 3 }} />
              </div>
            ))}
            {fish.map((f, i) => {
              const r = hash(f.id);
              const lap = (18 + r * 12) * (hungry ? 1.7 : 1);
              const top = hungry ? 48 + r * 30 : 6 + ((i * 0.37 + r) % 1) * 66;
              return (
                <div key={f.id} className="aq-lane" style={{ top: `${top}%`, "--d": `${lap}s`, "--delay": `${-r * lap}s` }}>
                  <div className="aq-face">
                    <div className="aq-bob"><Fish kind={f.kind} /></div>
                  </div>
                </div>
              );
            })}
            {falling && Array.from({ length: 12 }, (_, i) => (
              <div key={`${fedAt}-${i}`} className="aq-flake" style={{ left: `${10 + ((i * 0.618) % 1) * 75}%`, "--delay": `${(i % 6) * 0.35}s` }}>
                <div style={{ width: 6, height: 5, borderRadius: 1, background: "#fcd34d", transform: `rotate(${i * 37}deg)` }} />
              </div>
            ))}
          </div>
        </Fill>
        <Only in="expanded">
          <Row between>
            <Meta>{w.whose}: {owned.length ? owned.map((f) => nameOf(f.owner).split(" ")[0]).join(" · ") : "—"}</Meta>
            {myFish && <Button variant="secondary" onPress={change}>{w.change}</Button>}
          </Row>
        </Only>
        {/* Anyone feeds (the catalogue says so); someone without a fish may
            add one too. */}
        <Row between>
          <Meta>{status}</Meta>
          <Row gap={6}>
            {!myFish && <Button variant={owned.length ? "secondary" : "primary"} onPress={add}>{w.add}</Button>}
            {owned.length > 0 && <Button onPress={feed}>{w.feed}</Button>}
          </Row>
        </Row>
      </Stack>
    </Scene>
  );
}
