import { useEffect, useState, useMemo } from "react";
import { Spiral, useSharedState, useRoomMembers, useSeats, useChanged, useSound, useHaptic, summary } from "@spiral/sdk";
import { Scene, Text, Button, Row, Stack, Fill, Board, Only, Meta } from "@spiral/ui";

const START = "rnbqkbnrpppppppp" + ".".repeat(32) + "PPPPPPPPRNBQKBNR";
// U+FE0E asks for the TEXT form: iOS draws ♟ as the black-pawn emoji by
// default, so both sides' pawns came out black (§ 5.74).
const GLYPH = { k: "♚\uFE0E", q: "♛\uFE0E", r: "♜\uFE0E", b: "♝\uFE0E", n: "♞\uFE0E", p: "♟\uFE0E" };
const side = (c) => (!c || c === "." ? null : c === c.toUpperCase() ? "w" : "b");
const opp = (s) => (s === "w" ? "b" : "w");
const sq = (i) => "abcdefgh"[i & 7] + (8 - (i >> 3));
const KING = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const STEPS = { n: [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]], k: KING };
const RAYS = { r: KING.slice(0, 4), b: KING.slice(4), q: KING };

// squares the piece on i attacks (index 0 = a8)
function attacks(b, i) {
  const c = b[i], p = c.toLowerCase(), s = side(c), r = i >> 3, f = i & 7, out = [];
  const at = (rr, ff) => (rr >= 0 && rr < 8 && ff >= 0 && ff < 8 ? rr * 8 + ff : -1);
  if (p === "p") [-1, 1].forEach((df) => { const j = at(r + (s === "w" ? -1 : 1), f + df); if (j >= 0) out.push(j); });
  else if (STEPS[p]) STEPS[p].forEach(([dr, df]) => { const j = at(r + dr, f + df); if (j >= 0 && side(b[j]) !== s) out.push(j); });
  else RAYS[p].forEach(([dr, df]) => {
    for (let k = 1; ; k++) { const j = at(r + dr * k, f + df * k); if (j < 0) break; if (side(b[j]) !== s) out.push(j); if (b[j] !== ".") break; }
  });
  return out;
}
const attacked = (b, j, by) => b.some((c, i) => side(c) === by && attacks(b, i).includes(j));

function pseudo(pos, i) {
  const { b } = pos, c = b[i], s = side(c), p = c.toLowerCase();
  if (p === "p") {
    const d = s === "w" ? -8 : 8, out = [];
    if (b[i + d] === ".") { out.push(i + d); if ((i >> 3) === (s === "w" ? 6 : 1) && b[i + 2 * d] === ".") out.push(i + 2 * d); }
    attacks(b, i).forEach((j) => { if (side(b[j]) === opp(s) || j === pos.ep) out.push(j); });
    return out;
  }
  const out = attacks(b, i), e = s === "w" ? 60 : 4, o = opp(s);
  if (p === "k" && i === e && !attacked(b, e, o)) {
    if (pos.castle.includes(s === "w" ? "K" : "k") && b[e + 1] === "." && b[e + 2] === "." && !attacked(b, e + 1, o)) out.push(e + 2);
    if (pos.castle.includes(s === "w" ? "Q" : "q") && b[e - 1] === "." && b[e - 2] === "." && b[e - 3] === "." && !attacked(b, e - 1, o)) out.push(e - 2);
  }
  return out;
}

function step(pos, from, to) {
  const b = pos.b.slice(), c = b[from], p = c.toLowerCase(), s = side(c);
  const passant = p === "p" && to === pos.ep;
  const cap = b[to] !== "." || passant;
  if (passant) b[to + (s === "w" ? 8 : -8)] = ".";
  if (p === "k" && Math.abs(to - from) === 2) { const rf = to > from ? from + 3 : from - 4; b[(from + to) / 2] = b[rf]; b[rf] = "."; }
  b[to] = p === "p" && (to < 8 || to > 55) ? (s === "w" ? "Q" : "q") : c;
  b[from] = ".";
  let castle = pos.castle;
  [[60, "KQ"], [63, "K"], [56, "Q"], [4, "kq"], [7, "k"], [0, "q"]].forEach(([q, l]) => {
    if (from === q || to === q) for (const x of l) castle = castle.replace(x, "");
  });
  return { b, turn: opp(s), castle, ep: p === "p" && Math.abs(to - from) === 16 ? (from + to) / 2 : -1, cap };
}

