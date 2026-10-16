import { useEffect, useRef, useState } from "react";
import { Spiral, useSharedState, useRoomMembers, useChanged, useSound, useHaptic, summary } from "@spiral/sdk";
import { Scene, Text, Button, Avatar, Meta, Stack, Fill, Square, Row } from "@spiral/ui";

// One, few, many — Ukrainian and Russian count in three forms.
const slavic = (n, one, few, many) => {
  const d = n % 10;
  const h = n % 100;
  if (h >= 11 && h <= 14) return many;
  if (d === 1) return one;
  if (d >= 2 && d <= 4) return few;
  return many;
};

// The post's own words, in the language of whoever is looking at it: a room
// reads one post, each member in their own app language.
const WORDS = {
  uk: {
    title: "Хто сьогодні? 🎯",
    round: (n) => `Раунд #${n}`,
    picked: "вибір колеса",
    nobody: "Черга не визначена",
    hint: "Крутіть, щоб обрати жеребом",
    spin: "Крутити 🎲",
    again: "Крутити знову 🎲",
    members: (n) => `${n} ${slavic(n, "учасник", "учасники", "учасників")} · результат для всіх`,
    loading: "Завантаження списку…",
    someone: "Учасник",
    line: (name) => `Колесо обрало: ${name} 🎯`,
  },
  ru: {
    title: "Кто сегодня? 🎯",
    round: (n) => `Раунд #${n}`,
    picked: "выбор колеса",
    nobody: "Очередь не определена",
    hint: "Крутите, чтобы выбрать жребием",
    spin: "Крутить 🎲",
    again: "Крутить снова 🎲",
    members: (n) => `${n} ${slavic(n, "участник", "участника", "участников")} · результат для всех`,
    loading: "Загрузка списка…",
    someone: "Участник",
    line: (name) => `Колесо выбрало: ${name} 🎯`,
  },
  en: {
    title: "Who's it today? 🎯",
    round: (n) => `Round #${n}`,
    picked: "picked by the wheel",
    nobody: "Nobody picked yet",
    hint: "Spin to draw a name",
    spin: "Spin 🎲",
    again: "Spin again 🎲",
    members: (n) => `${n} ${n === 1 ? "member" : "members"} · everyone sees the result`,
    loading: "Loading members…",
    someone: "Someone",
    line: (name) => `The wheel picked ${name} 🎯`,
  },
};

// The wheel's own paint — a fair at night, eight bright segments.
const PAINT = ["#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6", "#eab308"];
const short = (name) => {
  const first = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  return first.length > 9 ? `${first.slice(0, 8)}…` : first;
};

// The viewer's language — or, from a runtime older than the host saying it,
// the frame's own, which is the phone's.
const language = () => Spiral.language ?? String(navigator.language ?? "").slice(0, 2);
// The line an action writes to the card, once per language, so each reader's
// phone shows its own (§ 5.68).
const every = (say) => Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, say(w)]));

