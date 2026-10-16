import { useEffect, useRef, useState } from "react";
import { Spiral, useSharedState, useViewport, useExpand, useHaptic, summary } from "@spiral/sdk";
import { fitCanvas } from "@spiral/play";
import { Scene, Text, Button, Row, Stack, Square, Grid, Meta, Swatch, Only } from "@spiral/ui";

// Paint, not the kit's accents: a drawing's colours are the drawing's, on a
// sheet of its own (§ 5.76). A stroke keeps the index, so an older picture
// stays a picture.
const PAINT = ["#111827", "#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7"];

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
  uk: {
    title: "Малювалка",
    open: "Відкрий, щоб малювати",
    strokes: (n) => `${n} ${slavic(n, "штрих", "штрихи", "штрихів")}`,
    line: (n) => `На полотні ${n} ${slavic(n, "штрих", "штрихи", "штрихів")}`,
    full: "Полотно заповнене — зітріть його",
    cleared: "Полотно стерто",
    clear: "Стерти",
    sure: "Стерти все?",
  },
  ru: {
    title: "Рисовалка",
    open: "Открой, чтобы рисовать",
    strokes: (n) => `${n} ${slavic(n, "штрих", "штриха", "штрихов")}`,
    line: (n) => `На холсте ${n} ${slavic(n, "штрих", "штриха", "штрихов")}`,
    full: "Холст заполнен — сотрите его",
    cleared: "Холст стёрт",
    clear: "Стереть",
    sure: "Стереть всё?",
  },
  en: {
    title: "Doodle together",
    open: "Open to draw",
    strokes: (n) => `${n} ${n === 1 ? "stroke" : "strokes"}`,
    line: (n) => `${n} ${n === 1 ? "stroke" : "strokes"} on the canvas`,
    full: "The canvas is full — clear it",
    cleared: "Canvas cleared",
    clear: "Clear",
    sure: "Clear it all?",
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
  const view = useViewport();
  const expand = useExpand();
  const haptic = useHaptic();
  const canvas = useRef(null);
  const live = useRef(null);
  const [color, setColor] = useState(0);
  const [error, setError] = useState("");
  const [sure, setSure] = useState(false);
  const strokes = Array.isArray(state.strokes) ? state.strokes : [];

  const drawStroke = (ctx, w, h, s) => {
    const p = s.p || [];
    if (p.length < 2) return;
    ctx.strokeStyle = PAINT[(s.c ?? 0) % PAINT.length];
    ctx.lineWidth = Math.max(3, w / 90);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo((p[0] / 1000) * w, (p[1] / 1000) * h);
    if (p.length === 2) ctx.lineTo((p[0] / 1000) * w + 0.1, (p[1] / 1000) * h);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo((p[i] / 1000) * w, (p[i + 1] / 1000) * h);
    ctx.stroke();
  };

  const redraw = () => {
    const el = canvas.current;
    if (!el) return;
    const ctx = fitCanvas(el);
    if (!ctx) return;
    const { width, height } = el.getBoundingClientRect();
    ctx.clearRect(0, 0, width, height);
    strokes.forEach((s) => drawStroke(ctx, width, height, s));
    if (live.current) drawStroke(ctx, width, height, live.current);
  };

  useEffect(() => {
    redraw();
    const el = canvas.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(el);
    return () => ro.disconnect();
  });

  const point = (e) => {
    const r = canvas.current.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 1000);
    const y = Math.round(((e.clientY - r.top) / r.height) * 1000);
    return [Math.min(1000, Math.max(0, x)), Math.min(1000, Math.max(0, y))];
  };

  // In the chat a touch opens the viewer rather than drawing: a thumb
  // scrolling the conversation left dots in everyone's picture (§ 5.80 —
  // `useViewport()` is an object, and comparing it to "row" never matched).
  const down = (e) => {
    if (view.mode === "row") { expand().catch(() => {}); return; }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    live.current = { c: color, p: point(e) };
    redraw();
  };

  const move = (e) => {
    const s = live.current;
    if (!s) return;
    const [x, y] = point(e);
    const n = s.p.length;
    if (Math.abs(x - s.p[n - 2]) + Math.abs(y - s.p[n - 1]) < 8 || n >= 400) return;
    s.p.push(x, y);
    redraw();
  };

  const up = () => {
    const s = live.current;
    if (!s) return;
    const item = { id: Math.random().toString(36).slice(2, 8), c: s.c, p: s.p };
    const total = strokes.length + 1;
    Promise.resolve(
      apply({ listAppend: { path: "strokes", item } },
        summary({ line: every((w) => w.line(total)) }))
    ).catch((failure) => {
      // Only a full canvas is the canvas's fault; anything else passes.
      if (/too ?large|stateTooLarge/i.test(String(failure))) setError(w.full);
    });
    live.current = null;
    setError("");
    haptic("light");
  };

  // Everyone's drawing goes with one tap — so it takes two.
  useEffect(() => {
    if (!sure) return undefined;
    const t = setTimeout(() => setSure(false), 3000);
    return () => clearTimeout(t);
  }, [sure]);
  const clear = () => {
    if (!sure) { setSure(true); haptic("light"); return; }
    setSure(false);
    live.current = null;
    setError("");
    apply({ set: { path: "strokes", value: [] } }, summary({ line: every((w) => w.cleared) }));
    haptic("medium");
  };

  // A sketchbook (§ 5.76): a white sheet on the notebook page, six paints
  // under it, drawn on full screen and shown in the chat as it is. The sheet
  // is SQUARE wherever it is shown: a stroke is stored in the sheet's own
  // 0…1000 in both directions, and a sheet that was wide in the chat and
  // tall full screen turned every circle into an ellipse (§ 5.80).
  return (
    <Scene theme="paper">
      <Stack>
        <Text variant="title">{w.title}</Text>
        <Square>
          <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 10, background: "#ffffff", boxShadow: "0 1px 3px rgb(15 23 42 / 0.18), 0 6px 14px rgb(15 23 42 / 0.08)", overflow: "hidden" }}>
            <canvas
              ref={canvas}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }}
            />
            <Only in="row">
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 6, textAlign: "center", pointerEvents: "none" }}>
                <Text variant="caption">{w.open}</Text>
              </div>
            </Only>
          </div>
        </Square>
        <Grid cols={6}>
          {PAINT.map((c, i) => (
            <Swatch key={c} color={c} picked={color === i} onPick={() => setColor(i)} />
          ))}
        </Grid>
        <Row between>
          <Meta>{error || w.strokes(strokes.length)}</Meta>
          <Button variant="secondary" onPress={clear} disabled={!strokes.length}>{sure ? w.sure : w.clear}</Button>
        </Row>
      </Stack>
    </Scene>
  );
}
