/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 step 6.11 — the LAYOUT LAB.

A gallery of the shapes an Interactive Post takes — a board, a wheel, a
poll, a quiz, a leaderboard, a greeting card, a counter, a form, tiles —
each written the way the generator SHOULD write it: kit layout only, no
pixel larger than an icon, the mini/full split where the content has more
than a row can hold. Mounted on the device in the real row and the real
viewer, it answers, with the bootstrap's ruler (`measure.ts`): does this
pattern fit, at every aspect, in both modes?

What passes here becomes the prompt's examples and, where a pattern needs a
component to be reliable (the board did), the kit's. What fails here is a
bug in the kit, not in the model.

Paging is local state; "measure" asks the bootstrap to run the ruler again
after a page change (it runs on paint and on viewport change by itself).
*/

import { useCallback, useEffect, useRef, useState } from "react";
import { useExpand, useFrame, useHaptic, useSound, useViewport } from "@spiral/sdk";
import { fitCanvas } from "@spiral/play";
import {
  Avatar,
  Board,
  Button,
  Card,
  Check,
  Choice,
  Counter,
  Fill,
  Grid,
  Hero,
  Input,
  List,
  Meta,
  Only,
  Progress,
  Row,
  Square,
  Stack,
  Text,
} from "@spiral/ui";

// ---------------------------------------------------------------- patterns

const CHESS = "rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR";
const GLYPH: Record<string, string> = {
  r: "♜", n: "♞", b: "♝", q: "♛", k: "♚", p: "♟",
  R: "♖", N: "♘", B: "♗", Q: "♕", K: "♔", P: "♙",
};
const MOVES = ["e2-e4", "e7-e5", "Ng1-f3", "Nb8-c6", "Bf1-b5", "a7-a6", "Bb5-a4", "Ng8-f6"];

const Chess = () => {
  const [sel, setSel] = useState<number | null>(null);
  return (
    <Stack>
      <Row between>
        <Text variant="caption">⚪ Андрій</Text>
        <Text variant="body">Хід білих</Text>
        <Text variant="caption">⚫ Emmm</Text>
      </Row>
      <Board cols={8}>
        {Array.from({ length: 64 }, (_, i) => {
          const dark = (Math.floor(i / 8) + i) % 2 === 1;
          const p = CHESS[i]!;
          return (
            <div
              key={i}
              onClick={() => setSel(i)}
              style={{ background: sel === i ? "#fef08a" : dark ? "#b88b4a" : "#f0d9b5" }}
            >
              {p === "." ? "" : GLYPH[p]}
            </div>
          );
        })}
      </Board>
      <Only in="expanded">
        <Text variant="title">Ходи</Text>
        <Fill scroll>
          <List items={MOVES.map((m, i) => ({ id: String(i), m }))} keyOf={(x) => x.id} separated>
            {(x, i) => <Text variant="body">{i + 1}. {x.m}</Text>}
          </List>
        </Fill>
        <Button onPress={() => {}} variant="secondary">Здатися</Button>
      </Only>
      <Meta>Останній хід: Bb5-a4</Meta>
    </Stack>
  );
};

const TicTacToe = () => {
  const [cells, setCells] = useState<string[]>(Array(9).fill(""));
  return (
    <Stack>
      <Text variant="title">Хрестики-нулики</Text>
      <Board cols={3}>
        {cells.map((c, i) => (
          <div
            key={i}
            onClick={() => setCells((prev) => prev.map((v, j) => (j === i ? (v ? "" : "X") : v)))}
            style={{ border: "1px solid var(--cpd-color-border-interactive-secondary)" }}
          >
            {c}
          </div>
        ))}
      </Board>
      <Row between>
        <Text variant="body">Хід: Андрій</Text>
        <Button onPress={() => setCells(Array(9).fill(""))} variant="secondary">Заново</Button>
      </Row>
    </Stack>
  );
};

const SEGMENTS = ["Піца", "Кіно", "Бар", "Настілки", "Караоке", "Похід"];
const COLOURS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#06b6d4"];
const Wheel = () => {
  const [angle, setAngle] = useState(0);
  const stops = SEGMENTS.map((_, i) => `${COLOURS[i]} ${(i * 100) / SEGMENTS.length}% ${((i + 1) * 100) / SEGMENTS.length}%`);
  return (
    <Stack>
      <Text variant="title">Плани на вечір</Text>
      <Square>
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            background: `conic-gradient(${stops.join(", ")})`,
            transform: `rotate(${angle}deg)`,
            transition: "transform 3s cubic-bezier(.17,.67,.12,.99)",
          }}
        />
        <div style={{ position: "absolute", top: -4, left: "50%", transform: "translateX(-50%)", fontSize: "1.2em" }}>▼</div>
      </Square>
      <Text variant="body">Крутніть, щоб обрати заняття</Text>
      <Button onPress={() => setAngle((a) => a + 1080 + Math.floor(Math.random() * 360))}>Крутити колесо</Button>
    </Stack>
  );
};

