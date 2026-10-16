import { useState } from "react";
import { Spiral, useSharedState, useRoomMembers, useSeats, useSealed, useChanged, useSound, useHaptic, summary } from "@spiral/sdk";
import { Scene, Stack, Fill, Row, Grid, Text, Meta, Button, Choice, Only } from "@spiral/ui";

const WIN = 3; // rounds to win the match

// The post's own words, in the language of whoever is looking at it. A move
// is «in the envelope» until it is opened — the seal, in words a person uses.
const WORDS = {
  uk: {
    title: "Камінь, ножиці, папір", move: { rock: "Камінь", scissors: "Ножиці", paper: "Папір" },
    round: (n, a, b) => `Раунд ${n} · ${a}:${b}`, won: (n, a, b) => `${n} перемагає · ${a}:${b}`, youWon: (a, b) => `Ви перемогли · ${a}:${b}`,
    pick: "Ваш хід — обирайте", theirs: (n) => `${n}: хід уже в конверті — обирайте`, sealed: (n) => `Ваш хід у конверті · ${n} ще обирає`,
    opens: (n) => `Чекаємо, поки ${n} відкриє свій хід`, alone: "Ваш хід у конверті · чекаємо на суперника", elsewhere: "Ваш хід зроблено на іншому телефоні — відкрийте пост там",
    watch: "Двоє грають, решта дивиться", take: "Оберіть — і ви в грі", draw: "нічия", roundOf: (n) => `раунд ${n}`,
    last: (k, a, b, w) => `Раунд ${k}: ${a} · ${b} — ${w}`, again: "Ще матч", fresh: "Новий матч", broken: (n) => `${n}: відкритий хід не той, що в конверті`,
    inEnvelope: (n) => `${n}: хід у конверті`, plays: (n) => `${n} у грі`, history: "Раунди", you: "ви", bestOf: `До ${WIN} перемог`,
  },
  ru: {
    title: "Камень, ножницы, бумага", move: { rock: "Камень", scissors: "Ножницы", paper: "Бумага" },
    round: (n, a, b) => `Раунд ${n} · ${a}:${b}`, won: (n, a, b) => `${n} побеждает · ${a}:${b}`, youWon: (a, b) => `Вы победили · ${a}:${b}`,
    pick: "Ваш ход — выбирайте", theirs: (n) => `${n}: ход уже в конверте — выбирайте`, sealed: (n) => `Ваш ход в конверте · ${n} ещё выбирает`,
    opens: (n) => `Ждём, пока ${n} откроет свой ход`, alone: "Ваш ход в конверте · ждём соперника", elsewhere: "Ваш ход сделан на другом телефоне — откройте пост там",
    watch: "Двое играют, остальные смотрят", take: "Выберите — и вы в игре", draw: "ничья", roundOf: (n) => `раунд ${n}`,
    last: (k, a, b, w) => `Раунд ${k}: ${a} · ${b} — ${w}`, again: "Ещё матч", fresh: "Новый матч", broken: (n) => `${n}: открытый ход не тот, что в конверте`,
    inEnvelope: (n) => `${n}: ход в конверте`, plays: (n) => `${n} в игре`, history: "Раунды", you: "вы", bestOf: `До ${WIN} побед`,
  },
  en: {
    title: "Rock, paper, scissors", move: { rock: "Rock", scissors: "Scissors", paper: "Paper" },
    round: (n, a, b) => `Round ${n} · ${a}:${b}`, won: (n, a, b) => `${n} wins · ${a}:${b}`, youWon: (a, b) => `You win · ${a}:${b}`,
    pick: "Your move — pick one", theirs: (n) => `${n}'s move is sealed — your pick`, sealed: (n) => `Your move is sealed · ${n} is picking`,
    opens: (n) => `Waiting for ${n} to open their move`, alone: "Your move is sealed · waiting for an opponent", elsewhere: "You moved on another phone — open the post there",
    watch: "Two play, the rest watch", take: "Pick one to play", draw: "a draw", roundOf: (n) => `round ${n}`,
    last: (k, a, b, w) => `Round ${k}: ${a} · ${b} — ${w}`, again: "Another match", fresh: "New match", broken: (n) => `${n} opened a move other than the sealed one`,
    inEnvelope: (n) => `${n} has sealed a move`, plays: (n) => `${n} joined`, history: "Rounds", you: "you", bestOf: `First to ${WIN} wins`,
  },
};
const language = () => Spiral.language ?? String(navigator.language ?? "").slice(0, 2);
const every = (say) => Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, say(w)]));
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const MOVES = ["rock", "scissors", "paper"];
const HAND = { rock: "✊", scissors: "✌️", paper: "✋" };
const BEATS = { rock: "scissors", scissors: "paper", paper: "rock" };
const winnerOf = (a, b) => (a === b ? null : BEATS[a] === b ? "A" : "B");

