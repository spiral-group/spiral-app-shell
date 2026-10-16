import { useEffect, useRef, useState } from "react";
import { Spiral, useSharedState, useRoomMembers, useChanged, useSound, useHaptic, summary } from "@spiral/sdk";
import { Scene, Stack, Fill, Row, Text, Meta, Button, accent } from "@spiral/ui";

const GOAL = 15; // pulls per player it takes to drag the ribbon over your line
const REACH = 26; // how far the goal lines are from the middle, in % of the field
const SEND_MS = 500; // taps go to the room twice a second, summed

// The post's own words, in the language of whoever is looking at it.
const WORDS = {
  uk: {
    title: "Перетягування каната", T: { L: "Сині", R: "Червоні" }, by: { L: "синіх", R: "червоних" },
    joined: (n, t) => `${n} тягне за ${t}`, waiting: "Чекаємо на суперника", need: (t) => `Потрібен хтось за ${t}`,
    pull: "Тягніть!", lead: (t) => `${t} ведуть`, even: "Нарівно", won: (t) => `${t} перемагають!`,
    hint: "Торкайтеся якомога частіше", join: "Торкніться — і ви в команді", again: "Ще раз", fresh: "Новий раунд",
  },
  ru: {
    title: "Перетягивание каната", T: { L: "Синие", R: "Красные" }, by: { L: "синих", R: "красных" },
    joined: (n, t) => `${n} тянет за ${t}`, waiting: "Ждём соперника", need: (t) => `Нужен кто-то за ${t}`,
    pull: "Тяните!", lead: (t) => `${t} ведут`, even: "Поровну", won: (t) => `${t} побеждают!`,
    hint: "Касайтесь как можно чаще", join: "Коснитесь — и вы в команде", again: "Ещё раз", fresh: "Новый раунд",
  },
  en: {
    title: "Tug of war", T: { L: "Blue", R: "Red" }, by: { L: "Blue", R: "Red" },
    joined: (n, t) => `${n} pulls for ${t}`, waiting: "Waiting for an opponent", need: (t) => `Someone has to pull for ${t}`,
    pull: "Pull!", lead: (t) => `${t} leads`, even: "Dead even", won: (t) => `${t} wins!`,
    hint: "Tap as fast as you can", join: "Tap to join a team", again: "Again", fresh: "New round",
  },
};
const language = () => Spiral.language ?? String(navigator.language ?? "").slice(0, 2);
const every = (say) => Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, say(w)]));
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

