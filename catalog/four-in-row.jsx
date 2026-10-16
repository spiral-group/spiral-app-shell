import { useMemo, useState } from "react";
import { Spiral, useSharedState, useRoomMembers, useSeats, useChanged, useSound, useHaptic, summary } from "@spiral/sdk";
import { Scene, Text, Button, Row, Stack, Board, Meta, Only } from "@spiral/ui";

const COLS = 7;
const ROWS = 6;

// The post's own words, in the language of whoever is looking at it.
const WORDS = {
  // `by` is the side as what one plays WITH: «грає червоними», like «грати білими».
  uk: {
    R: "червоні", Y: "жовті", by: { R: "червоними", Y: "жовтими" }, turn: (s) => `Хід: ${s}`, free: "місце вільне", you: "ви",
    won: (s, n) => `${s} перемагають${n ? " · " + n : ""}`, draw: "Нічия",
    moved: (n, s, c) => `${n} (${s}) — стовпчик ${c}`,
    newGame: "Нова гра", fresh: "Нова гра · хід червоних", mine: (s) => `Ви граєте ${s}`,
    take: (s) => `Торкніться стовпчика — граєте ${s}`, watch: "Двоє грають, решта дивиться",
  },
  ru: {
    R: "красные", Y: "жёлтые", by: { R: "красными", Y: "жёлтыми" }, turn: (s) => `Ход: ${s}`, free: "место свободно", you: "вы",
    won: (s, n) => `${s} побеждают${n ? " · " + n : ""}`, draw: "Ничья",
    moved: (n, s, c) => `${n} (${s}) — столбец ${c}`,
    newGame: "Новая игра", fresh: "Новая игра · ход красных", mine: (s) => `Вы играете ${s}`,
    take: (s) => `Коснитесь столбца — играете ${s}`, watch: "Двое играют, остальные смотрят",
  },
  en: {
    R: "Red", Y: "Yellow", by: { R: "Red", Y: "Yellow" }, turn: (s) => `${s} to move`, free: "seat open", you: "you",
    won: (s, n) => `${s} wins${n ? " · " + n : ""}`, draw: "Draw",
    moved: (n, s, c) => `${n} (${s}) — column ${c}`,
    newGame: "New game", fresh: "New game · Red to move", mine: (s) => `You play ${s}`,
    take: (s) => `Tap a column to play ${s}`, watch: "Two play, the rest watch",
  },
};
const language = () => Spiral.language ?? String(navigator.language ?? "").slice(0, 2);
const every = (say) => Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, say(w)]));

// The board from the moves: a list of columns, red first. A move into a full
// column is not a move — nor one made by anyone but the player whose turn it
// is (§ 5.80): two people taking one side at once could both have dropped a
// disc, and a spectator's tap in the moment before the state arrived could
// play for whoever was to move.
const replay = (moves, who) => {
  const cells = Array(COLS * ROWS).fill("");
  let turn = "R", last = -1;
  for (const m of moves) {
    const c = m?.c;
    if (!Number.isInteger(c) || c < 0 || c >= COLS) continue;
    if (m.by !== who[turn]) continue;
    let r = ROWS - 1;
    while (r >= 0 && cells[r * COLS + c]) r -= 1;
    if (r < 0) continue;
    cells[r * COLS + c] = turn;
    last = r * COLS + c;
    turn = turn === "R" ? "Y" : "R";
  }
  return { cells, turn, last };
};

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
const winnerOf = (cells) => {
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const s = cells[r * COLS + c];
      if (!s) continue;
      for (const [dr, dc] of DIRS) {
        const line = [0, 1, 2, 3].map((k) => [r + dr * k, c + dc * k]);
        if (line.every(([rr, cc]) => rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && cells[rr * COLS + cc] === s)) {
          return { side: s, line: line.map(([rr, cc]) => rr * COLS + cc) };
        }
      }
    }
  }
  return null;
};

const DISC = { R: "radial-gradient(circle at 35% 30%, #fca5a5, #ef4444 45%, #b91c1c)", Y: "radial-gradient(circle at 35% 30%, #fef08a, #facc15 45%, #ca8a04)" };

