import { useState } from "react";
import { Spiral, useSharedState, useOwnState, useRoomMembers, useChanged, summary } from "@spiral/sdk";
import { Scene, Text, Stack, Fill, Meta, Only, List, Avatar, Row, accent } from "@spiral/ui";

const MOOD_IDS = ["great", "good", "meh", "sad", "tired"];
const EMOJI = { great: "😄", good: "🙂", meh: "😐", sad: "😔", tired: "😫" };
// The colour a mood is in the bar — by meaning, not by position: green for
// great, red for tired (the kit's six: blue, red, green, violet, amber, teal).
const HUE = { great: 2, good: 0, meh: 4, sad: 3, tired: 1 };

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
  uk: {
    title: "Який у тебе настрій?",
    labels: { great: "Чудово", good: "Добре", meh: "Так собі", sad: "Сумно", tired: "Втома" },
    votes: (n) => `${n} ${slavic(n, "голос", "голоси", "голосів")}`,
    most: "найбільше",
    hint: "Обери емодзі — побачиш, як у всіх",
    line: (n) => `Настрій дня: ${n} ${slavic(n, "голос", "голоси", "голосів")}`,
  },
  ru: {
    title: "Какое у тебя настроение?",
    labels: { great: "Отлично", good: "Хорошо", meh: "Так себе", sad: "Грустно", tired: "Устал(а)" },
    votes: (n) => `${n} ${slavic(n, "голос", "голоса", "голосов")}`,
    most: "больше всего",
    hint: "Выбери эмодзи — увидишь, как у всех",
    line: (n) => `Настроение дня: ${n} ${slavic(n, "голос", "голоса", "голосов")}`,
  },
  en: {
    title: "How are you feeling?",
    labels: { great: "Great", good: "Good", meh: "So-so", sad: "Sad", tired: "Tired" },
    votes: (n) => `${n} ${n === 1 ? "vote" : "votes"}`,
    most: "mostly",
    hint: "Pick an emoji — see how everyone is",
    line: (n) => `Mood of the day: ${n} ${n === 1 ? "vote" : "votes"}`,
  },
};

// The viewer's language — or, from a runtime older than the host saying it,
// the frame's own, which is the phone's.
const language = () => Spiral.language ?? String(navigator.language ?? "").slice(0, 2);
// The line an action writes to the card, once per language, so each reader's
// phone shows its own (§ 5.68).
const every = (say) => Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, say(w)]));

export default function App() {
  const w = WORDS[language()] ?? WORDS.en;
  const MOODS = MOOD_IDS.map((id) => ({ id, emoji: EMOJI[id], label: w.labels[id] }));
  const [state, apply] = useSharedState();
  const [mine, setMine] = useOwnState();
  const members = useRoomMembers();
  const by = state?.by ?? {};
  // By user id: the host's own order differs from phone to phone (§ 5.80).
  const entries = Object.entries(by)
    .filter(([, own]) => MOODS.some((m) => m.id === own?.mood))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const total = entries.length;
  const count = (id) => entries.filter(([, own]) => own.mood === id).length;
  // «Most of all» only when one mood is ahead: on a tie it named whichever
  // came first in the list.
  const most = Math.max(0, ...MOODS.map((m) => count(m.id)));
  const leaders = MOODS.filter((m) => count(m.id) === most);
  const top = total && leaders.length === 1 ? leaders[0] : null;

  // The face just picked pops — when it is picked, not every time the post
  // opens: the class followed the state, and the state arrives after the
  // first frame (§ 5.80).
  const [popped, setPopped] = useState(null);
  useChanged(mine?.mood ?? "", (now) => setPopped(now || null));

  const pick = (m) => {
    if (mine?.mood === m.id) return;
    const n = total + (mine?.mood ? 0 : 1);
    setMine("mood", m.id, summary({ line: every((w) => w.line(n)) }));
  };

  const nameOf = (id) => members?.find((p) => p.userId === id)?.displayName ?? id.split(":")[0].slice(1);

  // The sky (§ 5.76): five faces on the scene's glass — each one a card to
  // tap, with how many picked it — the viewer's own ringed in the scene's
  // blue, and the room's mood as one bar of the five colours.
  return (
    <Scene theme="sky">
      <Stack>
        <Text variant="title">{w.title}</Text>
        <Fill>
          <div style={{ display: "flex", gap: "clamp(4px, 2cqmin, 10px)", height: "100%", alignItems: "center" }}>
            {MOODS.map((m) => {
              const picked = mine?.mood === m.id;
              return (
                <div
                  key={m.id}
                  role="button"
                  aria-label={m.label}
                  onClick={() => pick(m)}
                  className={picked && popped === m.id ? "s-pop" : undefined}
                  style={{
                    flex: 1, minWidth: 0, height: "min(100%, 30cqmin)", minHeight: 48,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                    borderRadius: 16, cursor: "pointer",
                    background: picked ? "var(--s-control-strong)" : "var(--s-control)",
                    boxShadow: picked ? "inset 0 0 0 2.5px var(--s-accent)" : "none",
                  }}
                >
                  <span style={{ fontSize: "clamp(22px, 9cqmin, 34px)", lineHeight: 1 }}>{m.emoji}</span>
                  <Text variant="body" style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{count(m.id)}</Text>
                </div>
              );
            })}
          </div>
        </Fill>
        <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: "var(--s-control)" }}>
          {total > 0 && MOODS.map((m) => count(m.id) > 0 && (
            <div key={m.id} style={{ width: `${(count(m.id) / total) * 100}%`, background: accent(HUE[m.id]), transition: "width 300ms ease" }} />
          ))}
        </div>
        <Meta>
          {total ? (top ? `${w.votes(total)} · ${w.most} ${top.emoji} ${top.label}` : `${w.votes(total)} · ${leaders.map((m) => m.emoji).join(" ")}`) : w.hint}
        </Meta>
        <Only in="expanded">
          <List items={entries} keyOf={([id]) => id} separated max={20} expandedMax={50}>
            {([id, own]) => {
              const m = MOODS.find((x) => x.id === own.mood);
              return (
                <Row between>
                  <Row>
                    <Avatar name={nameOf(id)} userId={id} src={members?.find((p) => p.userId === id)?.avatarUrl} size={28} />
                    <Text variant="body">{nameOf(id)}</Text>
                  </Row>
                  <Text variant="body">{m.emoji} {m.label}</Text>
                </Row>
              );
            }}
          </List>
        </Only>
      </Stack>
    </Scene>
  );
}