const kingOf = (pos) => pos.b.indexOf(pos.turn === "w" ? "K" : "k");
const inCheck = (pos) => attacked(pos.b, kingOf(pos), opp(pos.turn));
const legal = (pos, i) => side(pos.b[i]) !== pos.turn ? [] :
  pseudo(pos, i).filter((t) => { const n = step(pos, i, t); return !attacked(n.b, n.b.indexOf(pos.turn === "w" ? "K" : "k"), n.turn); });
const hasMoves = (pos) => pos.b.some((_, i) => legal(pos, i).length > 0);

// Not enough left to mate with: kings alone, a king and one minor piece, or
// bishops on squares of one colour.
const deadPosition = (b) => {
  const rest = b.map((c, i) => [c, i]).filter(([c]) => c !== "." && c.toLowerCase() !== "k");
  if (rest.length === 0) return true;
  if (rest.every(([c]) => c.toLowerCase() === "b")) return new Set(rest.map(([, i]) => ((i >> 3) + (i & 7)) % 2)).size === 1;
  return rest.length === 1 && rest[0][0].toLowerCase() === "n";
};

// The game from its moves. A move counts only when it is legal AND made by
// the player whose turn it is (§ 5.80) — two people taking one colour at
// once could both have moved. A game also ends drawn: the same position a
// third time, fifty moves each without a capture or a pawn move, or too
// little left to mate with — it used to go on for ever with two kings.
function replay(moves, who) {
  let pos = { b: START.split(""), turn: "w", castle: "KQkq", ep: -1 }, last = null, quiet = 0, draw = null;
  const log = [];
  const seen = new Map();
  const at = (p) => `${p.b.join("")} ${p.turn} ${p.castle} ${p.ep}`;
  seen.set(at(pos), 1);
  for (const m of moves) {
    if (draw) break;
    if (!m || m.by !== who[pos.turn] || !legal(pos, m.f).includes(m.t)) continue;
    const p = pos.b[m.f].toLowerCase(), n = step(pos, m.f, m.t);
    let san = p === "k" && Math.abs(m.t - m.f) === 2 ? (m.t > m.f ? "O-O" : "O-O-O")
      : (p === "p" ? "" : p.toUpperCase()) + sq(m.f) + (n.cap ? "×" : "–") + sq(m.t);
    if (p === "p" && (m.t < 8 || m.t > 55)) san += "=Q";
    if (inCheck(n)) san += hasMoves(n) ? "+" : "#";
    log.push(san); pos = n; last = m;
    quiet = p === "p" || n.cap ? 0 : quiet + 1;
    const times = (seen.get(at(pos)) ?? 0) + 1;
    seen.set(at(pos), times);
    if (!hasMoves(pos)) continue;
    draw = times >= 3 ? "repetition" : quiet >= 100 ? "fifty" : deadPosition(pos.b) ? "material" : null;
  }
  return { pos, log, last, draw };
}

