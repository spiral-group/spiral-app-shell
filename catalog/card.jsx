import { useState } from "react";
import { Spiral, useSharedState, useOwnState, useRoomMembers, useChanged, useSound, useHaptic, summary } from "@spiral/sdk";
import { Scene, Text, Button, Stack, Fill, Meta, Row, Avatar, Only } from "@spiral/ui";

const CSS = `
@keyframes olya-burst { 0% { transform: scale(0.4); opacity: 0 } 40% { transform: scale(1.25); opacity: 1 } 100% { transform: scale(1) translateY(-18px); opacity: 0 } }
.olya-burst { animation: olya-burst 900ms ease-out forwards; }
`;

// THE OWNER'S WORDS. The agent writes them from the owner's answer — to
// whom, and the occasion — as plain strings in the owner's language: one
// language, as written, for every reader. Until then they are the
// catalogue's example, and an example speaks each viewer's language
// ({ uk, ru, en }, read through `said`, § 5.81).
const CARD = {
  emoji: "🎂",
  headline: { uk: "З днем народження!", ru: "С днём рождения!", en: "Happy birthday!" },
  line: {
    uk: "Щастя, натхнення і море радості — від усієї команди 💛",
    ru: "Счастья, вдохновения и моря радости — от всей команды 💛",
    en: "Joy, inspiration and a sea of happiness — from all of us 💛",
  },
  // The look: party for a birthday or a win, night for something tender,
  // sky for thanks, poster for an announcement (§ 5.76).
  theme: "party",
};

// One, few, many — Ukrainian and Russian count in three forms.
const slavic = (n, one, few, many) => {
  const d = n % 10;
  const h = n % 100;
  if (h >= 11 && h <= 14) return many;
  if (d === 1) return one;
  if (d >= 2 && d <= 4) return few;
  return many;
};

// The post's own words, in the language of whoever is looking at it.
const WORDS = {
  uk: { greet: "Привітати", done: "Ви привітали", greeted: "Вже привітали:", nobody: "Поки ніхто — будь першим!", count: (n) => `Привітали: ${n}`, line: (n) => `${CARD.emoji} Привітали вже ${n}!` },
  ru: { greet: "Поздравить", done: "Вы поздравили", greeted: "Уже поздравили:", nobody: "Пока никто — будь первым!", count: (n) => `Поздравили: ${n}`, line: (n) => `${CARD.emoji} Поздравили уже ${n}!` },
  en: { greet: "Send wishes", done: "You sent wishes", greeted: "Wished already:", nobody: "Nobody yet — be the first!", count: (n) => `${n} ${n === 1 ? "wish" : "wishes"} so far`, line: (n) => `${CARD.emoji} ${n} ${n === 1 ? "wish" : "wishes"} so far!` },
};

// The viewer's language — or, from a runtime older than the host saying it,
// the frame's own, which is the phone's.
const language = () => Spiral.language ?? String(navigator.language ?? "").slice(0, 2);
// The owner's words are a string, the same for every reader; the example is
// { uk, ru, en } and follows the viewer.
const said = (words, l = language()) =>
  typeof words === "string" ? words : words?.[l] ?? words?.en ?? Object.values(words ?? {})[0] ?? "";
// The line an action writes to the card, once per language, so each reader's
// phone shows its own (§ 5.68).
const every = (say) => Object.fromEntries(Object.entries(WORDS).map(([l, w]) => [l, say(w, l)]));

export default function App() {
  const w = WORDS[language()] ?? WORDS.en;
  const [state, apply] = useSharedState();
  const [mine, setMine] = useOwnState();
  const members = useRoomMembers();
  const sound = useSound();
  const haptic = useHaptic();
  const [burst, setBurst] = useState(0);

  // PEOPLE who wished, by user id — not taps: twenty taps from one person
  // made «wished 21 times» over a list of one name (§ 5.80).
  const greeters = Object.entries(state.by ?? {}).filter(([, own]) => own?.greeted).map(([id]) => id).sort();
  const count = greeters.length;
  const nameOf = (id) => members?.find((m) => m.userId === id)?.displayName ?? id.replace(/^@/, "").split(":")[0];

  // Anyone's wish bursts on every phone that has the card open.
  useChanged(count, (n, before) => { if (n > before) setBurst((b) => b + 1); });

  // A first wish is one action; after it a tap is a burst of your own.
  const greet = () => {
    sound("win");
    haptic("success");
    if (mine?.greeted) {
      setBurst((b) => b + 1);
      return;
    }
    const next = count + 1;
    setMine("greeted", true, summary({ line: every((w) => w.line(next)) }))?.catch?.(() => {});
  };

  // A party (§ 5.76): the cake floats, the headline is in marker, the one
  // button is the scene's white pill, and every wish bursts a little.
  return (
    <Scene theme={CARD.theme}>
      <style>{CSS}</style>
      <Stack center>
        <Fill>
          <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, textAlign: "center" }}>
            <div style={{ position: "relative", fontSize: "clamp(40px, 17cqmin, 76px)", lineHeight: 1 }}>
              <span className="s-float" style={{ display: "inline-block" }}>{CARD.emoji}</span>
              {burst > 0 && (
                <span key={burst} className="olya-burst" style={{ position: "absolute", left: "72%", top: -8, fontSize: "0.5em" }}>🎉</span>
              )}
            </div>
            <Text variant="title" style={{ fontSize: "clamp(21px, 9cqmin, 38px)", lineHeight: 1.1 }}>{said(CARD.headline)}</Text>
            <Text variant="caption">{said(CARD.line)}</Text>
          </div>
        </Fill>
        <Button onPress={greet} variant={mine?.greeted ? "secondary" : "primary"}>{mine?.greeted ? `${w.done} ✓` : `${w.greet} 🎉`}</Button>
        <Meta align="center">{count > 0 ? w.count(count) : w.nobody}</Meta>
        <Only in="expanded">
          <Stack center>
            <Text variant="caption">{w.greeted}</Text>
            {greeters.length > 0 && (
              <Row>
                {greeters.slice(0, 8).map((id) => (
                  <Avatar key={id} name={nameOf(id)} userId={id} src={members?.find((m) => m.userId === id)?.avatarUrl} size={28} />
                ))}
              </Row>
            )}
            {greeters.length > 0 && <Meta align="center">{greeters.map(nameOf).join(", ")}</Meta>}
          </Stack>
        </Only>
      </Stack>
    </Scene>
  );
}
