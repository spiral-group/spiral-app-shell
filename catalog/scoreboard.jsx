import { Spiral, useSharedState, useRoomMembers, useSound, useHaptic, summary } from "@spiral/sdk";
import { Scene, Text, Counter, Row, List, Stack, Fill, Meta, Avatar } from "@spiral/ui";

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
    title: "Рахунок гри",
    loading: "Завантаження гравців…",
    leader: "Лідер",
    leads: (n) => `Лідер має ${n} ${slavic(n, "бал", "бали", "балів")}`,
    leader1: (name, n) => `Попереду ${name}: ${n} ${slavic(n, "бал", "бали", "балів")}`,
    fresh: "Гра щойно почалася",
  },
  ru: {
    title: "Счёт игры",
    loading: "Загрузка игроков…",
    leader: "Лидер",
    leads: (n) => `У лидера ${n} ${slavic(n, "очко", "очка", "очков")}`,
    leader1: (name, n) => `Впереди ${name}: ${n} ${slavic(n, "очко", "очка", "очков")}`,
    fresh: "Игра только началась",
  },
  en: {
    title: "Scoreboard",
    loading: "Loading players…",
    leader: "Leader",
    leads: (n) => `The leader has ${n} ${n === 1 ? "point" : "points"}`,
    leader1: (name, n) => `${name} leads with ${n} ${n === 1 ? "point" : "points"}`,
    fresh: "The game has just started",
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
  const [state, apply] = useSharedState();
  const members = useRoomMembers();
  const sound = useSound();
  const haptic = useHaptic();

  // The viewer first, then everyone else in the room's one order: the row
  // shows three, and a viewer fourth by user id could not see — or change —
  // their own score (§ 5.80). Not by score: a list that reorders under a
  // finger moves the button being pressed.
  const people = [...(members ?? [])].sort((a, b) => (a.userId === Spiral.viewer ? -1 : b.userId === Spiral.viewer ? 1 : 0));
  const scores = state.scores ?? {};
  // Two people pressing «−» on a 1 at once add −1 twice; nobody's score is
  // shown below zero.
  const scoreOf = (id) => Math.max(0, Number(scores[id]) || 0);

  const scoreList = people.map((p) => scoreOf(p.userId));
  const maxScore = scoreList.length > 0 ? Math.max(...scoreList) : 0;
  const hasLeader = maxScore > 0;
  const leaders = people.filter((p) => hasLeader && scoreOf(p.userId) === maxScore);

  const updateScore = (p, delta) => {
    if (delta === 0) return;
    sound("tap");
    haptic("light");
    const next = Math.max(0, scoreOf(p.userId) + delta);
    const diff = next - scoreOf(p.userId);
    if (diff === 0) return;

    apply(
      { incr: { path: ["scores", p.userId], by: diff } },
      summary({ line: `${p.displayName}: ${next}` })
    );
  };

  // A pitch under floodlights (§ 5.76): every player's score in the
  // stadium's condensed digits, the leader crowned.
  return (
    <Scene theme="field">
      <Stack>
        <Text variant="title">{w.title}</Text>
        <Fill>
          {people.length === 0 ? (
            <Text variant="caption">{w.loading}</Text>
          ) : (
            <List items={people} keyOf={(p) => p.userId} separated max={3} expandedMax={20}>
              {(p) => {
                const val = scoreOf(p.userId);
                const isLeader = hasLeader && val === maxScore;
                return (
                  <Row style={{ alignItems: "center", gap: 8 }}>
                    <Avatar name={p.displayName} userId={p.userId} src={p.avatarUrl} size={28} />
                    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 4 }}>
                      <Text variant="body" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: isLeader ? 700 : 400 }}>{p.displayName}</Text>
                      {isLeader && <span title={w.leader} style={{ fontSize: 15 }}>👑</span>}
                    </div>
                    <Counter
                      value={val}
                      min={0}
                      onChange={(next) => updateScore(p, next - val)}
                    />
                  </Row>
                );
              }}
            </List>
          )}
        </Fill>
        <Meta>
          {!hasLeader ? w.fresh : leaders.length === 1 ? w.leader1(leaders[0].displayName.split(" ")[0], maxScore) : w.leads(maxScore)}
        </Meta>
      </Stack>
    </Scene>
  );
}