import { useMemo, useState } from "react";
import { Spiral, useSharedState, useRoomMembers, useSeats, useChanged, useSound, useHaptic, summary } from "@spiral/sdk";
import { Scene, Text, Button, Row, Stack, Square, Meta, Only, accent } from "@spiral/ui";

const N = 3; // boxes per side: a 4 × 4 field of dots, a game of 24 lines

// The post's own words, in the language of whoever is looking at it. The
// lines on the card are in the present tense — «Олена закриває квадрат» —
// which has no gender to get wrong.
const WORDS = {
  uk: {
    title: "Крапки й квадрати", yours: "Ваш хід", yoursAgain: "Квадрат! Ваш хід знову",
    turn: (n) => `Хід · ${n}`, again: (n) => `${n} ходить ще раз`, open: "Хід · місце вільне",
    won: (n, a, b) => `${n} перемагає · ${a}:${b}`, youWon: (a, b) => `Ви перемогли · ${a}:${b}`, draw: "Нічия",
    drew: (n) => `${n} проводить лінію`, boxed: (n, k) => `${n} закриває квадрат${k > 1 ? " ×" + k : ""}`,
    newGame: "Нова гра", fresh: "Нова гра", take: "Проведіть лінію — і ви в грі", rule: "Хто закриє квадрат, ходить ще раз",
  },
  ru: {
    title: "Точки и квадраты", yours: "Ваш ход", yoursAgain: "Квадрат! Снова ваш ход",
    turn: (n) => `Ход · ${n}`, again: (n) => `${n} ходит ещё раз`, open: "Ход · место свободно",
    won: (n, a, b) => `${n} побеждает · ${a}:${b}`, youWon: (a, b) => `Вы победили · ${a}:${b}`, draw: "Ничья",
    drew: (n) => `${n} проводит линию`, boxed: (n, k) => `${n} закрывает квадрат${k > 1 ? " ×" + k : ""}`,
    newGame: "Новая игра", fresh: "Новая игра", take: "Проведите линию — и вы в игре", rule: "Кто закроет квадрат, ходит ещё раз",
  },
  en: {
    title: "Dots and boxes", yours: "Your move", yoursAgain: "Box! Your move again",
    turn: (n) => `${n} to move`, again: (n) => `${n} goes again`, open: "Next move · seat open",
    won: (n, a, b) => `${n} wins · ${a}:${b}`, youWon: (a, b) => `You win · ${a}:${b}`, draw: "Draw",
    drew: (n) => `${n} draws a line`, boxed: (n, k) => `${n} closes a box${k > 1 ? " ×" + k : ""}`,
    newGame: "New game", fresh: "New game", take: "Draw a line to play", rule: "Close a box and you go again",
  },
};
const language = () => Spiral.language ?? String(navigator.language ?? "").slice(0, 2);
const every = (say) => Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, say(w)]));

// A line is "h-r-c" (r 0…N, c 0…N-1) or "v-r-c" (r 0…N-1, c 0…N); a box is
// "r-c", closed when all four of its sides are drawn.
const LINES = [];
for (let r = 0; r <= N; r += 1) for (let c = 0; c < N; c += 1) LINES.push(`h-${r}-${c}`);
for (let r = 0; r < N; r += 1) for (let c = 0; c <= N; c += 1) LINES.push(`v-${r}-${c}`);
const sidesOf = (id) => {
  const [k, r, c] = id.split("-");
  const R = Number(r), C = Number(c);
  return k === "h" ? [[R - 1, C], [R, C]] : [[R, C - 1], [R, C]];
};
const isClosed = (drawn, r, c) =>
  r >= 0 && r < N && c >= 0 && c < N &&
  drawn.has(`h-${r}-${c}`) && drawn.has(`h-${r + 1}-${c}`) && drawn.has(`v-${r}-${c}`) && drawn.has(`v-${r}-${c + 1}`);
const closes = (drawn, id) => sidesOf(id).filter(([r, c]) => isClosed(drawn, r, c)).map(([r, c]) => `${r}-${c}`);