export default function App() {
  const w = WORDS[language()] ?? WORDS.en;
  const [state, apply] = useSharedState();
  const members = useRoomMembers();
  const sound = useSound();
  const haptic = useHaptic();

  const people = members ?? [];
  const chosenId = state.chosen?.userId;
  const chosenMember = people.find((m) => m.userId === chosenId);
  const currentName = chosenMember?.displayName || state.chosen?.name;
  const avatarUrl = chosenMember?.avatarUrl;
  const spins = state.spins ?? 0;

  const spin = () => {
    // One spin at a time: a second tap during the turn used to spin again and
    // put a second name in the chat before the first had landed (§ 5.80).
    if (people.length === 0 || spinningNow.current) return;
    spunHere.current = true;
    let candidates = people;
    // The last one chosen sits this one out — in a room of three or more. In
    // a room of two that made every «draw of lots» the other person.
    if (people.length > 2 && chosenId) {
      const others = people.filter((m) => m.userId !== chosenId);
      if (others.length > 0) candidates = others;
    }
    const lucky = candidates[Math.floor(Math.random() * candidates.length)];
    const name = lucky.displayName || w.someone;

    sound("pop");
    haptic("medium");

    // What is shared is WHO it landed on, and each phone finds them on its
    // own wheel. It used to share the slice's number, as counted on the
    // spinner's phone — and two phones listed the room in two orders, so the
    // other wheel stopped on someone else (§ 5.79).
    apply(
      {
        batch: {
          ops: [
            { set: { path: "chosen", value: { userId: lucky.userId, name } } },
            { incr: { path: "spins", by: 1 } }
          ]
        }
      },
      summary({ line: every((w) => w.line(name)) })
    );
  };

  // The wheel: n segments from the top, clockwise; turned so that the chosen
  // one's middle (a little off it, differently each round) is under the
  // pointer, four more turns every spin so it always runs forward.
  const n = Math.max(people.length, 1);
  const seg = 360 / n;
  const at = people.findIndex((m) => m.userId === chosenId);
  const jitter = (((spins * 37) % 60) - 30) / 100;
  const target = at >= 0 && spins > 0 ? spins * 4 * 360 + (360 - (at + 0.5 + jitter * 0.8) * seg) : 0;

  // The wheel TURNS only when someone spins while it is on screen. Opened
  // later, it stands where it stopped: the state arrives a moment after the
  // first frame, and a wheel that spun from nothing on every open would spin
  // in every chat at once. This used to be told apart by time — a change in
  // the first 900 ms was «the post opening» — which a slow first read
  // defeated; `useChanged` KNOWS which is which (§ 5.77). Anything else that
  // moves the target — the post's state arriving, the room's people changing
  // — moves the wheel to where it stands, with no spin.
  const [rest, setRest] = useState(target);
  const [spinning, setSpinning] = useState(false);
  const spinningNow = useRef(false);
  const targetNow = useRef(target);
  targetNow.current = target;
  const spun = useRef(false);
  // Whether THIS phone spun: only the one who spun feels it land. A buzz in
  // the hand of someone scrolling past a post they never touched is noise.
  const spunHere = useRef(false);
  useChanged(spins, (n, before) => {
    if (n > before) spun.current = true;
  });
  useEffect(() => {
    const news = spun.current;
    spun.current = false;
    // A spin with nowhere to turn to (the one it chose has left) is no spin.
    if (news && target !== rest) {
      spinningNow.current = true;
      setSpinning(true);
      return;
    }
    if (!spinningNow.current) setRest(target);
  }, [target, spins]);
  const angle = spinning ? target : rest;
  const landed = () => {
    if (!spinningNow.current) return;
    spinningNow.current = false;
    setRest(targetNow.current);
    setSpinning(false);
    sound("win");
    if (spunHere.current) haptic("success");
    spunHere.current = false;
  };
  // `transitionend` can be missed — a row scrolled away mid-spin — and the
  // wheel lands anyway.
  useEffect(() => {
    if (!spinning) return undefined;
    const t = setTimeout(landed, 3700);
    return () => clearTimeout(t);
  }, [spinning]);
  const slice = (i) => {
    const a0 = ((i * seg - 90) * Math.PI) / 180;
    const a1 = (((i + 1) * seg - 90) * Math.PI) / 180;
    const large = seg > 180 ? 1 : 0;
    return n === 1
      ? "M 50 50 m -48 0 a 48 48 0 1 0 96 0 a 48 48 0 1 0 -96 0"
      : `M 50 50 L ${50 + 48 * Math.cos(a0)} ${50 + 48 * Math.sin(a0)} A 48 48 0 ${large} 1 ${50 + 48 * Math.cos(a1)} ${50 + 48 * Math.sin(a1)} Z`;
  };

  // A fair at night (§ 5.76): the wheel of the room's people, a brass
  // pointer, a spin that slows to the same name on every phone.
  return (
    <Scene theme="night">
      <Stack>
        <Row between>
          <Text variant="title">{w.title}</Text>
          {spins > 0 && <Meta>{w.round(spins)}</Meta>}
        </Row>

        <Square>
          <div style={{ position: "relative", width: "100%", height: "100%" }}>
            <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}>
              <circle cx="50" cy="50" r="49.5" fill="#1e1b4b" stroke="#fbbf24" strokeWidth="1.2" />
              <g
                onTransitionEnd={landed}
                style={{ transformOrigin: "50px 50px", transform: `rotate(${angle}deg)`, transition: spinning ? "transform 3.4s cubic-bezier(0.15, 0.7, 0.2, 1)" : "none" }}
              >
                {people.length === 0
                  ? <circle cx="50" cy="50" r="48" fill="#312e81" />
                  : people.map((m, i) => (
                    <g key={m.userId}>
                      <path d={slice(i)} fill={PAINT[i % PAINT.length]} stroke="#1e1b4b" strokeWidth="0.6" />
                      {n <= 12 && (
                        <text
                          x="50" y="50"
                          transform={n === 1 ? "translate(0 22)" : `rotate(${(i + 0.5) * seg - 90} 50 50) translate(28 0)`}
                          textAnchor="middle" dominantBaseline="central"
                          fontSize={n > 8 ? 5 : 6} fontWeight="800" fill="#ffffff"
                          stroke="#1e1b4b" strokeWidth="1.1" paintOrder="stroke"
                        >
                          {short(m.displayName)}
                        </text>
                      )}
                    </g>
                  ))}
              </g>
              <circle cx="50" cy="50" r="7" fill="#fbbf24" stroke="#1e1b4b" strokeWidth="1.2" />
              <path d="M 50 9 L 44.5 -1.5 L 55.5 -1.5 Z" fill="#fbbf24" stroke="#1e1b4b" strokeWidth="1" />
            </svg>
          </div>
        </Square>

        <Row between>
          <Button onPress={spin} disabled={people.length === 0 || spinning}>
            {spins > 0 ? w.again : w.spin}
          </Button>
          {currentName && !spinning && (
            <Row>
              <Avatar name={currentName} userId={chosenId} src={avatarUrl} size={28} />
              <Text variant="body" style={{ fontWeight: 700 }}>{short(currentName)}</Text>
            </Row>
          )}
        </Row>

        <Meta>
          {members ? (currentName && !spinning ? `${currentName} · ${w.picked}` : w.members(people.length)) : w.loading}
        </Meta>
      </Stack>
    </Scene>
  );
}