export default function App() {
  const w = WORDS[language()] ?? WORDS.en;
  const [state, apply] = useSharedState();
  const members = useRoomMembers();
  const sound = useSound();
  const haptic = useHaptic();
  const me = Spiral.viewer;

  // Teams by the ROOM's order of joining — first Blue, then Red, and so on.
  // Each phone used to pick the smaller team from what it could see, so two
  // people joining at once both saw it empty and both became Blue, with
  // nobody left to pull against (§ 5.80).
  const joined = [...new Set((Array.isArray(state.joined) ? state.joined : []).filter((id) => typeof id === "string"))];
  const teamOf = (id) => { const i = joined.indexOf(id); return i < 0 ? null : i % 2 === 0 ? "L" : "R"; };
  // Everything about a round is kept under its number, so a pull or a claim
  // still on its way from the last round cannot land in this one. The first
  // round is 0: «Again» used to add 1 to nothing and start round 1 again,
  // which every phone that had claimed round 1 then refused to claim (§ 5.80).
  const round = Number(state.round) || 0;
  const pullsNow = isObject(state.pulls) && isObject(state.pulls[String(round)]) ? state.pulls[String(round)] : {};
  const winners = isObject(state.winners) ? state.winners : {};
  const winner = winners[String(round)] === "L" || winners[String(round)] === "R" ? winners[String(round)] : null;
  const mine = teamOf(me);
  const roster = { L: [], R: [] };
  for (const id of joined) roster[teamOf(id)].push(id);
  const nameOf = (id) => members?.find((m) => m.userId === id)?.displayName ?? id.replace(/^@/, "").split(":")[0];
  const myName = nameOf(me);
  const ready = roster.L.length > 0 && roster.R.length > 0;

  // My taps since the last send: shown at once, sent once a second.
  const unsent = useRef(0);
  const timer = useRef(undefined);
  const [, redraw] = useState(0);
  const send = () => {
    timer.current = undefined;
    const k = unsent.current;
    unsent.current = 0;
    if (k > 0 && mine) apply({ incr: { path: ["pulls", String(round), me], by: k } });
  };
  useEffect(() => () => { clearTimeout(timer.current); send(); }, [mine]);

  // Pulls per player PULLING this round, so three who pull beat one who
  // does, one who pulls hard beats three who do not — and a teammate who
  // left the chat long ago does not halve the team. + is Blue's way.
  const per = (t) => {
    let sum = 0, pulling = 0;
    for (const id of roster[t]) {
      const n = (Number(pullsNow[id]) || 0) + (id === me ? unsent.current : 0);
      if (n > 0) { sum += n; pulling += 1; }
    }
    return sum / Math.max(1, pulling);
  };
  const lead = ready ? per("L") - per("R") : 0;
  const pos = winner ? (winner === "L" ? GOAL : -GOAL) : Math.max(-GOAL, Math.min(GOAL, lead));

  // Whoever sees the ribbon over a line says so; of two at once, the room
  // keeps the first (setIfAbsent), so every phone shows the same winner.
  const claimed = useRef(-1);
  useEffect(() => {
    if (winner || !ready || Math.abs(lead) < GOAL || claimed.current === round) return;
    claimed.current = round;
    if (unsent.current > 0) { clearTimeout(timer.current); send(); }
    const t = lead > 0 ? "L" : "R";
    apply({ setIfAbsent: { path: ["winners", String(round)], value: t } }, summary({ line: every((w) => w.won(w.T[t])) }));
  });
  // Heard by everyone pulling when it lands — not when a finished game opens.
  useChanged(winner, (t) => {
    if (!t || !mine) return;
    sound(t === mine ? "win" : "lose");
    haptic(t === mine ? "success" : "warning");
  });

  const tap = () => {
    if (winner) return;
    if (!mine) {
      // In the order the room hears it (see `teamOf`). The first one in a
      // chat of two calls the other.
      const t = joined.length % 2 === 0 ? "L" : "R";
      const other = members?.length === 2 && joined.length === 0 ? members.find((m) => m.userId !== me)?.userId : undefined;
      apply({ listAppend: { path: "joined", item: me } }, summary({ line: every((w) => w.joined(myName, w.by[t])), ...(other ? { challenge: other } : {}) }));
      sound("pop");
      haptic("medium");
      return;
    }
    if (!ready) return;
    unsent.current += 1;
    if (timer.current === undefined) timer.current = setTimeout(send, SEND_MS);
    redraw((n) => n + 1);
    haptic("light");
  };

  const reset = () => {
    // The next round by number, the same from every phone that presses at
    // once; the last round's pulls go, its winner is kept.
    apply({ batch: { ops: [
      { set: { path: "pulls", value: {} } },
      { set: { path: "round", value: round + 1 } },
    ] } }, summary({ line: every((w) => w.fresh) }));
    sound("pop");
  };

  const title = winner ? w.won(w.T[winner])
    : roster.L.length + roster.R.length === 0 ? w.title
    : !ready ? w.waiting
    : Math.abs(lead) < 0.5 ? (Object.keys(pullsNow).length === 0 && unsent.current === 0 ? w.pull : w.even)
    : w.lead(w.T[lead > 0 ? "L" : "R"]);
  const hint = winner ? "" : !mine ? w.join : !ready ? w.need(w.by[mine === "L" ? "R" : "L"]) : w.hint;
  const color = { L: accent(0), R: accent(1) };

  // A sports field (§ 5.76): a rope across it, a yellow ribbon in the
  // middle, a dashed line for each team. The rope slides as it is pulled;
  // the teams stand at their ends, one circle a player.
  const heads = (t) => (
    <div style={{ position: "absolute", top: "50%", [t === "L" ? "left" : "right"]: "2%", transform: "translateY(-50%)", display: "flex", flexDirection: t === "L" ? "row" : "row-reverse" }}>
      {roster[t].slice(0, 3).map((id, i) => (
        <div
          key={id}
          style={{
            width: 32, height: 32, borderRadius: 16, marginLeft: t === "L" && i ? -10 : 0, marginRight: t === "R" && i ? -10 : 0,
            background: color[t], color: "#0f172a", boxShadow: "0 0 0 2px #14532d", display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 15, zIndex: 3 - i,
          }}
        >
          {nameOf(id)[0]?.toUpperCase()}
        </div>
      ))}
    </div>
  );
  return (
    <Scene theme="field">
      <Stack>
        <Text variant="title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</Text>
        <Fill>
          <div className="tw-arena" onPointerDown={tap} style={{ position: "relative", height: "100%", overflow: "hidden", borderRadius: 12, touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}>
            <div style={{ position: "absolute", top: "10%", bottom: "10%", left: "50%", borderLeft: "2px solid rgb(255 255 255 / 0.45)" }} />
            {["L", "R"].map((t) => (
              <div key={t} style={{ position: "absolute", top: "10%", bottom: "10%", left: `${50 + (t === "L" ? -REACH : REACH)}%`, borderLeft: `3px dashed ${color[t]}` }} />
            ))}
            <div style={{ position: "absolute", inset: 0, transform: `translateX(${(-pos / GOAL) * REACH}%)`, transition: "transform 0.9s cubic-bezier(0.2, 0.8, 0.2, 1)" }}>
              <div style={{ position: "absolute", left: "-30%", right: "-30%", top: "50%", height: 9, marginTop: -4.5, borderRadius: 5, background: "repeating-linear-gradient(135deg, #92400e 0 5px, #d97706 5px 10px)", boxShadow: "0 2px 0 rgb(0 0 0 / 0.35)" }} />
              <div style={{ position: "absolute", left: "50%", top: "50%", width: 12, height: 36, margin: "-18px 0 0 -6px", borderRadius: 3, background: "#fde047", boxShadow: "0 0 0 2px #14532d" }} />
            </div>
            {heads("L")}
            {heads("R")}
            {hint && (
              <div className="s-hud" style={{ position: "absolute", left: 0, right: 0, bottom: "6%", textAlign: "center", fontSize: "clamp(13px, 5cqmin, 18px)", pointerEvents: "none" }}>
                {hint}
              </div>
            )}
          </div>
        </Fill>
        <Row between>
          <Meta style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
            <span style={{ color: color.L }}>●</span> {roster.L.map((id) => nameOf(id).split(" ")[0]).join(", ") || "—"}
            &nbsp;&nbsp;
            <span style={{ color: color.R }}>●</span> {roster.R.map((id) => nameOf(id).split(" ")[0]).join(", ") || "—"}
          </Meta>
          {winner && <Button onPress={reset}>{w.again}</Button>}
        </Row>
      </Stack>
    </Scene>
  );
}
