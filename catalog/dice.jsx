import { useState, useRef } from "react";
import { Spiral, useSharedState, useOwnState, useRoomMembers, useFrame, useChanged, useSound, useHaptic, summary } from "@spiral/sdk";
import { Scene, Text, Button, Row, List, Avatar, Meta, Stack, Fill } from "@spiral/ui";

const DICE = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
// Which of a 3×3 grid's cells hold a pip, for each face.
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

// An ivory die on the table, drawn rather than a glyph: pips a reader can
// count from across the room, and a tumble while it is thrown.
function Die({ value, size, turn = 0 }) {
  // The pips sit on a grid INSET from the die's own edges: a padding in %
  // would be a share of the PARENT's width, and a die in a list row came out
  // as wide as the row's padding (first cut, 2026-09-30).
  return (
    <div
      aria-label={value ? String(value) : "?"}
      style={{
        position: "relative", width: size, height: size, flex: "none", borderRadius: "22%",
        background: "radial-gradient(circle at 30% 25%, #ffffff, #efe4d0 70%)",
        boxShadow: "inset 0 -3px 0 rgb(0 0 0 / 0.12), 0 4px 10px rgb(0 0 0 / 0.35)",
        transform: `rotate(${turn}deg)`, transition: "transform 70ms linear",
      }}
    >
      <div style={{ position: "absolute", inset: "16%", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(3, 1fr)" }}>
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0, minHeight: 0 }}>
            {PIPS[value]?.includes(i) && (
              <div style={{ width: "74%", aspectRatio: "1", borderRadius: "50%", background: value === 1 ? "#b91c1c" : "#1c1917" }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// The post's own words, in the language of whoever is looking at it.
const WORDS = {
  uk: {
    title: "Кубик d6",
    you: "Ви",
    youSuffix: "(ви)",
    someone: "Учасник",
    rolling: "Кидаємо…",
    roll: "Кинути кубик",
    total: (n) => `Усього кидків у кімнаті: ${n}`,
    line: (name, die, n) => `${name} кидає кубик: ${die} (${n})`,
  },
  ru: {
    title: "Кубик d6",
    you: "Вы",
    youSuffix: "(вы)",
    someone: "Участник",
    rolling: "Бросаем…",
    roll: "Бросить кубик",
    total: (n) => `Всего бросков в комнате: ${n}`,
    line: (name, die, n) => `${name} бросает кубик: ${die} (${n})`,
  },
  en: {
    title: "Dice (d6)",
    you: "You",
    youSuffix: "(you)",
    someone: "Someone",
    rolling: "Rolling…",
    roll: "Roll the die",
    total: (n) => `Rolls in this room: ${n}`,
    line: (name, die, n) => `${name} rolled ${die} (${n})`,
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
  const [mine] = useOwnState();
  const members = useRoomMembers();
  const sound = useSound();
  const haptic = useHaptic();

  const [rolling, setRolling] = useState(false);
  const [animVal, setAnimVal] = useState(null);
  const [turn, setTurn] = useState(0);
  const animState = useRef({ active: false, elapsed: 0, step: 0, final: 1 });
  const total = Number(state.totalRolls) || 0;

  // The tumble, and only while it lasts: the loop used to run for as long as
  // the post was on screen after the first roll, and the roll itself was
  // decided inside it (§ 5.80).
  useFrame(({ dt }) => {
    const a = animState.current;
    if (!a.active) return;
    a.elapsed += dt;
    if (a.elapsed < 70) return;
    a.elapsed = 0;
    a.step += 1;
    if (a.step < 6) {
      setAnimVal(Math.floor(Math.random() * 6) + 1);
      setTurn((t) => t + 50 + Math.floor(Math.random() * 60));
      sound("tick");
      return;
    }
    a.active = false;
    setRolling(false);
    setAnimVal(null);
    sound("win");
    haptic("medium");
    const myName = members?.find((m) => m.userId === Spiral.viewer)?.displayName ?? w.someone;
    // One action: the roll, WHICH roll of the room's it was — so everyone
    // can see who threw last — and the count.
    apply({ batch: { ops: [
      { set: { path: Spiral.mine("roll"), value: a.final } },
      { set: { path: Spiral.mine("n"), value: total + 1 } },
      { incr: { path: "totalRolls", by: 1 } },
    ] } }, summary({ line: every((w) => w.line(myName, DICE[a.final - 1], a.final)) }));
  }, { running: rolling });

  const myRoll = mine?.roll;
  const currentDisplay = rolling ? (animVal ?? 1) : myRoll;

  const roll = () => {
    if (rolling) return;
    setRolling(true);
    sound("tick");
    haptic("light");
    animState.current = { active: true, elapsed: 0, step: 0, final: Math.floor(Math.random() * 6) + 1 };
    setAnimVal(Math.floor(Math.random() * 6) + 1);
  };

  // Everyone, the viewer first; then whoever threw most recently — a roll
  // from someone else used to change one small die in a list that showed the
  // first three by user id, and in a room of five it was not shown at all.
  const people = members ?? [];
  const by = state.by && typeof state.by === "object" ? state.by : {};
  const rollOf = (id) => by[id]?.roll;
  const seqOf = (id) => Number(by[id]?.n) || 0;
  const items = [];
  if (Spiral.viewer) {
    const me = people.find((p) => p.userId === Spiral.viewer);
    items.push({ userId: Spiral.viewer, displayName: me?.displayName ? `${me.displayName} ${w.youSuffix}` : w.you, avatarUrl: me?.avatarUrl });
  }
  for (const p of [...people].sort((a, b) => seqOf(b.userId) - seqOf(a.userId))) {
    if (p.userId !== Spiral.viewer) items.push(p);
  }
  const latest = total > 0 ? Object.keys(by).reduce((best, id) => (seqOf(id) > seqOf(best ?? "") ? id : best), null) : null;

  // A roll that lands while the post is open: the thrower's small die pops.
  const [popped, setPopped] = useState(null);
  useChanged(total, (n, before) => { if (n > before) setPopped(`${latest}:${n}`); });

  // A walnut table (§ 5.76): one ivory die, thrown with a tumble, and what
  // everyone else threw beside it — the last throw picked out.
  return (
    <Scene theme="board">
      <Stack>
        <Row between>
          <Text variant="title">{w.title}</Text>
          <Meta>{total} 🎲</Meta>
        </Row>

        <Fill>
          <div style={{ display: "flex", alignItems: "center", gap: "clamp(10px, 4cqmin, 20px)", height: "100%" }}>
            <Die value={currentDisplay} size="clamp(64px, 30cqmin, 150px)" turn={rolling ? turn : 0} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <List items={items} keyOf={(it) => it.userId} max={3} expandedMax={20} separated>
                {(it) => (
                  <Row between align="center" gap={8}>
                    <Row align="center" gap={6} style={{ flex: 1, minWidth: 0 }}>
                      <Avatar name={it.displayName} userId={it.userId} src={it.avatarUrl} size={24} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text variant="body" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: it.userId === latest ? 700 : undefined }}>{it.displayName}</Text>
                      </div>
                    </Row>
                    {rollOf(it.userId)
                      ? <div key={popped?.startsWith(`${it.userId}:`) ? popped : "still"} className={popped?.startsWith(`${it.userId}:`) ? "s-pop" : undefined}><Die value={rollOf(it.userId)} size={24} /></div>
                      : <Text variant="caption">—</Text>}
                  </Row>
                )}
              </List>
            </div>
          </div>
        </Fill>

        <Button onPress={roll} variant="primary" disabled={rolling}>
          {rolling ? w.rolling : w.roll}
        </Button>
      </Stack>
    </Scene>
  );
}