const OPTIONS = ["Карпати", "Львів", "Одеса", "Буковель"];
const Poll = () => {
  const [pick, setPick] = useState<string | null>(null);
  const shares = [0.4, 0.3, 0.2, 0.1];
  return (
    <Stack>
      <Text variant="title">Куди їдемо на вихідні?</Text>
      <Fill>
        <Stack>
          {OPTIONS.map((o, i) => (
            <Choice key={o} label={o} onPress={() => setPick(o)} picked={pick === o} {...(pick ? { share: shares[i]!, detail: `${Math.round(shares[i]! * 10)} голосів` } : {})} />
          ))}
        </Stack>
      </Fill>
      <Meta>10 голосів · голос можна змінити</Meta>
    </Stack>
  );
};

const QUESTIONS = Array.from({ length: 10 }, (_, i) => ({ q: `Питання ${i + 1}: столиця країни №${i + 1}?`, a: ["Київ", "Варшава", "Прага", "Відень"] }));
const Quiz = () => {
  const [n, setN] = useState(0);
  const q = QUESTIONS[n]!;
  return (
    <Stack>
      <Row between>
        <Text variant="caption">Питання {n + 1} з 10</Text>
        <Text variant="caption">Рахунок: 3</Text>
      </Row>
      <Progress value={(n + 1) / 10} />
      <Text variant="title">{q.q}</Text>
      <Grid cols={2}>
        {q.a.map((a) => (
          <Button key={a} onPress={() => setN((x) => (x + 1) % 10)} variant="secondary">{a}</Button>
        ))}
      </Grid>
      <Only in="expanded">
        <Fill scroll>
          <List items={QUESTIONS.map((x, i) => ({ id: String(i), ...x }))} keyOf={(x) => x.id} separated>
            {(x, i) => <Text variant="body">{i < n ? "✓" : "·"} {x.q}</Text>}
          </List>
        </Fill>
      </Only>
    </Stack>
  );
};

const PEOPLE = ["Андрій", "Emmm", "Оля", "Ігор", "Марта", "Сашко", "Ніна", "Юра", "Іра", "Тарас", "Леся", "Богдан"].map((name, i) => ({ id: String(i), name, steps: 12000 - i * 700 }));
const Leaderboard = () => (
  <Stack>
    <Text variant="title">🏃 Челендж кроків</Text>
    <Fill scroll>
      <List items={PEOPLE} keyOf={(p) => p.id} separated max={3}>
        {(p, i) => (
          <Row between>
            <Row>
              <Text variant="body">{i + 1}.</Text>
              <Avatar name={p.name} size={24} />
              <Text variant="body">{p.name}</Text>
            </Row>
            <Text variant="body">{p.steps}</Text>
          </Row>
        )}
      </List>
    </Fill>
    <Only in="row"><Meta>Моє місце: 5 · відкрити таблицю</Meta></Only>
    <Only in="expanded"><Button onPress={() => {}}>Оновити мої кроки</Button></Only>
  </Stack>
);

const Greeting = () => (
  <Card tone="sunset" center fill>
    <Text variant="caption">З днем народження</Text>
    <Hero>Оля 🎂</Hero>
    <Text variant="body">Нехай цей рік буде найкращим. Від усієї команди 🎉</Text>
    <Button onPress={() => {}} variant="secondary">Привітати ✨</Button>
    <Meta>12 привітань</Meta>
  </Card>
);

const Valentine = () => (
  <Stack>
    <Card tone="berry" center fill motion="pop">
      <div className="s-float" style={{ fontSize: "3em", lineHeight: 1 }}>💌</div>
      <Hero>Для Марти</Hero>
      <Text variant="body">Ти — найкраще, що сталося цього року</Text>
      <Row>
        <Button onPress={() => {}} variant="secondary">❤️ 24</Button>
        <Button onPress={() => {}}>Відповісти</Button>
      </Row>
    </Card>
  </Stack>
);

