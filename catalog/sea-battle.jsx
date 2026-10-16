import { useEffect, useRef, useState } from "react";
import { Spiral, useSharedState, useRoomMembers, useSeats, useSealed, useChanged, useSound, useHaptic, summary } from "@spiral/sdk";
import { Scene, Stack, Fill, Row, Text, Meta, Button, Board, Only } from "@spiral/ui";

const N = 8;
const FLEET = [3, 2, 2, 1, 1];
const CELLS = FLEET.reduce((a, b) => a + b, 0);

// The post's own words, in the language of whoever is looking at it.
const WORDS = {
  uk: {
    title: "Морський бій", setup: "Розставте флот", shuffle: "Перемішати", ready: "До бою!", fleetReady: "Флот на позиціях",
    waitFleet: (n) => `${n} ще розставляє флот`, waitPlayer: "Чекаємо на суперника", yourShot: "Ваш постріл", theirShot: (n) => `Стріляє ${n}`,
    won: "Ви перемогли!", lost: (n) => `${n} перемагає`, wins: (n) => `${n} перемагає!`,
    score: (a, b) => `Влучань ${a}/${CELLS} · по вас ${b}/${CELLS}`, cols: "АБВГДЕЖЗ",
    fired: (n, c) => `${n} стріляє: ${c}`, shot: (n, c, r) => `${n} → ${c}: ${r}`, result: { miss: "мимо", hit: "влучання!", sunk: "потоплено!" },
    mineHit: (c, r) => `${c} — ${r} Стріляйте ще`, mineMiss: (c) => `${c} — мимо`, waitAnswer: (c, n) => `${c} — чекаємо на відповідь ${n}`,
    elsewhere: "Ваш флот на іншому телефоні — відкрийте пост там", cheat: (n) => `${n}: відповіді не збігаються з флотом`,
    newGame: "Нова гра", fresh: "Нова гра · розставляйте флот", onStation: (n) => `${n}: флот на позиціях`, watch: "Двоє грають, решта дивиться",
  },
  ru: {
    title: "Морской бой", setup: "Расставьте флот", shuffle: "Перемешать", ready: "В бой!", fleetReady: "Флот на позициях",
    waitFleet: (n) => `${n} ещё расставляет флот`, waitPlayer: "Ждём соперника", yourShot: "Ваш выстрел", theirShot: (n) => `Стреляет ${n}`,
    won: "Вы победили!", lost: (n) => `${n} побеждает`, wins: (n) => `${n} побеждает!`,
    score: (a, b) => `Попаданий ${a}/${CELLS} · по вам ${b}/${CELLS}`, cols: "АБВГДЕЖЗ",
    fired: (n, c) => `${n} стреляет: ${c}`, shot: (n, c, r) => `${n} → ${c}: ${r}`, result: { miss: "мимо", hit: "попадание!", sunk: "потоплен!" },
    mineHit: (c, r) => `${c} — ${r} Стреляйте ещё`, mineMiss: (c) => `${c} — мимо`, waitAnswer: (c, n) => `${c} — ждём ответа ${n}`,
    elsewhere: "Ваш флот на другом телефоне — откройте пост там", cheat: (n) => `${n}: ответы не сходятся с флотом`,
    newGame: "Новая игра", fresh: "Новая игра · расставляйте флот", onStation: (n) => `${n}: флот на позициях`, watch: "Двое играют, остальные смотрят",
  },
  en: {
    title: "Sea battle", setup: "Place your fleet", shuffle: "Shuffle", ready: "Battle!", fleetReady: "Fleet in position",
    waitFleet: (n) => `${n} is placing their fleet`, waitPlayer: "Waiting for an opponent", yourShot: "Your shot", theirShot: (n) => `${n} to fire`,
    won: "You won!", lost: (n) => `${n} wins`, wins: (n) => `${n} wins!`,
    score: (a, b) => `Hits ${a}/${CELLS} · on you ${b}/${CELLS}`, cols: "ABCDEFGH",
    fired: (n, c) => `${n} fires at ${c}`, shot: (n, c, r) => `${n} → ${c}: ${r}`, result: { miss: "miss", hit: "hit!", sunk: "sunk!" },
    mineHit: (c, r) => `${c} — ${r} Fire again`, mineMiss: (c) => `${c} — miss`, waitAnswer: (c, n) => `${c} — waiting for ${n}`,
    elsewhere: "Your fleet is on another phone — open the post there", cheat: (n) => `${n}: answers do not match the fleet`,
    newGame: "New game", fresh: "New game · place your fleets", onStation: (n) => `${n}: fleet in position`, watch: "Two play, the rest watch",
  },
};
const language = () => Spiral.language ?? String(navigator.language ?? "").slice(0, 2);
// A cell as a reader of that language names it: «Д5», «D5».
const cellIn = (w, c) => `${w.cols[c % N]}${Math.floor(c / N) + 1}`;
const every = (say) => Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, say(w)]));
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// A fleet at random: longest first, no two ships touching, not even at a corner.
const place = () => {
  for (;;) {
    const taken = new Set();
    const ships = [];
    const clear = (x) => {
      const r = Math.floor(x / N), c = x % N;
      for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < N && cc >= 0 && cc < N && taken.has(rr * N + cc)) return false;
      }
      return true;
    };
    for (const len of FLEET) {
      for (let t = 0; t < 200; t += 1) {
        const across = Math.random() < 0.5;
        const r = Math.floor(Math.random() * (across ? N : N - len + 1));
        const c = Math.floor(Math.random() * (across ? N - len + 1 : N));
        const cells = Array.from({ length: len }, (_, i) => (across ? r * N + c + i : (r + i) * N + c));
        if (!cells.every(clear)) continue;
        ships.push(cells);
        cells.forEach((x) => taken.add(x));
        break;
      }
    }
    if (ships.length === FLEET.length) return ships;
  }
};

