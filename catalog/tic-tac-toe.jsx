import { useState } from "react";
import { Spiral, useSharedState, useRoomMembers, useSeats, useChanged, useSound, useHaptic, summary } from "@spiral/sdk";
import { Scene, Text, Button, Row, Stack, Board, Meta, accent } from "@spiral/ui";

// The post's own words, in the language of whoever is looking at it.
const WORDS = {
  uk: {
    title: "Хрестики-нулики",
    turn: (m) => `Хід ${m}`,
    seat: "місце вільне",
    you: "ви",
    won: (m, n) => `${m} перемагає${n ? " · " + n : ""}`,
    draw: "Нічия",
    moved: (n, m) => `${n} поставив ${m}`,
    newGame: "Нова гра",
    fresh: "Нова гра · хід X",
    take: (m) => `Грати за ${m}`,
    watch: "Двоє грають, решта дивиться",
    mine: (m) => `Ви граєте за ${m}`,
    round: (n) => `Партія ${n}`,
  },
  ru: {
    title: "Крестики-нолики",
    turn: (m) => `Ход ${m}`,
    seat: "место свободно",
    you: "вы",
    won: (m, n) => `${m} побеждает${n ? " · " + n : ""}`,
    draw: "Ничья",
    moved: (n, m) => `${n} поставил ${m}`,
    newGame: "Новая игра",
    fresh: "Новая игра · ход X",
    take: (m) => `Играть за ${m}`,
    watch: "Двое играют, остальные смотрят",
    mine: (m) => `Вы играете за ${m}`,
    round: (n) => `Партия ${n}`,
  },
  en: {
    title: "Tic-tac-toe",
    turn: (m) => `${m} to move`,
    seat: "seat open",
    you: "you",
    won: (m, n) => `${m} wins${n ? " · " + n : ""}`,
    draw: "Draw",
    moved: (n, m) => `${n} placed ${m}`,
    newGame: "New game",
    fresh: "New game · X to move",
    take: (m) => `Play as ${m}`,
    watch: "Two play, the rest watch",
    mine: (m) => `You play ${m}`,
    round: (n) => `Game ${n}`,
  },
};

// The viewer's language — or, from a runtime older than the host saying it,
// the frame's own, which is the phone's.
const language = () => Spiral.language ?? String(navigator.language ?? "").slice(0, 2);
// The line an action writes to the card, once per language, so each reader's
// phone shows its own (§ 5.68).
const every = (say) => Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, say(w)]));

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const winnerOf = (cells) => {
  for (const [a, b, c] of LINES) {
    if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) return { mark: cells[a], line: [a, b, c] };
  }
  return null;
};