// The post's own words, in the language of whoever is looking at it. What
// one player's phone writes to the card (`summary.line`) is in that phone's
// language, and everyone sees it so (§ 7 #30).
const WORDS = {
  uk: {
    white: "Білі", black: "Чорні", resigned: (c) => `${c === "w" ? "Білі" : "Чорні"} здалися`,
    mate: (c) => `Мат · перемогли ${c === "w" ? "чорні" : "білі"}`, stalemate: "Пат · нічия",
    drawn: { repetition: "Нічия · позиція втретє", fifty: "Нічия · 50 ходів без взяття", material: "Нічия · нема чим матувати" },
    turn: (c) => `Хід ${c === "w" ? "білих" : "чорних"}`, free: "колір вільний", check: "шах",
    plays: (n, c) => `${n} грає ${c === "w" ? "білими" : "чорними"}`,
    playWhite: "Грати білими", playBlack: "Грати чорними", noMoves: "Ходів ще немає",
    moves: (n) => `Ходів: ${n}`, newGame: "Нова партія", resign: "Здатися", fresh: "Нова партія · хід білих",
  },
  ru: {
    white: "Белые", black: "Чёрные", resigned: (c) => `${c === "w" ? "Белые" : "Чёрные"} сдались`,
    mate: (c) => `Мат · победили ${c === "w" ? "чёрные" : "белые"}`, stalemate: "Пат · ничья",
    drawn: { repetition: "Ничья · позиция в третий раз", fifty: "Ничья · 50 ходов без взятия", material: "Ничья · нечем ставить мат" },
    turn: (c) => `Ход ${c === "w" ? "белых" : "чёрных"}`, free: "цвет свободен", check: "шах",
    plays: (n, c) => `${n} играет ${c === "w" ? "белыми" : "чёрными"}`,
    playWhite: "Играть белыми", playBlack: "Играть чёрными", noMoves: "Ходов пока нет",
    moves: (n) => `Ходов: ${n}`, newGame: "Новая партия", resign: "Сдаться", fresh: "Новая партия · ход белых",
  },
  en: {
    white: "White", black: "Black", resigned: (c) => `${c === "w" ? "White" : "Black"} resigned`,
    mate: (c) => `Checkmate · ${c === "w" ? "Black" : "White"} wins`, stalemate: "Stalemate · draw",
    drawn: { repetition: "Draw · the same position three times", fifty: "Draw · fifty moves without a capture", material: "Draw · nothing left to mate with" },
    turn: (c) => `${c === "w" ? "White" : "Black"} to move`, free: "seat open", check: "check",
    plays: (n, c) => `${n} plays ${c === "w" ? "White" : "Black"}`,
    playWhite: "Play White", playBlack: "Play Black", noMoves: "No moves yet",
    moves: (n) => `Moves: ${n}`, newGame: "New game", resign: "Resign", fresh: "New game · White to move",
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
  const [sel, setSel] = useState(null);
  const me = Spiral.viewer;
  // Who plays which colour, and whom a move tells (§ 5.75).
  const seats = useSeats(["w", "b"]);
  const who = seats.who;
  const moves = Array.isArray(state.moves) ? state.moves : [];
  const key = JSON.stringify([moves, who]);
  const { pos, log, last, draw } = useMemo(() => replay(moves, who), [key]);

  const name = (id) => (id ? members?.find((m) => m.userId === id)?.displayName ?? id.split(":")[0].replace("@", "") : null);
  const myColour = who.w === me ? (who.b === me ? pos.turn : "w") : who.b === me ? "b" : null;
  const check = inCheck(pos), stuck = !hasMoves(pos);
  const over = state.resigned ? w.resigned(state.resigned)
    : stuck ? (check ? w.mate(pos.turn) : w.stalemate)
    : draw ? w.drawn[draw] : null;
  // The side to move is this viewer's — or free, and this viewer sits on
  // neither side: they may pick up a piece, and the move they make takes the
  // seat with it. Touching a piece used to take the seat for good (§ 5.80).
  const free = !who[pos.turn] && !myColour && !!me;
  const mine = !over && !!me && (who[pos.turn] === me || free);
  const targets = sel != null && mine ? legal(pos, sel) : [];
  // Black plays from the bottom of the board, as at a real table.
  const flip = who.b === me && who.w !== me;

  // A selection belongs to the position it was made in.
  useEffect(() => setSel(null), [key, over]);
  // A move that lands while the post is open is heard by the player who did
  // not make it; the end, by both.
  useChanged(log.length, (n, before) => {
    if (n > before && myColour && last?.by !== me) { sound("tap"); haptic("light"); }
  });
  const result = state.resigned ? (state.resigned === "w" ? "b" : "w") : stuck && check ? opp(pos.turn) : stuck || draw ? "draw" : "";
  useChanged(result, (now) => {
    if (!now || !myColour) return;
    sound(now === myColour ? "win" : now === "draw" ? "pop" : "lose");
    haptic(now === myColour ? "success" : "light");
  });
  const kingSq = check ? kingOf(pos) : -1;
  // «Check» before the name: at the end of a long one it was cut off.
  const title = over ?? `${w.turn(pos.turn)}${check ? " · " + w.check : ""}${who[pos.turn] ? " · " + name(who[pos.turn]) : " · " + w.free}`;

  const claim = (c) => seats.sit(c, summary({ line: every((w) => w.plays(name(me), c)) }));
  const tap = (i) => {
    if (targets.includes(i)) {
      const item = { id: Math.random().toString(36).slice(2, 8), f: sel, t: i, by: me };
      const after = replay([...moves, item], { ...who, [pos.turn]: who[pos.turn] ?? me });
      const n = after.pos, stuck = !hasMoves(n), mate = stuck && inCheck(n);
      const line = every((w) => (stuck ? (mate ? w.mate(n.turn) : w.stalemate)
        : after.draw ? w.drawn[after.draw] : `${sq(sel)}–${sq(i)} · ${w.turn(n.turn)}`));
      // «Your move» to the side now to move — or, when this move ends the
      // game, how it ended; a free seat's only possible player is challenged.
      const other = who[n.turn];
      const told = stuck || after.draw ? { result: other !== me ? other : undefined } : seats.ping(n.turn);
      // The seat and the move in ONE action: the move cannot arrive without
      // its player, nor the seat without the move that took it.
      const ops = who[pos.turn] ? [] : [{ setIfAbsent: { path: ["seats", pos.turn], value: me } }];
      ops.push({ listAppend: { path: "moves", item } });
      apply(ops.length === 1 ? ops[0] : { batch: { ops } }, summary({ line, ...told }));
      sound(step(pos, sel, i).cap ? "pop" : "tap"); haptic("light"); setSel(null);
      return;
    }
    setSel(mine && side(pos.b[i]) === pos.turn && i !== sel ? i : null);
  };
  const resign = () => {
    const other = who[opp(myColour)];
    apply({ setIfAbsent: { path: "resigned", value: myColour } },
      summary({ line: every((w) => w.resigned(myColour)), result: other !== me ? other : undefined }));
  };
  // A new game, from a player; White, who opens it, is called.
  const reset = () => apply({ batch: { ops: [{ set: { path: "moves", value: [] } }, { del: { path: "resigned" } }] } },
    summary({ line: every((w) => w.fresh), ...seats.ping("w") }));

  const pairs = [];
  for (let k = 0; k < log.length; k += 2) pairs.push(`${k / 2 + 1}. ${log[k]}${log[k + 1] ? " " + log[k + 1] : ""}`);

  // A walnut table (§ 5.76): cream and brown squares, the last move in the
  // brass of the scene, filled pieces with an edge that reads on both colours
  // — drawn UNDER the fill: a 1 px stroke over it filled the fine inner lines
  // of the white king and rooks, and they read as black pieces (§ 5.80). A
  // square a piece may take is ringed; a dot on a piece was lost on black.
  return (
    <Scene theme="board">
      <Stack>
        <div style={{ paddingRight: 34, minWidth: 0 }}>
          <Text variant="title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</Text>
        </div>
        <Board cols={8} style={{ boxShadow: "0 0 0 3px #1a100a" }}>
          {(flip ? [...pos.b.keys()].reverse() : [...pos.b.keys()]).map((i) => {
            const c = pos.b[i];
            const dark = ((i >> 3) + (i & 7)) % 2 === 1, s = side(c);
            const lastSq = last && (i === last.f || i === last.t);
            const bg = i === kingSq ? "#dc2626" : i === sel ? "#e7b56a" : lastSq ? (dark ? "#b9a23a" : "#d8ce6a") : dark ? "#b0784f" : "#eed7b5";
            const target = targets.includes(i);
            return (
              <div
                key={i}
                data-sq={i}
                onClick={() => tap(i)}
                style={{ background: bg, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: target && s ? "inset 0 0 0 3px rgb(43 27 18 / 0.6)" : undefined }}
              >
                {s && <span style={{ color: s === "w" ? "#fffdf7" : "#1c1917", WebkitTextStroke: s === "w" ? "1.6px #2b1b10" : "1px #1c1917", paintOrder: "stroke fill", fontFamily: "ui-serif, Georgia, serif" }}>{GLYPH[c.toLowerCase()]}</span>}
                {target && !s && <span style={{ position: "absolute", width: "30%", height: "30%", borderRadius: "50%", background: "rgb(43 27 18 / 0.45)" }} />}
              </div>
            );
          })}
        </Board>
        <Only in="expanded">
          <Row between>
            <Button variant={who.w ? "secondary" : "primary"} disabled={!!who.w || !!myColour || !me} onPress={() => claim("w")}>
              {who.w ? `${w.white} · ${name(who.w)}` : w.playWhite}
            </Button>
            <Button variant={who.b ? "secondary" : "primary"} disabled={!!who.b || !!myColour || !me} onPress={() => claim("b")}>
              {who.b ? `${w.black} · ${name(who.b)}` : w.playBlack}
            </Button>
          </Row>
          {/* The moves in a strip, not a share of the screen: as a Fill it
              took half the height and the board shrank to 266 of 402 px. */}
          <Fill scroll style={{ flex: "0 1 auto", maxHeight: 132 }}>
            <Text variant="body">
              {pairs.length ? pairs.map((pair) => <span key={pair} style={{ display: "inline-block", marginRight: 14 }}>{pair}</span>) : w.noMoves}
            </Text>
          </Fill>
          <Row between>
            <Meta>{w.moves(Math.ceil(log.length / 2))}</Meta>
            {over
              ? <Button variant="secondary" disabled={!myColour} onPress={reset}>{w.newGame}</Button>
              : <Button variant="secondary" disabled={!myColour} onPress={resign}>{w.resign}</Button>}
          </Row>
        </Only>
      </Stack>
    </Scene>
  );
}
