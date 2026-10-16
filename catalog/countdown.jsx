import { Spiral, useSharedState, useOwnState, useRoomMembers, useNow, useHaptic, useSound, summary } from "@spiral/sdk";
import { Scene, Text, Button, Row, Stack, Fill, Hero, Meta } from "@spiral/ui";

// THE OWNER'S WORDS. The agent writes them from the owner's answer — what
// the event is, and when (local time of the phone reading it) — the words
// as plain strings in the owner's language: one language, as written, for
// every reader. Until then they are the catalogue's example, New Year, and
// an example speaks each viewer's language ({ uk, ru, en }, read through
// `said`, § 5.81).
const EVENT = {
  heading: { uk: "До Нового року", ru: "До Нового года", en: "Until New Year" },
  name: { uk: "Новий рік", ru: "Новый год", en: "New Year" },
  at: "2027-01-01T00:00:00",
  emoji: "🎆",
};

const pad = (n) => String(n).padStart(2, "0");

// One, few, many — Ukrainian and Russian count in three forms.
const slavic = (n, one, few, many) => {
  const d = n % 10;
  const h = n % 100;
  if (h >= 11 && h <= 14) return many;
  if (d === 1) return one;
  if (d >= 2 && d <= 4) return few;
  return many;
};

// The post's own words, in the language of whoever is looking at it.
const WORDS = {
  uk: { days: (n) => slavic(n, "день", "дні", "днів"), hours: "год", minutes: "хв", syncing: "Звіряємо годинник…", arrived: (name) => `${name} — сьогодні!`, join: "Чекаю з вами 🥂", joined: "Я з вами ✓", waiting: (names) => `Чекають: ${names}`, nobody: "Ніхто ще не приєднався — будь першим", line: (name, n) => `Чекають на ${name} разом: ${n}`, passed: (name) => `${name} — уже минуло` },
  ru: { days: (n) => slavic(n, "день", "дня", "дней"), hours: "час", minutes: "мин", syncing: "Сверяем часы…", arrived: (name) => `${name} — сегодня!`, join: "Жду с вами 🥂", joined: "Я с вами ✓", waiting: (names) => `Ждут: ${names}`, nobody: "Никто ещё не присоединился — будь первым", line: (name, n) => `Ждут ${name} вместе: ${n}`, passed: (name) => `${name} — уже прошло` },
  en: { days: (n) => (n === 1 ? "day" : "days"), hours: "hrs", minutes: "min", syncing: "Checking the clock…", arrived: (name) => `${name} — today!`, join: "Waiting with you 🥂", joined: "I'm in ✓", waiting: (names) => `Waiting: ${names}`, nobody: "Nobody yet — be the first", line: (name, n) => `Waiting for ${name} together: ${n}`, passed: (name) => `${name} — already passed` },
};

// The viewer's language — or, from a runtime older than the host saying it,
// the frame's own, which is the phone's.
const language = () => Spiral.language ?? String(navigator.language ?? "").slice(0, 2);
// The owner's words are a string, the same for every reader; the example is
// { uk, ru, en } and follows the viewer.
const said = (words, l = language()) =>
  typeof words === "string" ? words : words?.[l] ?? words?.en ?? Object.values(words ?? {})[0] ?? "";
// The line an action writes to the card, once per language, so each reader's
// phone shows its own (§ 5.68).
const every = (say) => Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, say(w, l)]));

export default function App() {
  const w = WORDS[language()] ?? WORDS.en;
  const [state, apply] = useSharedState();
  const [mine, setMine] = useOwnState();
  const members = useRoomMembers();
  const now = useNow();
  const haptic = useHaptic();
  const sound = useSound();

  const d = now ? new Date(now) : null;
  const target = new Date(EVENT.at).getTime();
  const left = d ? Math.max(0, target - now) : 0;
  // The day itself, from midnight on: the event has arrived.
  const celebrating = d && now >= target && now < target + 86400000;
  // After the day: said so, and nothing left to wait for (§ 5.80). It used
  // to stand at «0 days 00:00» with the button live for ever.
  const passed = d && now >= target + 86400000;
  const total = Math.floor(left / 1000);
  const dd = Math.floor(total / 86400);
  const hh = Math.floor(total / 3600) % 24, mm = Math.floor(total / 60) % 60, ss = total % 60;

  // By user id: the host's own order differs from phone to phone (§ 5.80).
  const waiting = Object.entries(state.by ?? {}).filter(([, own]) => own?.in).map(([id]) => id).sort();
  const nameOf = (id) => members?.find((m) => m.userId === id)?.displayName ?? id.split(":")[0].replace("@", "");
  const joined = !!mine?.in;

  const toggle = () => {
    const next = !joined;
    haptic(next ? "success" : "light");
    sound(next ? "pop" : "tap");
    const n = waiting.length + (next ? 1 : -1);
    // One action. `countdownTo` rides with the line: the card counts down
    // by itself while the post is not running — a chat scrolled past, media
    // hidden, an app the pool took back (§ 5.79).
    setMine("in", next, summary({ line: every((w, l) => w.line(said(EVENT.name, l), Math.max(0, n))), countdownTo: new Date(EVENT.at) }));
  };

  // A poster (§ 5.76): the heading in condensed capitals, the date under
  // it, three numbers read from across the room, and one black button.
  const when = new Date(EVENT.at).toLocaleString(language(), { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const unit = (n, label) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
      <Hero style={{ fontVariantNumeric: "tabular-nums", lineHeight: 0.95 }}>{n}</Hero>
      <Text variant="caption" style={{ textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{label}</Text>
    </div>
  );
  // The colons blink with the seconds, the way a station clock does.
  const colon = <Hero style={{ lineHeight: 0.95, opacity: ss % 2 ? 0.6 : 0.2, transition: "opacity 200ms" }}>:</Hero>;
  return (
    <Scene theme="poster">
      <Stack>
        <div>
          <Text variant="title">{said(EVENT.heading)} {EVENT.emoji}</Text>
          <Text variant="caption">{when}</Text>
        </div>
        <Fill>
          {!d ? <Text variant="body" align="center">{w.syncing}</Text>
            : passed ? <Text variant="title" align="center">{w.passed(said(EVENT.name))}</Text>
            : celebrating ? (
              <div style={{ textAlign: "center" }}>
                <Hero className="s-pop">{EVENT.emoji}</Hero>
                <Text variant="title">{w.arrived(said(EVENT.name))}</Text>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: "clamp(6px, 3cqmin, 16px)" }}>
                {unit(dd, w.days(dd))}{colon}{unit(pad(hh), w.hours)}{colon}{unit(pad(mm), w.minutes)}
              </div>
            )}
        </Fill>
        {!passed && (
          <Row>
            <Button onPress={toggle} variant={joined ? "secondary" : "primary"}>
              {joined ? w.joined : w.join}
            </Button>
          </Row>
        )}
        {/* Two names and «+N» in the row: every name pushed the digits over
            the button from about a dozen (§ 5.80). */}
        <Meta style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {waiting.length
            ? w.waiting(waiting.slice(0, 2).map((id) => nameOf(id).split(" ")[0]).join(", ") + (waiting.length > 2 ? ` +${waiting.length - 2}` : ""))
            : w.nobody}
        </Meta>
      </Stack>
    </Scene>
  );
}