const QuietCard = () => (
  <Stack>
    <Card tone="mint" fill>
      <Text variant="title">Дякую, команда 🙏</Text>
      <Text variant="body">Реліз вийшов вчасно. Кожен доклав руку, і це видно.</Text>
      <Meta>Андрій · сьогодні</Meta>
    </Card>
    <Button onPress={() => {}}>Приєднатися до подяки</Button>
  </Stack>
);

// What the ruler must catch: text the theme cannot promise to show, and a
// frame drawn inside the bubble. Stays in the lab as its own regression.
const BadCard = () => (
  <Stack>
    <div style={{ border: "2px solid #888", borderRadius: 12, padding: 12, background: "#fff", color: "#f3f3f3" }}>
      <Text variant="title">Біле на білому</Text>
      <Text variant="body">Цей текст майже не видно.</Text>
    </div>
    <Text variant="body">Текст без фону — на сірому рядку</Text>
    <Button onPress={() => {}}>Кнопка</Button>
  </Stack>
);

const CounterPost = () => {
  const [n, setN] = useState(41);
  return (
    <Stack center>
      <Text variant="title">Разом випито кави ☕</Text>
      <Fill>
        <Hero>{n}</Hero>
      </Fill>
      <Row>
        <Button onPress={() => setN((x) => x - 1)} variant="secondary">−1</Button>
        <Button onPress={() => setN((x) => x + 1)}>+1</Button>
      </Row>
      <Meta>Останній: Андрій</Meta>
    </Stack>
  );
};

const FormPost = () => {
  const [name, setName] = useState("");
  const [guests, setGuests] = useState(1);
  const [coming, setComing] = useState(false);
  return (
    <Stack>
      <Text variant="title">RSVP на пікнік</Text>
      <Input value={name} onChange={setName} placeholder="Ваше імʼя" label="Імʼя" />
      <Counter value={guests} onChange={setGuests} min={0} max={5} label="+1" />
      <Check label="Я буду" done={coming} onToggle={() => setComing((c) => !c)} />
      <Button onPress={() => {}}>Надіслати</Button>
    </Stack>
  );
};

const TILES = ["🍕", "🎬", "🍺", "🎲", "🎤", "🥾", "🎨", "🏀"];
const Tiles = () => {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <Stack>
      <Text variant="title">Що робимо?</Text>
      <Fill>
        <Grid cols={4} expandedCols={4}>
          {TILES.map((t) => (
            <Square key={t} style={{ width: "100%", background: picked === t ? "var(--cpd-color-bg-action-primary-rest)" : "var(--cpd-color-bg-subtle-secondary)", borderRadius: 10 }}>
              <div onClick={() => setPicked(t)} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2em" }}>{t}</div>
            </Square>
          ))}
        </Grid>
      </Fill>
      <Meta>{picked ? `Обрано: ${picked}` : "Оберіть плитку"}</Meta>
    </Stack>
  );
};

const Memory = () => {
  const [open, setOpen] = useState<number[]>([]);
  const faces = ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼"];
  const cards = [...faces, ...faces];
  return (
    <Stack>
      <Row between>
        <Text variant="title">Memory</Text>
        <Text variant="caption">Пари: 0 з 8</Text>
      </Row>
      <Board cols={4}>
        {cards.map((f, i) => (
          <div
            key={i}
            onClick={() => setOpen((o) => (o.includes(i) ? o : [...o, i]))}
            style={{ margin: "3%", borderRadius: 8, background: open.includes(i) ? "white" : "var(--cpd-color-bg-action-primary-rest)" }}
          >
            {open.includes(i) ? f : ""}
          </div>
        ))}
      </Board>
    </Stack>
  );
};

// --------------------------------------------------------------- it moves

/**
 * Snake — the loop, the keyboard-less controls, the sound and the buzz.
 *
 * Everything a chat game needs and nothing else: `useFrame` for the tick (it
 * waits for the first touch, because WebKit throttles the frame until then),
 * a canvas sized by `fitCanvas`, `useSound` for the bite, `useHaptic` for the
 * wall. No shared state — this one is played alone, which is exactly why it
 * is the honest test of the loop.
 */