// What a defender answers to each shot, in order, from their fleet: the
// same rule the defender's phone answers by and every phone checks by.
const answersFor = (ships, shots) => {
  const hit = new Set();
  return shots.map((s) => {
    const ship = ships.find((cells) => cells.includes(s.c));
    if (!ship) return "miss";
    hit.add(s.c);
    return ship.every((x) => hit.has(x)) ? "sunk" : "hit";
  });
};
const isFleet = (v) => Array.isArray(v) && v.length === FLEET.length && v.every((s) => Array.isArray(s) && s.every((x) => Number.isInteger(x) && x >= 0 && x < N * N));

export default function App() {
  const w = WORDS[language()] ?? WORDS.en;
  const [state, apply] = useSharedState();
  const members = useRoomMembers();
  const seats = useSeats(["A", "B"]);
  const sound = useSound();
  const haptic = useHaptic();
  const me = Spiral.viewer;
  const first = (id) => (members?.find((m) => m.userId === id)?.displayName ?? id?.replace(/^@/, "").split(":")[0] ?? "—").split(" ")[0];

  const game = Number(state.game) || 1;
  const mySide = seats.who.A === me ? "A" : seats.who.B === me ? "B" : null;
  const other = (side) => (side === "A" ? "B" : "A");
  const sideOf = (user) => (user && seats.who.A === user ? "A" : user && seats.who.B === user ? "B" : null);
  const them = mySide ? seats.who[other(mySide)] : undefined;
  const by = isObject(state.by) ? state.by : {};
  const answersOf = (user) => (user && isObject(by[user]) && isObject(by[user].answers) ? by[user].answers : {});
  // This game's shots by the two players, in the room's order.
  const shots = (Array.isArray(state.shots) ? state.shots : [])
    .filter((s) => isObject(s) && s.g === game && Number.isInteger(s.c) && sideOf(s.by) !== null);
  const shotsBy = (user) => shots.filter((s) => s.by === user);
  const defenderOf = (s) => seats.who[other(sideOf(s.by))];
  const answerTo = (s) => answersOf(defenderOf(s))[s.id];

  // Both fleets are sealed at the start and opened at the end; in between
  // each phone answers the shots at it from its own.
  const [over, setOver] = useState(false);
  const fleet = useSealed(`fleet${game}`, { openWhen: () => over });
  const mine = isFleet(fleet.mine) ? fleet.mine : undefined;
  const battle = Boolean(seats.who.A && seats.who.B) && fleet.sealed.includes(seats.who.A) && fleet.sealed.includes(seats.who.B);

  // The score, from the answers each side gave the other.
  const hitsOn = (defender, shooter) => shotsBy(shooter).filter((s) => ["hit", "sunk"].includes(answersOf(defender)[s.id])).length;
  const hitsA = hitsOn(seats.who.B, seats.who.A), hitsB = hitsOn(seats.who.A, seats.who.B);
  const winner = hitsA === CELLS ? "A" : hitsB === CELLS ? "B" : null;
  useEffect(() => setOver(winner !== null), [winner]);

  // CLASSIC RULES: a hit or a sunk ship keeps the turn, a miss passes it —
  // and a shot waiting for its answer holds everyone, since only the
  // defender's phone knows what it hit.
  const lastShot = shots.at(-1);
  const lastAnswer = lastShot ? answerTo(lastShot) : undefined;
  const pending = lastShot && lastAnswer === undefined ? lastShot : null;
  const turn = !lastShot ? "A" : pending ? null : lastAnswer === "miss" ? other(sideOf(lastShot.by)) : sideOf(lastShot.by);

  // THIS PHONE ANSWERS the shots at it, from the fleet only it holds — every
  // one not yet answered, in order, as soon as the post is open here. A hit
  // tells the shooter to fire again.
  const myAnswers = answersOf(me);
  const atMe = them ? shotsBy(them) : [];
  const unanswered = atMe.filter((s) => myAnswers[s.id] === undefined);
  const answering = useRef("");
  useEffect(() => {
    if (!battle || !mine || unanswered.length === 0) return;
    const waiting = unanswered.map((s) => s.id).join();
    if (answering.current === waiting) return;
    answering.current = waiting;
    const results = answersFor(mine, atMe);
    const ops = atMe.map((s, i) => [s, results[i]]).filter(([s]) => myAnswers[s.id] === undefined)
      .map(([s, r]) => ({ set: { path: Spiral.mine("answers", s.id), value: r } }));
    const [latest] = unanswered.slice(-1);
    const result = results[atMe.indexOf(latest)];
    const beaten = results.filter((r) => r !== "miss").length === CELLS;
    const line = every((w) => (beaten ? w.wins(first(them)) : w.shot(first(them), cellIn(w, latest.c), w.result[result])));
    const told = beaten ? { result: them } : result !== "miss" ? { turn: them } : {};
    apply(ops.length === 1 ? ops[0] : { batch: { ops } }, summary({ line, ...told }))
      .catch(() => { answering.current = ""; });
    sound(result === "miss" ? "tick" : "lose");
    if (result !== "miss") haptic("warning");
  });

  // Where a shot landed stays on the board a moment before the turn moves
  // the view on: the shooter sees their miss on the enemy's waters, the
  // defender sees the hit on their own (§ 5.80). A result is shown, not
  // switched away from.
  const [hold, setHold] = useState(null);
  const answered = lastShot && lastAnswer !== undefined ? `${lastShot.id}:${lastAnswer}` : "";
  useChanged(answered, (now) => {
    if (!now || !lastShot || !mySide) return;
    const mineShot = lastShot.by === me;
    setHold({ view: mineShot ? "theirs" : "mine", id: lastShot.id });
    if (mineShot) {
      sound(lastAnswer === "miss" ? "tick" : "pop");
      haptic(lastAnswer === "miss" ? "light" : "success");
    }
  });
  useEffect(() => {
    if (!hold) return undefined;
    const t = setTimeout(() => setHold(null), 1800);
    return () => clearTimeout(t);
  }, [hold]);

  // The fleet on the stocks: dealt on this phone, dealt again on «shuffle».
  const [draft, setDraft] = useState(place);
  const sealedHere = fleet.sealed.includes(me);
  const setup = !sealedHere && (mySide !== null || !seats.full) && !winner;

  const launch = async () => {
    haptic("medium");
    sound("pop");
    let side = mySide;
    if (!side) {
      side = !seats.who.A ? "A" : "B";
      await seats.sit(side);
    }
    await fleet.seal(draft, summary({ line: every((w) => w.onStation(first(me))), ...seats.ping(other(side)) }));
  };

  const fire = (c) => {
    if (!battle || winner || !mySide || turn !== mySide || !them) return;
    if (shotsBy(me).some((s) => s.c === c)) return;
    apply({ listAppend: { path: "shots", item: { id: Math.random().toString(36).slice(2, 8), g: game, by: me, c } } },
      summary({ line: every((w) => w.fired(first(me), cellIn(w, c))), turn: them }));
    setHold(null);
    sound("tap");
    haptic("light");
  };

  const reset = () => {
    apply({ incr: { path: "game", by: 1 } }, summary({ line: every((w) => w.fresh) }));
    setDraft(place());
    sound("pop");
  };

  // Honest answers, checked once both fleets are open.
  const cheated = (defender, shooter) => {
    const ships = defender ? fleet.opened[defender] : undefined;
    if (!isFleet(ships)) return false;
    const theirs = shotsBy(shooter);
    const expected = answersFor(ships, theirs);
    return theirs.some((s, i) => answersOf(defender)[s.id] !== undefined && answersOf(defender)[s.id] !== expected[i]);
  };
  const liar = [seats.who.A, seats.who.B].find((u, i) => u && (fleet.broken.includes(u) || cheated(u, i === 0 ? seats.who.B : seats.who.A)));

  // Whose waters are on the board. A player sees the enemy's on their turn,
  // while their own shot waits for its answer and while its result is held;
  // their own while the other fires. Anyone else watches the waters being
  // fired at.
  const firingSide = pending ? sideOf(pending.by) : turn ?? "A";
  const viewing = !mySide ? null
    : winner ? "theirs"
    : hold ? hold.view
    : pending ? (pending.by === me ? "theirs" : "mine")
    : turn === mySide ? "theirs" : "mine";
  const target = mySide ? (viewing === "mine" ? me : them) : seats.who[other(firingSide)];
  const attacker = mySide ? (viewing === "mine" ? them : me) : seats.who[firingSide];
  const showingMine = battle && mySide !== null && target === me;

  const waters = (defender, shooter, withShips) => {
    const cells = Array.from({ length: N * N }, () => ({ ship: false, mark: "" }));
    const ships = withShips ? (defender === me ? (mine ?? (setup ? draft : [])) : fleet.opened[defender]) : undefined;
    if (isFleet(ships)) ships.flat().forEach((x) => { cells[x].ship = true; });
    const answers = answersOf(defender);
    const theirShots = shooter ? shotsBy(shooter) : [];
    const sunkCells = new Set();
    for (const s of theirShots) {
      const a = answers[s.id];
      cells[s.c].mark = a === undefined ? "?" : a === "miss" ? "•" : "✕";
      if (s.id === lastShot?.id) cells[s.c].last = true;
      if (a === "sunk") {
        // The ship it finished: the hits joined to it in a line.
        const hit = new Set(theirShots.filter((t) => ["hit", "sunk"].includes(answers[t.id])).map((t) => t.c));
        const stack = [s.c];
        while (stack.length) {
          const x = stack.pop();
          if (sunkCells.has(x)) continue;
          sunkCells.add(x);
          for (const y of [x - N, x + N, x % N ? x - 1 : -1, x % N < N - 1 ? x + 1 : -1]) if (y >= 0 && y < N * N && hit.has(y)) stack.push(y);
        }
      }
    }
    // Around a sunk ship there is only water.
    for (const x of sunkCells) {
      cells[x].sunk = true;
      const r = Math.floor(x / N), c = x % N;
      for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < N && cc >= 0 && cc < N && !cells[rr * N + cc].mark) cells[rr * N + cc].mark = "·";
      }
    }
    return cells;
  };

  const shown = setup || (!battle && sealedHere)
    ? waters(me, undefined, true)
    : waters(target, attacker, showingMine || Boolean(winner));
  const miniShown = battle && mySide ? (showingMine ? waters(them, me, false) : waters(me, them, true)) : null;
  const myTurn = battle && !winner && mySide !== null && turn === mySide;

  // What the last shot did, as the one looking at it reads it.
  const lastLine = () => {
    if (!lastShot) return null;
    const cell = cellIn(w, lastShot.c);
    if (lastAnswer === undefined) return lastShot.by === me ? w.waitAnswer(cell, first(them)) : w.fired(first(lastShot.by), cell);
    if (lastShot.by !== me) return w.shot(first(lastShot.by), cell, w.result[lastAnswer]);
    return lastAnswer === "miss" ? w.mineMiss(cell) : w.mineHit(cell, w.result[lastAnswer]);
  };

  const title = winner ? (seats.who[winner] === me ? w.won : w.lost(first(seats.who[winner])))
    : setup ? (mySide || !seats.who.A ? w.setup : w.title)
    : !battle ? w.fleetReady
    : myTurn || pending?.by === me ? w.yourShot : w.theirShot(first(seats.who[firingSide]));
  const status = liar ? w.cheat(first(liar))
    : sealedHere && !mine && !winner && battle ? w.elsewhere
    : !battle && sealedHere ? (them ? w.waitFleet(first(them)) : w.waitPlayer)
    : battle && !winner && lastShot ? lastLine()
    : battle ? w.score(mySide ? hitsOn(them, me) : hitsA, mySide ? hitsOn(me, them) : hitsB)
    : seats.full && !mySide ? w.watch : "";

  // A school exercise book (§ 5.76): a grid in blue ink, ships shaded in,
  // a miss a dot, a hit a cross, a sunk ship ringed in red; the last shot
  // circled, so it is found at a glance.
  const INK = "#1e3a8a";
  const cell = (x, i, tap) => (
    <div
      key={i}
      onClick={tap ? () => fire(i) : undefined}
      style={{
        boxShadow: x.last ? "inset 0 0 0 2px #dc2626" : "inset 0 0 0 0.5px #93b4dd",
        background: x.sunk ? "rgb(220 38 38 / 0.18)" : x.ship ? "rgb(30 58 138 / 0.78)" : "transparent",
        color: x.ship && !x.sunk ? "#ffffff" : x.mark === "✕" ? "#b91c1c" : INK,
        fontFamily: "\"Marker Felt\", Noteworthy, sans-serif", fontWeight: 700,
        opacity: x.mark === "·" ? 0.5 : 1,
      }}
    >
      {x.mark === "·" ? "•" : x.mark}
    </div>
  );
  const mini = (cells) => (
    <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: `repeat(${N}, 5px)`, gap: 0, border: "1px solid #93b4dd", flex: "0 0 auto" }}>
      {cells.map((x, i) => (
        <span key={i} style={{ width: 5, height: 5, background: x.mark === "✕" ? "#dc2626" : x.ship ? INK : x.mark === "•" ? "#94a3b8" : "transparent" }} />
      ))}
    </div>
  );

  return (
    <Scene theme="paper">
      <Stack>
        <Text variant="title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</Text>
        <Fill>
          <Board cols={N}>{shown.map((x, i) => cell(x, i, myTurn && !showingMine && !x.mark))}</Board>
        </Fill>
        {setup ? (
          <Row between>
            <Button variant="secondary" onPress={() => { setDraft(place()); haptic("light"); }}>{w.shuffle}</Button>
            <Button onPress={launch}>{w.ready}</Button>
          </Row>
        ) : winner ? (
          <Row between>
            <Meta>{status}</Meta>
            <Button onPress={reset}>{w.newGame}</Button>
          </Row>
        ) : (
          <Row>
            {miniShown && mini(miniShown)}
            <Meta style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{status}</Meta>
          </Row>
        )}
        <Only in="expanded">
          <Meta>{seats.who.A ? first(seats.who.A) : "—"} {hitsA}/{CELLS} · {seats.who.B ? first(seats.who.B) : "—"} {hitsB}/{CELLS}</Meta>
        </Only>
      </Stack>
    </Scene>
  );
}