// The game from its lines, A first. A line that closes a box keeps the turn.
// A line counts only from the player whose turn it is (§ 5.80): two people
// taking one side at once could both have drawn, and a tap in the moment
// before the post's state arrived could draw for whoever was to move.
const replay = (moves, who) => {
  const drawn = new Set();
  const by = {};
  const owner = {};
  let turn = "A", last, fresh = [];
  for (const m of moves) {
    const id = m?.l;
    if (!LINES.includes(id) || drawn.has(id) || m.by !== who[turn]) continue;
    drawn.add(id);
    by[id] = turn;
    last = id;
    fresh = closes(drawn, id);
    for (const box of fresh) owner[box] = turn;
    if (fresh.length === 0) turn = turn === "A" ? "B" : "A";
  }
  return { drawn, by, owner, turn, last, fresh };
};

export default function App() {
  const w = WORDS[language()] ?? WORDS.en;
  const [state, apply] = useSharedState();
  const members = useRoomMembers();
  const seats = useSeats(["A", "B"]);
  const sound = useSound();
  const haptic = useHaptic();
  const me = Spiral.viewer;

  const moves = Array.isArray(state.moves) ? state.moves : [];
  const key = JSON.stringify([moves, seats.who]);
  const { drawn, by, owner, turn, last, fresh } = useMemo(() => replay(moves, seats.who), [key]);

  const count = (side) => Object.values(owner).filter((o) => o === side).length;
  const score = { A: count("A"), B: count("B") };
  const over = score.A + score.B === N * N;
  const first = (side) => seats.name(side)?.split(" ")[0];
  const myName = members?.find((m) => m.userId === me)?.displayName ?? me.replace(/^@/, "").split(":")[0];
  const winner = over && score.A !== score.B ? (score.A > score.B ? "A" : "B") : null;

  // A line drawn while the post is open: its boxes pop (never on opening a
  // finished game), and whoever did not draw it hears it; the end is heard
  // on both phones, the loser's too.
  const [popAt, setPopAt] = useState(-1);
  useChanged(drawn.size, (n, before) => {
    if (n <= before) return;
    setPopAt(n);
    if (seats.mine && by[last] !== seats.mine) { sound(fresh.length ? "pop" : "tap"); haptic("light"); }
  });
  const popping = popAt === drawn.size ? fresh : [];
  useChanged(over ? winner ?? "draw" : "", (now) => {
    if (!now || !seats.mine) return;
    sound(now === seats.mine ? "win" : now === "draw" ? "pop" : "lose");
    haptic(now === seats.mine ? "success" : "light");
  });
  const high = Math.max(score.A, score.B), low = Math.min(score.A, score.B);
  const again = !over && fresh.length > 0;

  const title = over
    ? winner === null ? w.draw : seats.who[winner] === me ? w.youWon(high, low) : w.won(first(winner) ?? "—", high, low)
    : moves.length === 0 && !seats.who.A && !seats.who.B ? w.title
    : seats.who[turn] === me ? (again ? w.yoursAgain : w.yours)
    : seats.who[turn] ? (again ? w.again(first(turn)) : w.turn(first(turn)))
    : w.open;

  const draw = (id) => {
    if (over || drawn.has(id)) return;
    // The first to touch the field takes the side to move — in the same
    // action as the line, so the line cannot arrive without its player — and
    // the rest watch.
    const ops = [];
    if (!seats.mine) {
      if (seats.who[turn]) return;
      ops.push({ setIfAbsent: { path: ["seats", turn], value: me } });
    } else if (seats.who[turn] !== me) {
      return;
    }
    const next = new Set(drawn);
    next.add(id);
    const won = closes(next, id).length;
    const mine = { A: score.A, B: score.B };
    mine[turn] += won;
    const ended = mine.A + mine.B === N * N;
    const other = turn === "A" ? "B" : "A";
    const top = mine.A === mine.B ? null : mine.A > mine.B ? "A" : "B";
    const topName = top === turn ? myName : top ? seats.name(top) ?? "" : "";
    const line = every((w) => ended
      ? top ? w.won(topName, Math.max(mine.A, mine.B), Math.min(mine.A, mine.B)) : w.draw
      : won ? w.boxed(myName, won) : w.drew(myName));
    // A closed box keeps the turn, so nobody is told; the last box tells the
    // other player how it ended — never «your move» on a finished game.
    const told = ended ? { result: seats.who[other] !== me ? seats.who[other] : undefined } : won ? {} : seats.ping(other);
    ops.push({ listAppend: { path: "moves", item: { id: Math.random().toString(36).slice(2, 8), l: id, by: me } } });
    apply(ops.length === 1 ? ops[0] : { batch: { ops } }, summary({ line, ...told }));
    sound(won ? "pop" : "tap");
    haptic(won ? "success" : "light");
  };

  const reset = () => {
    apply({ set: { path: "moves", value: [] } }, summary({ line: every((w) => w.fresh), ...seats.ping("A") }));
    sound("pop");
  };

  // A notebook page (§ 5.76): dots in ink, the lines gone over in pen, the
  // last one in its player's colour so a returning player sees the reply; a
  // closed box shaded in its owner's colour with their initial in marker.
  const cell = 100 / (N + 0.6);
  const at = (k) => cell * 0.3 + k * cell;
  const color = { A: accent(0), B: accent(1) };
  const INK = "#1e293b";
  const ends = (id) => {
    const [k, r, c] = id.split("-");
    const R = Number(r), C = Number(c);
    return k === "h" ? [at(C), at(R), at(C + 1), at(R)] : [at(C), at(R), at(C), at(R + 1)];
  };
  // Each line owns the diamond between its two dots and the centres of the
  // boxes on either side: the diamonds tile the field, so a finger always
  // lands on the nearest line, and every target is a whole cell across.
  const diamond = (id) => {
    const [x1, y1, x2, y2] = ends(id);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, h = cell / 2;
    return x1 === x2
      ? `${x1},${y1} ${mx + h},${my} ${x2},${y2} ${mx - h},${my}`
      : `${x1},${y1} ${mx},${my - h} ${x2},${y2} ${mx},${my + h}`;
  };

  const hint = seats.mine || seats.full ? null : w.take;
  return (
    <Scene theme="paper">
      <Stack>
        <Text variant="title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</Text>
        <Square>
          <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%", display: "block" }}>
            {Object.entries(owner).map(([box, side]) => {
              const [r, c] = box.split("-").map(Number);
              return (
                <g key={box} className={popping.includes(box) ? "s-pop" : undefined} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
                  <rect x={at(c)} y={at(r)} width={cell} height={cell} style={{ fill: color[side], opacity: 0.16 }} />
                  <text
                    x={at(c) + cell / 2} y={at(r) + cell / 2} textAnchor="middle" dominantBaseline="central" fontSize={cell * 0.46}
                    style={{ fill: color[side], fontFamily: "\"Marker Felt\", Noteworthy, sans-serif" }}
                  >
                    {(seats.name(side) ?? side)[0].toUpperCase()}
                  </text>
                </g>
              );
            })}
            {LINES.map((id) => {
              const [x1, y1, x2, y2] = ends(id);
              const on = drawn.has(id);
              const style = on ? { stroke: id === last ? color[by[id]] : INK, strokeWidth: id === last ? 3 : 2.2 } : { stroke: "#94a3b8", strokeWidth: 0.9, strokeDasharray: "1.2 2.6" };
              return <line key={id} x1={x1} y1={y1} x2={x2} y2={y2} strokeLinecap="round" style={style} />;
            })}
            {Array.from({ length: (N + 1) * (N + 1) }, (_, i) => (
              <circle key={i} cx={at(i % (N + 1))} cy={at(Math.floor(i / (N + 1)))} r="2.2" fill={INK} />
            ))}
            {LINES.filter((id) => !drawn.has(id)).map((id) => (
              <polygon key={id} data-line={id} points={diamond(id)} fill="transparent" onClick={() => draw(id)} />
            ))}
          </svg>
        </Square>
        <Row between>
          <Meta>
            {hint ?? (
              <>
                <span style={{ color: color.A }}>●</span> {first("A") ?? "—"} {score.A}
                &nbsp;&nbsp;
                <span style={{ color: color.B }}>●</span> {first("B") ?? "—"} {score.B}
              </>
            )}
          </Meta>
          {over && <Button onPress={reset}>{w.newGame}</Button>}
        </Row>
        <Only in="expanded">
          <Meta>{w.rule}</Meta>
        </Only>
      </Stack>
    </Scene>
  );
}
