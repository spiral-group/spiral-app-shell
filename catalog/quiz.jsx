import { useEffect, useState } from "react";
import { Spiral, useSharedState, useOwnState, useRoomMembers, useSound, useHaptic, summary } from "@spiral/sdk";
import { Scene, Text, Choice, Stack, Fill, Meta, List, Row, Avatar, Only } from "@spiral/ui";

// The post's own words — and this template's own questions — in the
// language of whoever is looking at it. Answers are kept by index, so two
// people reading in two languages take the same quiz.
const WORDS = {
  uk: {
    questions: [
      { q: "Столиця Австралії?", options: ["Сідней", "Канберра", "Мельбурн"] },
      { q: "Столиця Канади?", options: ["Торонто", "Ванкувер", "Оттава"] },
      { q: "Столиця Туреччини?", options: ["Анкара", "Стамбул", "Ізмір"] },
    ],
    progress: (i, n, done) => `Питання ${i} з ${n} · пройшли ${done}`,
    yours: (s, n) => `Твій результат: ${s}/${n}`,
    waiting: (done) => `Пройшли ${done} · чекаємо на інших`, all: (done) => `Пройшли всі: ${done}`, right: "Правильно!", wrong: (a) => `Ні — ${a}`,
    line: (name, s, n, done) => `${name}: ${s}/${n} · пройшли ${done}`,
  },
  ru: {
    questions: [
      { q: "Столица Австралии?", options: ["Сидней", "Канберра", "Мельбурн"] },
      { q: "Столица Канады?", options: ["Торонто", "Ванкувер", "Оттава"] },
      { q: "Столица Турции?", options: ["Анкара", "Стамбул", "Измир"] },
    ],
    progress: (i, n, done) => `Вопрос ${i} из ${n} · прошли ${done}`,
    yours: (s, n) => `Твой результат: ${s}/${n}`,
    waiting: (done) => `Прошли ${done} · ждём остальных`, all: (done) => `Прошли все: ${done}`, right: "Верно!", wrong: (a) => `Нет — ${a}`,
    line: (name, s, n, done) => `${name}: ${s}/${n} · прошли ${done}`,
  },
  en: {
    questions: [
      { q: "Capital of Australia?", options: ["Sydney", "Canberra", "Melbourne"] },
      { q: "Capital of Canada?", options: ["Toronto", "Vancouver", "Ottawa"] },
      { q: "Capital of Turkey?", options: ["Ankara", "Istanbul", "Izmir"] },
    ],
    progress: (i, n, done) => `Question ${i} of ${n} · ${done} finished`,
    yours: (s, n) => `Your score: ${s}/${n}`,
    waiting: (done) => `${done} finished · waiting for the rest`, all: (done) => `Everyone finished: ${done}`, right: "Right!", wrong: (a) => `No — ${a}`,
    line: (name, s, n, done) => `${name}: ${s}/${n} · ${done} finished`,
  },
};
const ANSWERS = [1, 2, 0];

// The viewer's language — or, from a runtime older than the host saying it,
// the frame's own, which is the phone's.
const language = () => Spiral.language ?? String(navigator.language ?? "").slice(0, 2);
// The line an action writes to the card, once per language, so each reader's
// phone shows its own (§ 5.68).
const every = (say) => Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, say(w)]));

const scoreOf = (own) =>
  ANSWERS.reduce((s, answer, i) => s + (own?.[`a${i}`] === answer ? 1 : 0), 0);
const doneOf = (own) => ANSWERS.every((_, i) => typeof own?.[`a${i}`] === "number");

