import { Spiral, useSharedState, useOwnState, useRoomMembers, summary } from "@spiral/sdk";
import { Scene, Text, Choice, Stack, Fill, Meta } from "@spiral/ui";

// THE OWNER'S WORDS. The agent writes them from the owner's answer — the
// question and its options — as plain strings in the owner's language: one
// language, as written, for every reader. Until then they are the
// catalogue's example, a weekend trip, and an example speaks each viewer's
// language ({ uk, ru, en }, read through `said`, § 5.81).
const QUESTION = { uk: "Куди їдемо на вихідні?", ru: "Куда едем на выходные?", en: "Where shall we go this weekend?" };
const OPTIONS = [
  { id: "lviv", label: { uk: "Львів", ru: "Львов", en: "Lviv" } },
  { id: "karpaty", label: { uk: "Карпати", ru: "Карпаты", en: "The Carpathians" } },
  { id: "odesa", label: { uk: "Одеса", ru: "Одесса", en: "Odesa" } },
];

// The post's own words, in the language of whoever is looking at it.
const WORDS = {
  uk: { votes: (n) => `Голосів: ${n}`, none: "Ще ніхто не голосував", change: "голос можна змінити", line: (name, label, n) => `${name} за ${label} · голосів: ${n}` },
  ru: { votes: (n) => `Голосов: ${n}`, none: "Пока никто не голосовал", change: "голос можно изменить", line: (name, label, n) => `${name} за ${label} · голосов: ${n}` },
  en: { votes: (n) => `Votes: ${n}`, none: "No votes yet", change: "you can change your vote", line: (name, label, n) => `${name} for ${label} · votes: ${n}` },
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

const shortId = (id) => String(id).replace(/^@/, "").split(":")[0];

export default function App() {
  const w = WORDS[language()] ?? WORDS.en;
  const [state, apply] = useSharedState();
  const [mine, setMine] = useOwnState();
  const members = useRoomMembers();

  const nameOf = (userId) => {
    const m = Array.isArray(members) ? members.find((x) => x.userId === userId) : undefined;
    return m?.displayName || shortId(userId);
  };

  // By user id: the host's own order is its dictionary's, and differs from
  // phone to phone (§ 5.80).
  const entries = Object.entries(state?.by ?? {})
    .map(([userId, own]) => [userId, own?.vote])
    .filter(([, v]) => OPTIONS.some((o) => o.id === v))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const total = entries.length;
  const votersOf = (id) => entries.filter(([, v]) => v === id).map(([u]) => nameOf(u));

  const pick = (id) => {
    if (mine?.vote === id) return;
    const label = OPTIONS.find((o) => o.id === id)?.label;
    const next = total + (mine?.vote ? 0 : 1);
    setMine("vote", id, summary({ line: every((w, l) => w.line(nameOf(Spiral.viewer), said(label, l), next)) }));
  };

  // The sky (§ 5.76): the question, and the options on the scene's glass
  // with the share of the vote behind each and who voted for it.
  return (
    <Scene theme="sky">
      <Stack>
        <Text variant="title">{said(QUESTION)}</Text>
        <Fill>
          <Stack>
            {OPTIONS.map((o) => {
              const names = votersOf(o.id);
              return (
                <Choice
                  key={o.id}
                  label={said(o.label)}
                  onPress={() => pick(o.id)}
                  picked={mine?.vote === o.id}
                  share={total ? names.length / total : undefined}
                  // Two names and «+N»: a list of every voter wrapped the
                  // choices off the bottom of the row (§ 5.80).
                  detail={names.length ? `${names.length} · ${names.slice(0, 2).map((n) => n.split(" ")[0]).join(", ")}${names.length > 2 ? ` +${names.length - 2}` : ""}` : undefined}
                />
              );
            })}
          </Stack>
        </Fill>
        <Meta>{total ? w.votes(total) : w.none} · {w.change}</Meta>
      </Stack>
    </Scene>
  );
}
