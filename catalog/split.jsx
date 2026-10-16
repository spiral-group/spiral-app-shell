import { useState, useEffect, useRef } from "react";
import { Spiral, useSharedState, summary } from "@spiral/sdk";
import { Scene, Text, Counter, Input, Row, Stack, Fill, Hero, Meta } from "@spiral/ui";

// The post's own words, in the language of whoever is looking at it. The
// currency is the room's, not the reader's: the bill is one bill.
const CURRENCY = "₴";
const WORDS = {
  uk: { locale: "uk-UA", title: "Розділити рахунок", amount: "Сума рахунку", people: "Людей", tip: "Чайові %", each: "З кожного", total: (t, tip) => `Разом ${t} · чайові ${tip}`, line: (e, p, t) => `По ${e} з кожного (${p} ос., чайові ${t}%)` },
  ru: { locale: "ru-RU", title: "Разделить счёт", amount: "Сумма счёта", people: "Человек", tip: "Чаевые %", each: "С каждого", total: (t, tip) => `Итого ${t} · чаевые ${tip}`, line: (e, p, t) => `По ${e} с каждого (${p} чел., чаевые ${t}%)` },
  en: { locale: "en-US", title: "Split the bill", amount: "Bill amount", people: "People", tip: "Tip %", each: "Each", total: (t, tip) => `Total ${t} · tip ${tip}`, line: (e, p, t) => `${e} each (${p === 1 ? "1 person" : `${p} people`}, ${t}% tip)` },
};

// The viewer's language — or, from a runtime older than the host saying it,
// the frame's own, which is the phone's.
const language = () => Spiral.language ?? String(navigator.language ?? "").slice(0, 2);
// The line an action writes to the card, once per language, so each reader's
// phone shows its own (§ 5.68).
const every = (say) => Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, say(w)]));
// Money as a reader of that language writes it: «1 375,5 ₴», «1,375.5 ₴».
const money = (w, n) => `${(Math.round(n * 100) / 100).toLocaleString(w.locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${CURRENCY}`;
const parse = (s) => Math.round(Math.max(0, Math.min(10000000, Number(String(s).replace(",", ".")) || 0)) * 100) / 100;

// How long the field waits after the last keystroke before the sum goes to
// the room: one action for «1250», not one per digit.
const SETTLE_MS = 700;

export default function App() {
  const w = WORDS[language()] ?? WORDS.en;
  const [state, apply] = useSharedState();
  const amount = typeof state.amount === "number" ? state.amount : 0;
  const people = typeof state.people === "number" ? state.people : 3;
  const tip = typeof state.tip === "number" ? state.tip : 10;

  // The field keeps what is being typed until it settles. It used to write on
  // every keystroke and drop the draft whenever the room's sum differed from
  // it — and this phone's own earlier digit, coming back from the room while
  // the next was still on its way, differed: «1250» typed at a normal pace
  // landed as 120 on every phone (§ 5.80).
  const [draft, setDraft] = useState(null);
  const sent = useRef(null);
  const waiting = useRef(null);
  // What is being typed counts at once, on this phone; the room hears it
  // when it settles.
  const sum = draft !== null ? parse(draft) : amount;

  const write = (key, value, next) => {
    const a = next.amount ?? sum, p = next.people ?? people, t = next.tip ?? tip;
    const e = p > 0 ? (a * (1 + t / 100)) / p : 0;
    apply({ set: { path: key, value } }, summary({ line: every((w) => w.line(money(w, e), p, t)) }));
  };

  const commit = () => {
    if (!waiting.current) return;
    clearTimeout(waiting.current.timer);
    const n = parse(waiting.current.text);
    waiting.current = null;
    sent.current = n;
    if (n !== amount) write("amount", n, { amount: n });
  };

  const onAmount = (v) => {
    const text = String(v);
    setDraft(text);
    if (waiting.current) clearTimeout(waiting.current.timer);
    waiting.current = { text, timer: setTimeout(commit, SETTLE_MS) };
  };

  // Leaving with a sum typed still sends it.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => () => commitRef.current(), []);

  // Someone ELSE changed the sum: theirs wins over a draft — but not this
  // phone's own write coming back, and not while typing goes on.
  useEffect(() => {
    if (draft === null || waiting.current) return;
    if (amount === sent.current || amount === parse(draft)) return;
    setDraft(null);
  }, [amount]);

  const total = sum * (1 + tip / 100);
  const each = people > 0 ? total / people : 0;

  // A page of the notebook (§ 5.76): the sum, the people and the tip, and
  // what each pays — gone over with a highlighter.
  return (
    <Scene theme="paper">
      <Stack>
        <Text variant="title">{w.title}</Text>
        <Input kind="number" value={draft ?? (amount ? String(amount) : "")} onChange={onAmount} placeholder={`${w.amount}, ${CURRENCY}`} />
        <Row between>
          <Stack gap={2}>
            <Meta>{w.people}</Meta>
            <Counter label={w.people} value={people} min={1} max={50} onChange={(v) => { commit(); write("people", v, { people: v }); }} />
          </Stack>
          <Stack gap={2} align="end">
            <Meta>{w.tip}</Meta>
            <Counter label={w.tip} value={tip} min={0} max={50} onChange={(v) => { commit(); write("tip", v, { tip: v }); }} />
          </Stack>
        </Row>
        <Fill>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <Hero style={{ padding: "0 10px", borderRadius: 6, background: "linear-gradient(transparent 38%, rgb(253 224 71 / 0.75) 38%, rgb(253 224 71 / 0.75) 88%, transparent 88%)" }}>{money(w, each)}</Hero>
          </div>
        </Fill>
        <Meta>{w.each} · {w.total(money(w, total), money(w, total - sum))}</Meta>
      </Stack>
    </Scene>
  );
}