export default function App() {
  const w = WORDS[language()] ?? WORDS.en;
  const [state, apply] = useSharedState();
  const members = useRoomMembers();
  const sound = useSound();
  const haptic = useHaptic();

  const me = Spiral.viewer;
  // Who plays which mark, and whom a move tells (§ 5.75): the other seat's
  // player as «your move»; a free seat's only possible player — the other
  // person in a two-person chat — as «you are challenged».
  const seats = useSeats(["X", "O"]);
  const players = seats.who;
  const game = Number(state.game) || 0;

  // The board, REPLAYED from the moves — each a cell, a game and who made
  // it — and a move counts only when it is its seat's player's turn and the
  // cell is free. It used to be the whole board, written whole: a tap in the
  // moment before a post's state arrives wrote an empty board with one mark
  // over a game in progress, for everyone; and two people taking one seat at
  // once could both have played (§ 5.80).
  const cells = Array(9).fill("");
  let last = -1;
  let turn = "X";
  for (const m of Array.isArray(state.moves) ? state.moves : []) {
    if (!isObject(m) || m.g !== game || !Number.isInteger(m.i) || m.i < 0 || m.i > 8) continue;
    if (winnerOf(cells) || cells.every(Boolean)) break;
    if (cells[m.i] || m.by !== players[turn]) continue;
    cells[m.i] = turn;
    last = m.i;
    turn = turn === "X" ? "O" : "X";
  }
  const filled = cells.filter(Boolean).length;
  const win = winnerOf(cells);
  const draw = !win && filled === 9;
  const over = Boolean(win || draw);

  const nameOf = (id) => {
    if (!id) return null;
    if (id === me) return w.you;
    return members?.find((m) => m.userId === id)?.displayName ?? id.split(":")[0].replace("@", "");
  };
  const myMark = players.X === me ? "X" : players.O === me ? "O" : null;
  const seatOpen = !players.X || !players.O;
  const mine = !over && myMark === turn;

  // A move that lands while the post is open: the mark pops in, and whoever
  // did not make it hears it; the end is heard on both phones.
  const [popAt, setPopAt] = useState(-1);
  useChanged(filled, (n, before) => {
    if (n <= before) return;
    setPopAt(last);
    if (cells[last] !== myMark && myMark) { sound("tap"); haptic("light"); }
  });
  useChanged(win ? win.mark : draw ? "draw" : "", (now) => {
    if (!now || !myMark) return;
    sound(now === myMark ? "win" : now === "draw" ? "pop" : "lose");
    haptic(now === myMark ? "success" : "light");
  });

  const title = win ? w.won(win.mark, nameOf(players[win.mark]))
    : draw ? w.draw
    : `${w.turn(turn)} · ${players[turn] ? nameOf(players[turn]) : w.seat}`;

  const place = (i) => {
    if (over || cells[i]) return;
    const ops = [];
    // The first two to touch the board take the seats — in the same action
    // as their move, so the move cannot arrive without its player — and the
    // rest watch.
    if (!myMark) {
      if (!seatOpen || players[turn]) return;
      ops.push({ setIfAbsent: { path: ["seats", turn], value: me } });
    } else if (!mine) {
      return;
    }
    ops.push({ listAppend: { path: "moves", item: { g: game, i, by: me } } });
    const next = cells.slice();
    next[i] = turn;
    const result = winnerOf(next);
    const name = members?.find((m) => m.userId === me)?.displayName ?? "";
    const nextMark = turn === "X" ? "O" : "X";
    const ended = Boolean(result) || next.every(Boolean);
    const line = every((w) => (result ? w.won(turn, name) : next.every(Boolean) ? w.draw : w.moved(name, turn)));
    // A move tells the other player it is theirs; the last one tells them
    // how it ended — never «your move» on a finished board (§ 5.74).
    const other = players[nextMark];
    const told = ended ? { result: other !== me ? other : undefined } : seats.ping(nextMark);
    apply(ops.length === 1 ? ops[0] : { batch: { ops } }, summary({ line, ...told }));
    sound("tap");
    haptic("light");
  };

  // The next game by number — the same from both phones pressing at once —
  // and the board cleared; X opens it, and is told.
  const reset = () => {
    apply({ batch: { ops: [
      { set: { path: "moves", value: [] } },
      { set: { path: "game", value: game + 1 } },
    ] } }, summary({ line: every((w) => w.fresh), ...seats.ping("X") }));
    sound("pop");
    haptic("medium");
  };

  // A notebook page: the grid drawn in ink between the cells, the marks in
  // marker — X in the scene's blue, O in its red — and a winning line gone
  // over with a highlighter (§ 5.76); the last mark faintly shaded, so a
  // player coming back sees what was played.
  const INK = "#334155";
  return (
    <Scene theme="paper">
      <Stack>
        <Row between>
          <div style={{ minWidth: 0, flex: "1 1 auto" }}>
            <Text variant="title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</Text>
          </div>
          {game > 0 && <Meta>{w.round(game + 1)}</Meta>}
        </Row>
        <Board cols={3}>
          {cells.map((c, i) => {
            const onLine = win?.line.includes(i);
            return (
              <div
                key={i}
                onClick={() => place(i)}
                style={{
                  borderRight: i % 3 < 2 ? `3px solid ${INK}` : "none",
                  borderBottom: i < 6 ? `3px solid ${INK}` : "none",
                  background: onLine ? "rgb(253 224 71 / 0.55)" : i === last && !over ? "rgb(100 116 139 / 0.14)" : "transparent",
                  cursor: "pointer",
                }}
              >
                {c && (
                  <span
                    key={popAt === i ? `pop-${filled}` : "still"}
                    className={popAt === i ? "s-pop" : undefined}
                    style={{ fontFamily: "\"Marker Felt\", Noteworthy, ui-rounded, sans-serif", fontWeight: 700, color: c === "X" ? accent(0) : accent(1) }}
                  >
                    {c}
                  </span>
                )}
              </div>
            );
          })}
        </Board>
        <Row between>
          <Meta>
            {myMark ? w.mine(myMark) : seatOpen ? w.take(players.X ? "O" : "X") : w.watch}
          </Meta>
          {over
            ? <Button onPress={reset}>{w.newGame}</Button>
            : <Meta>X · {nameOf(players.X) ?? "—"} &nbsp; O · {nameOf(players.O) ?? "—"}</Meta>}
        </Row>
      </Stack>
    </Scene>
  );
}