export default function App() {
  const w = WORDS[language()] ?? WORDS.en;
  const [state, apply] = useSharedState();
  const members = useRoomMembers();
  const seats = useSeats(["R", "Y"]);
  const sound = useSound();
  const haptic = useHaptic();
  const me = Spiral.viewer;

  const moves = Array.isArray(state.moves) ? state.moves : [];
  const key = JSON.stringify([moves, seats.who]);
  const { cells, turn, last } = useMemo(() => replay(moves, seats.who), [key]);
  const win = winnerOf(cells);
  const full = cells.every(Boolean);
  const over = Boolean(win || full);
  const myName = members?.find((m) => m.userId === me)?.displayName ?? "";
  const mine = seats.mine;
  // A disc that lands while the post is open falls into place (never again
  // on opening); whoever did not drop it hears it; the end is heard on both.
  const count = cells.filter(Boolean).length;
  const [dropAt, setDropAt] = useState(-1);
  useChanged(count, (n, before) => {
    if (n <= before) return;
    setDropAt(last);
    if (mine && cells[last] !== mine) { sound("pop"); haptic("light"); }
  });
  useChanged(win ? win.side : full ? "draw" : "", (now) => {
    if (!now || !mine) return;
    sound(now === mine ? "win" : now === "draw" ? "pop" : "lose");
    haptic(now === mine ? "success" : "light");
  });

  const title = win ? w.won(w[win.side], seats.who[win.side] === me ? w.you : seats.name(win.side))
    : full ? w.draw
    : `${w.turn(w[turn])} · ${seats.who[turn] === me ? w.you : seats.name(turn) ?? w.free}`;

  const drop = (c) => {
    if (over) return;
    // The first to touch the board takes the side to move — in the same
    // action as the disc, so the disc cannot arrive without its player — and
    // the rest watch.
    const ops = [];
    if (!mine) {
      if (seats.who[turn]) return;
      ops.push({ setIfAbsent: { path: ["seats", turn], value: me } });
    } else if (seats.who[turn] !== me) {
      return;
    }
    let r = ROWS - 1;
    while (r >= 0 && cells[r * COLS + c]) r -= 1;
    if (r < 0) return;
    const next = cells.slice();
    next[r * COLS + c] = turn;
    const result = winnerOf(next);
    const ended = Boolean(result) || next.every(Boolean);
    const other = turn === "R" ? "Y" : "R";
    const line = every((w) => (result ? w.won(w[turn], myName) : ended ? w.draw : w.moved(myName, w[turn], c + 1)));
    const told = ended ? { result: seats.who[other] !== me ? seats.who[other] : undefined } : seats.ping(other);
    ops.push({ listAppend: { path: "moves", item: { id: Math.random().toString(36).slice(2, 8), c, by: me } } });
    apply(ops.length === 1 ? ops[0] : { batch: { ops } }, summary({ line, ...told }));
    sound("pop");
    haptic("light");
  };

  const reset = () => {
    apply({ set: { path: "moves", value: [] } }, summary({ line: every((w) => w.fresh), ...seats.ping("R") }));
    sound("pop");
  };

  // A walnut table (§ 5.76) with the blue plastic frame of the classic game;
  // a disc falls into its column, the last one keeps a thin ring so a player
  // coming back sees the reply, the winning four get a white one.
  return (
    <Scene theme="board">
      <style>{`@keyframes fr-drop { from { transform: translateY(var(--from)); } to { transform: none; } } .fr-drop { animation: fr-drop 360ms cubic-bezier(0.5, 0, 0.75, 1.3) both; }`}</style>
      <Stack>
        <Text variant="title" style={{ paddingRight: 34, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</Text>
        <Board cols={COLS} rows={ROWS} style={{ background: "#1d4ed8", padding: 3, borderRadius: 10, boxShadow: "0 3px 0 #1e3a8a" }}>
          {cells.map((s, i) => {
            const onLine = win?.line.includes(i);
            const row = Math.floor(i / COLS);
            return (
              <div key={i} onClick={() => drop(i % COLS)} style={{ padding: "8%", overflow: "visible", zIndex: i === dropAt ? 1 : undefined }}>
                <div
                  key={i === dropAt ? `drop-${count}` : "still"}
                  className={s && i === dropAt ? "fr-drop" : undefined}
                  style={{
                    "--from": `-${(row + 1) * 115}%`,
                    width: "100%", height: "100%", borderRadius: "50%",
                    background: s ? DISC[s] : "#0b1a4a",
                    boxShadow: onLine ? "0 0 0 3px #ffffff" : s && i === last ? "0 0 0 2px rgb(255 255 255 / 0.75), inset 0 -2px 0 rgb(0 0 0 / 0.25)" : s ? "inset 0 -2px 0 rgb(0 0 0 / 0.25)" : "inset 0 2px 3px rgb(0 0 0 / 0.5)",
                  }}
                />
              </div>
            );
          })}
        </Board>
        <Row between>
          <Meta>{mine ? w.mine(w.by[mine]) : !seats.full ? w.take(w.by[turn]) : w.watch}</Meta>
          {over && <Button onPress={reset}>{w.newGame}</Button>}
        </Row>
        <Only in="expanded">
          <Meta>{w.R} · {seats.name("R") ?? "—"} &nbsp; {w.Y} · {seats.name("Y") ?? "—"}</Meta>
        </Only>
      </Stack>
    </Scene>
  );
}