export default function App() {
  const w = WORDS[language()] ?? WORDS.en;
  const QUESTIONS = w.questions.map((q, i) => ({ ...q, answer: ANSWERS[i] }));
  const [state, apply] = useSharedState();
  const [mine, setMine] = useOwnState();
  const members = useRoomMembers();
  const sound = useSound();
  const haptic = useHaptic();

  const by = state.by ?? {};
  const step = QUESTIONS.findIndex((_, i) => typeof mine?.[`a${i}`] !== "number");
  const finished = step === -1;

  const nameOf = (id) => members?.find((m) => m.userId === id)?.displayName ?? id.split(":")[0].replace("@", "");
  const results = Object.entries(by)
    .filter(([, own]) => doneOf(own))
    .map(([id, own]) => ({ id, name: nameOf(id), score: scoreOf(own) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  // The answer shows before the next question takes its place: the picked
  // one, the right one, a word — and only then is it written (§ 5.80). The
  // next question used to replace the answered one in the same frame, so a
  // player never saw whether they were right, and a second tap answered the
  // next question with the same letter.
  const [shown, setShown] = useState(null);
  const pick = (idx) => {
    if (shown || finished) return;
    const q = QUESTIONS[step];
    const right = idx === q.answer;
    sound(right ? "pick" : "tap");
    haptic(right ? "success" : "light");
    setShown({ step, idx });
  };
  useEffect(() => {
    if (!shown) return undefined;
    const t = setTimeout(() => {
      const { step: at, idx } = shown;
      setShown(null);
      if (at !== QUESTIONS.length - 1) {
        setMine(`a${at}`, idx);
        return;
      }
      // The last answer carries the line: one action.
      const score = scoreOf({ ...mine, [`a${at}`]: idx });
      const count = results.filter((r) => r.id !== Spiral.viewer).length + 1;
      setMine(`a${at}`, idx, summary({ line: every((w) => w.line(nameOf(Spiral.viewer), score, QUESTIONS.length, count)) }))?.catch?.(() => {});
    }, 1000);
    return () => clearTimeout(t);
  }, [shown]);

  if (!finished) {
    const q = QUESTIONS[step];
    // A quiz show (§ 5.76): the question on the screen, the answers as
    // lettered buttons, the round as a row of lights.
    return (
      <Scene theme="arcade">
        <Stack>
          <Row>
            <span className="s-chip">{`${step + 1}/${QUESTIONS.length}`}</span>
            <div style={{ display: "flex", gap: 5 }}>
              {QUESTIONS.map((_, i) => (
                <span key={i} style={{ width: 8, height: 8, borderRadius: 4, background: i < step ? "var(--s-accent)" : i === step ? "#ffffff" : "rgb(255 255 255 / 0.25)" }} />
              ))}
            </div>
          </Row>
          <Text variant="title">{q.q}</Text>
          <Fill>
            <Stack>
              {q.options.map((o, i) => {
                const mark = !shown ? "" : i === q.answer ? "✓" : i === shown.idx ? "✗" : "";
                return (
                  <Choice
                    key={o}
                    label={`${"ABCD"[i]}  ${o}`}
                    onPress={() => pick(i)}
                    picked={shown ? i === q.answer : false}
                    detail={mark || undefined}
                    disabled={Boolean(shown) && i !== q.answer && i !== shown.idx}
                  />
                );
              })}
            </Stack>
          </Fill>
          <Meta>{shown ? (shown.idx === q.answer ? w.right : w.wrong(q.options[q.answer])) : w.progress(step + 1, QUESTIONS.length, results.length)}</Meta>
        </Stack>
      </Scene>
    );
  }

  const myScore = scoreOf(mine);
  return (
    <Scene theme="arcade">
      <Stack>
        <Text variant="title">🏆 {w.yours(myScore, QUESTIONS.length)}</Text>
        <Fill>
          <List items={results} keyOf={(r) => r.id} separated max={3} expandedMax={20}>
            {(r) => (
              <Row between>
                <Row style={{ flex: 1, minWidth: 0 }}>
                  <Avatar name={r.name} userId={r.id} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="body" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</Text>
                  </div>
                </Row>
                <Text variant="body">{r.score}/{QUESTIONS.length}</Text>
              </Row>
            )}
          </List>
          <Only in="expanded">
            <Stack>
              {QUESTIONS.map((q, i) => (
                <Text key={q.q} variant="caption">
                  {mine?.[`a${i}`] === q.answer ? "✓" : "✗"} {q.q} — {q.options[q.answer]}
                </Text>
              ))}
            </Stack>
          </Only>
        </Fill>
        {/* «Waiting for the rest» only while someone in the room has not
            finished: it said so for ever, alone too. */}
        <Meta>{results.length >= (members?.length ?? Infinity) ? w.all(results.length) : w.waiting(results.length)}</Meta>
      </Stack>
    </Scene>
  );
}