const CSS = `
@keyframes rps-shake { 0%, 100% { transform: translateY(0) rotate(0); } 15%, 45%, 75% { transform: translateY(-18%) rotate(-8deg); } 30%, 60% { transform: translateY(0) rotate(0); } }
@keyframes rps-reveal { 0% { transform: scale(0.4); opacity: 0; } 70% { transform: scale(1.12); opacity: 1; } 100% { transform: scale(1); } }
.rps-shake { animation: rps-shake 0.9s ease-in-out both; }
.rps-reveal { animation: rps-reveal 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) 0.9s both; }
@media (prefers-reduced-motion: reduce) { .rps-shake, .rps-reveal { animation: none; } }
`;

export default function App() {
  const w = WORDS[language()] ?? WORDS.en;
  const [state, apply] = useSharedState();
  const members = useRoomMembers();
  const seats = useSeats(["A", "B"]);
  const sound = useSound();
  const haptic = useHaptic();
  const me = Spiral.viewer;
  const first = (id) => (members?.find((m) => m.userId === id)?.displayName ?? id?.replace(/^@/, "").split(":")[0] ?? "—").split(" ")[0];

  // The match so far, from what the room holds: a round is played when both
  // players have opened their move for it. The round being played is
  // checked against its seals by `useSealed`; played ones stay as opened.
  const from = Number(state.from) || 1;
  const by = isObject(state.by) ? state.by : {};
  const openedIn = (user, k) => {
    const o = user && isObject(by[user]) && isObject(by[user].opened) ? by[user].opened[`r${k}`] : undefined;
    return isObject(o) && MOVES.includes(o.v) ? o.v : undefined;
  };
  const rounds = [];
  const score = { A: 0, B: 0 };
  for (let k = from; score.A < WIN && score.B < WIN; k += 1) {
    const a = openedIn(seats.who.A, k), b = openedIn(seats.who.B, k);
    if (!a || !b) break;
    const win = winnerOf(a, b);
    if (win) score[win] += 1;
    rounds.push({ k, a, b, win });
  }
  const over = score.A === WIN || score.B === WIN;
  const current = from + rounds.length;
  const matchWinner = over ? (score.A === WIN ? "A" : "B") : null;
  const last = rounds.at(-1);

  const players = [seats.who.A, seats.who.B];
  const other = (side) => (side === "A" ? "B" : "A");
  const sealedRound = useSealed(`r${current}`, {
    // The first player's phone opens the moment the second has moved.
    openWhen: (sealed) => Boolean(seats.who.A && seats.who.B) && players.every((u) => sealed.includes(u)),
    said: () => {
      const side = seats.who.A === me ? "A" : "B";
      const mine = sealedRound.mine, theirs = sealedRound.opened[seats.who[other(side)]];
      if (!mine || !theirs) return undefined;
      const a = side === "A" ? mine : theirs, b = side === "A" ? theirs : mine;
      const win = winnerOf(a, b);
      const sa = score.A + (win === "A" ? 1 : 0), sb = score.B + (win === "B" ? 1 : 0);
      const done = sa === WIN || sb === WIN;
      const line = every((w) => done
        ? w.won(first(seats.who[sa === WIN ? "A" : "B"]), Math.max(sa, sb), Math.min(sa, sb))
        : w.last(current - from + 1, `${first(seats.who.A)} ${HAND[a]}`, `${first(seats.who.B)} ${HAND[b]}`, win ? first(seats.who[win]) : w.draw));
      const them = seats.who[other(side)];
      return summary({ line, ...(done ? { result: them } : { turn: them }) });
    },
  });

  // «Rock, paper, scissors — shoot!»: the hands shake and open when a round
  // is played while the post is on screen.
  const [shown, setShown] = useState(0);
  useChanged(rounds.length, (n, before) => {
    if (n > before) {
      setShown(n);
      const win = rounds.at(-1)?.win;
      const mySide = seats.who.A === me ? "A" : seats.who.B === me ? "B" : null;
      sound(!win ? "tick" : win === mySide ? "win" : mySide ? "lose" : "pop");
    }
  });

  const mySide = seats.who.A === me ? "A" : seats.who.B === me ? "B" : null;
  const theirSide = mySide ? other(mySide) : null;
  const iSealed = sealedRound.sealed.includes(me);
  const theySealed = theirSide && seats.who[theirSide] ? sealedRound.sealed.includes(seats.who[theirSide]) : false;
  const canPick = !over && !iSealed && (mySide !== null || !seats.full);

  const pick = async (move) => {
    if (!canPick) return;
    haptic("medium");
    sound("tap");
    let side = mySide;
    if (!side) {
      side = !seats.who.A ? "A" : "B";
      await seats.sit(side, summary({ line: every((w) => w.plays(first(me))) }));
    }
    const them = seats.who[other(side)];
    const theyMoved = them ? sealedRound.sealed.includes(them) : false;
    // Whoever moves first tells the other it is their move; whoever moves
    // second tells the first to open theirs.
    const told = theyMoved ? { turn: them } : seats.ping(other(side));
    await sealedRound.seal(move, summary({ line: every((w) => w.inEnvelope(first(me))), ...told }));
  };

  // A new match from the next round; the other player is called to it.
  const reset = () => {
    apply({ set: { path: "from", value: current } }, summary({ line: every((w) => w.fresh), ...(mySide ? seats.ping(other(mySide)) : {}) }));
    sound("pop");
  };

  const title = over
    ? (seats.who[matchWinner] === me ? w.youWon(WIN, Math.min(score.A, score.B)) : w.won(first(seats.who[matchWinner]), WIN, Math.min(score.A, score.B)))
    : !seats.who.A && !seats.who.B && rounds.length === 0 ? w.title
    : w.round(current - from + 1, score.A, score.B);

  const status = over ? ""
    : sealedRound.broken.length ? w.broken(first(sealedRound.broken[0]))
    : !mySide ? (seats.full ? w.watch : sealedRound.sealed.length ? w.theirs(first(sealedRound.sealed[0])) : w.take)
    : iSealed && sealedRound.mine === undefined && sealedRound.opened[me] === undefined ? w.elsewhere
    : iSealed && !theySealed ? (seats.who[theirSide] ? w.sealed(first(seats.who[theirSide])) : w.alone)
    : iSealed && theySealed && sealedRound.opened[seats.who[theirSide]] !== undefined ? ""
    : iSealed && theySealed ? w.opens(first(seats.who[theirSide]))
    : theySealed ? w.theirs(first(seats.who[theirSide]))
    : w.pick;

  // A hand for one side: the round just played (shaken, then opened), or the
  // round being played — this phone's own sealed move shown faded to its
  // owner only, anyone else's as an envelope.
  const hand = (side) => {
    const user = seats.who[side];
    // The round just played stays up until someone moves in the next one;
    // it shakes and opens only when it was played while the post was open.
    const showLast = last && sealedRound.sealed.length === 0;
    const fresh = showLast && shown === rounds.length;
    if (showLast) {
      const move = side === "A" ? last.a : last.b;
      const winner = last.win === side;
      return (
        <div key={`${side}-${last.k}`} style={{ position: "relative", fontSize: "clamp(44px, 20cqmin, 88px)", lineHeight: 1 }}>
          {fresh ? (
            <>
              <span className="rps-shake" style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "center" }}>✊</span>
              <span className="rps-reveal" style={{ display: "block", filter: winner || !last.win ? "none" : "grayscale(0.6) opacity(0.6)" }}>{HAND[move]}</span>
            </>
          ) : (
            <span style={{ display: "block", filter: winner || !last.win ? "none" : "grayscale(0.6) opacity(0.6)" }}>{HAND[move]}</span>
          )}
        </div>
      );
    }
    const sealed = user && sealedRound.sealed.includes(user);
    const mine = user === me ? sealedRound.mine : undefined;
    return (
      <div style={{ fontSize: "clamp(44px, 20cqmin, 88px)", lineHeight: 1, opacity: mine ? 0.55 : 1 }}>
        {mine ? HAND[mine] : sealed ? "✉️" : "❔"}
      </div>
    );
  };

  // A party (§ 5.76): two hands facing each other over «VS», three moves to
  // pick from in the chat row, the rounds in the full view.
  return (
    <Scene theme="party">
      <style>{CSS}</style>
      <Stack>
        <Text variant="title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</Text>
        <Fill>
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "space-around", gap: 8 }}>
            {["A", "B"].map((side) => (
              <div key={side} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0, flex: "1 1 0" }}>
                {hand(side)}
                <Text variant="caption" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                  {seats.who[side] ? (seats.who[side] === me ? w.you : first(seats.who[side])) : "—"} · {score[side]}
                </Text>
              </div>
            ))}
          </div>
        </Fill>
        {status && <Meta>{status}</Meta>}
        {canPick ? (
          <Grid cols={3}>
            {MOVES.map((m) => (
              <Choice
                key={m}
                onPress={() => pick(m)}
                label={
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, width: "100%" }}>
                    <span style={{ fontSize: 26, lineHeight: 1 }}>{HAND[m]}</span>
                    <span style={{ fontSize: 13 }}>{w.move[m]}</span>
                  </span>
                }
              />
            ))}
          </Grid>
        ) : over ? (
          <Row between>
            <Meta>{w.bestOf}</Meta>
            <Button onPress={reset}>{w.again}</Button>
          </Row>
        ) : null}
        <Only in="expanded">
          <Meta>{w.history}: {rounds.length ? rounds.map((r) => `${HAND[r.a]}${HAND[r.b]}`).join("  ") : "—"}</Meta>
          {last && <Meta>{w.last(last.k - from + 1, `${first(seats.who.A)} ${HAND[last.a]}`, `${first(seats.who.B)} ${HAND[last.b]}`, last.win ? first(seats.who[last.win]) : w.draw)}</Meta>}
        </Only>
      </Stack>
    </Scene>
  );
}