const CELL = 12;
const Snake = () => {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const sound = useSound();
  const haptic = useHaptic();
  const expand = useExpand();
  const game = useRef({
    body: [{ x: 6, y: 6 }],
    dir: { x: 1, y: 0 },
    food: { x: 12, y: 8 },
    since: 0,
    cols: 20,
    rows: 20,
    dead: false,
  });
  const [score, setScore] = useState(0);
  const [fps, setFps] = useState(0);

  const turn = useCallback((x: number, y: number) => {
    const g = game.current;
    if (g.dir.x === -x && g.dir.y === -y) return;
    g.dir = { x, y };
  }, []);

  useFrame(({ dt, fps: measured }) => {
    const ctx = canvas.current ? fitCanvas(canvas.current) : null;
    if (!ctx || !canvas.current) return;
    const g = game.current;
    const box = canvas.current.getBoundingClientRect();
    g.cols = Math.max(8, Math.floor(box.width / CELL));
    g.rows = Math.max(8, Math.floor(box.height / CELL));

    g.since += dt;
    if (!g.dead && g.since > 110) {
      g.since = 0;
      const head = g.body[0]!;
      const next = { x: head.x + g.dir.x, y: head.y + g.dir.y };
      if (next.x < 0 || next.y < 0 || next.x >= g.cols || next.y >= g.rows ||
          g.body.some((c) => c.x === next.x && c.y === next.y)) {
        g.dead = true;
        sound("lose");
        haptic("warning");
      } else {
        g.body.unshift(next);
        if (next.x === g.food.x && next.y === g.food.y) {
          sound("pick");
          haptic("light");
          setScore((s) => s + 1);
          g.food = { x: Math.floor(Math.random() * g.cols), y: Math.floor(Math.random() * g.rows) };
        } else {
          g.body.pop();
        }
      }
    }

    ctx.clearRect(0, 0, box.width, box.height);
    ctx.fillStyle = "rgba(0,0,0,0.06)";
    ctx.fillRect(0, 0, box.width, box.height);
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(g.food.x * CELL + 1, g.food.y * CELL + 1, CELL - 2, CELL - 2);
    g.body.forEach((c, i) => {
      ctx.fillStyle = i === 0 ? "#16a34a" : "#22c55e";
      ctx.fillRect(c.x * CELL + 1, c.y * CELL + 1, CELL - 2, CELL - 2);
    });
    if (measured !== fps) setFps(measured);
  });

  const restart = () => {
    game.current = { body: [{ x: 6, y: 6 }], dir: { x: 1, y: 0 }, food: { x: 12, y: 8 }, since: 0, cols: 20, rows: 20, dead: false };
    setScore(0);
    sound("tap");
  };

  return (
    <Stack>
      <Row between>
        <Text variant="title">🐍 {score}</Text>
        <Text variant="caption">{fps} fps</Text>
      </Row>
      <Fill>
        <canvas ref={canvas} style={{ width: "100%", height: "100%", borderRadius: 10, display: "block" }} />
      </Fill>
      <Grid cols={4}>
        <Button onPress={() => { turn(-1, 0); haptic(); }} variant="secondary">←</Button>
        <Button onPress={() => { turn(0, 1); haptic(); }} variant="secondary">↓</Button>
        <Button onPress={() => { turn(0, -1); haptic(); }} variant="secondary">↑</Button>
        <Button onPress={() => { turn(1, 0); haptic(); }} variant="secondary">→</Button>
      </Grid>
      <Row between>
        <Button onPress={restart}>Заново</Button>
        <Button onPress={() => void expand()} variant="secondary">На весь екран</Button>
      </Row>
    </Stack>
  );
};

/**
 * Paint — a finger, a stroke, and nothing between them.
 *
 * Pointer events straight from the element, and `lineTo` — which is what
 * every generated paint post in the corpus does, and the reason the gesture
 * and stroke libraries left `@spiral/play`: 181 modules, zero imports.
 * Native drag-and-drop does not exist in a sandboxed frame, but
 * `onPointerDown/Move/Up` with `setPointerCapture` does, and it is the whole
 * of what a stroke needs. The loop is not needed here — a stroke only moves
 * when a finger does — which is the point: `useFrame` is for games, not for
 * input.
 */
const INK = ["#1c1917", "#ef4444", "#2563eb", "#16a34a", "#f59e0b"];
const Paint = () => {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef<{ points: number[][]; colour: string }[]>([]);
  const current = useRef<number[][]>([]);
  const [colour, setColour] = useState(INK[0]!);
  const [count, setCount] = useState(0);
  const sound = useSound();
  const haptic = useHaptic();

  const redraw = useCallback(() => {
    const el = canvas.current;
    const ctx = el ? fitCanvas(el) : null;
    if (!ctx || !el) return;
    const box = el.getBoundingClientRect();
    ctx.clearRect(0, 0, box.width, box.height);
    const paint = (points: number[][], stroke: string) => {
      if (points.length === 0) return;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(points[0]![0]!, points[0]![1]!);
      for (const [x, y] of points.slice(1)) ctx.lineTo(x!, y!);
      ctx.stroke();
    };
    for (const stroke of strokes.current) paint(stroke.points, stroke.colour);
    paint(current.current, colour);
  }, [colour]);

  useEffect(redraw, [redraw]);

  const at = (e: { clientX: number; clientY: number }): number[] => {
    const box = canvas.current!.getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top];
  };
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    current.current = [at(e)];
    haptic();
    redraw();
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (current.current.length === 0) return;
    current.current = [...current.current, at(e)];
    redraw();
  };
  const onUp = () => {
    if (current.current.length === 0) return;
    strokes.current = [...strokes.current, { points: current.current, colour }];
    current.current = [];
    setCount(strokes.current.length);
    sound("tap", 0.4);
    redraw();
  };

  return (
    <Stack>
      <Row between>
        <Text variant="title">Малюнок</Text>
        <Text variant="caption">{count} штрихів</Text>
      </Row>
      <Fill>
        <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} style={{ width: "100%", height: "100%", touchAction: "none" }}>
          <canvas ref={canvas} style={{ width: "100%", height: "100%", background: "#fff", borderRadius: 10, display: "block" }} />
        </div>
      </Fill>
      <Row between>
        {INK.map((c) => (
          <div
            key={c}
            onClick={() => { setColour(c); haptic(); }}
            style={{
              width: 40, height: 40, borderRadius: 20, background: c,
              outline: c === colour ? "3px solid var(--cpd-color-text-primary)" : "none",
              outlineOffset: 2,
            }}
          />
        ))}
        <Button onPress={() => { strokes.current = []; setCount(0); redraw(); sound("pop"); }} variant="secondary">Стерти</Button>
      </Row>
    </Stack>
  );
};

// ---------------------------------------------------------------- the lab

const PAGES: { readonly id: string; readonly aspect: string; readonly view: () => ReturnType<typeof Chess> }[] = [
  // Grouped by aspect: mount the lab at 1:1 and page through the first
  // three, then at 3:4 for the next two, then 4:3 for the rest.
  { id: "snake", aspect: "1:1", view: Snake },
  { id: "paint", aspect: "1:1", view: Paint },
  { id: "chess", aspect: "1:1", view: Chess },
  { id: "tictactoe", aspect: "1:1", view: TicTacToe },
  { id: "memory", aspect: "1:1", view: Memory },
  { id: "wheel", aspect: "3:4", view: Wheel },
  { id: "form", aspect: "3:4", view: FormPost },
  { id: "poll", aspect: "4:3", view: Poll },
  { id: "quiz", aspect: "4:3", view: Quiz },
  { id: "leaderboard", aspect: "4:3", view: Leaderboard },
  { id: "greeting", aspect: "4:3", view: Greeting },
  { id: "valentine", aspect: "4:3", view: Valentine },
  { id: "quiet", aspect: "4:3", view: QuietCard },
  { id: "bad", aspect: "4:3", view: BadCard },
  { id: "counter", aspect: "4:3", view: CounterPost },
  { id: "tiles", aspect: "4:3", view: Tiles },
];

export default function App() {
  const [index, setIndex] = useState(0);
  const viewport = useViewport();
  const page = PAGES[index]!;
  const View = page.view;

  useEffect(() => {
    console.log(`lab page ${page.id} (aspect ${page.aspect}) in ${viewport.mode} ${viewport.width}×${viewport.height}`);
    window.dispatchEvent(new Event("spiral-measure"));
  }, [index, viewport.mode]);

  return (
    <div className="s-root" style={{ padding: 10 }} data-lab-page={page.id}>
      <View />
      {/* The pager sits OUTSIDE the box on purpose: a tiny strip at the very
          bottom, so it is never mistaken for part of a pattern. */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex", gap: 2, opacity: 0.35 }}>
        <div onClick={() => setIndex((i) => (i + PAGES.length - 1) % PAGES.length)} style={{ flex: 1, height: 6, background: "#000" }} />
        <div onClick={() => setIndex((i) => (i + 1) % PAGES.length)} style={{ flex: 1, height: 6, background: "#000" }} />
      </div>
    </div>
  );
}
