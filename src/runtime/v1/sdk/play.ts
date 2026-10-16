/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 step 6.12 — what makes a post MOVE and ANSWER.

A post is a program, and for a year of this brief it has been a program that
could only redraw when someone tapped it. The prompt said "never animate with
requestAnimationFrame" — a rule written after the wheel stuttered, and wrong
in the way that matters: WebKit throttles rAF in a cross-origin iframe **only
until the first tap inside it**, and then runs at the display's rate. Every
game a person would actually play — snake, pong, a paint stroke, a dragged
card — begins with that tap. So the loop was never the problem; asking for it
before anyone had touched the frame was.

Four things live here, and all four exist to make a post feel like part of
the phone rather than a web page embedded in a chat:

  useFrame   the game loop, honest about when it may run
  useSound   a voice, from an oscillator — no files, no network, no CSP
  useHaptic  the tap answered in the hand (through the host)
  requestExpand  a game asking for the whole screen (through the host)
*/

import { useCallback, useEffect, useRef, useState } from "react";
import type { SharedState } from "./state";

/**
 * What the loop actually got, for the ruler to report.
 *
 * Written through `globalThis`, not imported: see the note on `FRAME_STATS_KEY`
 * in `measure.ts` — a file shared between the SDK and the bootstrap becomes a
 * chunk the scheme handler does not publish, and the runtime stops booting.
 */
interface FrameStats {
  fps: number;
  worstMs: number;
  frames: number;
}

const stats = (): FrameStats => {
  const host = globalThis as unknown as Record<string, FrameStats | undefined>;
  return (host["__spiralFrameStats"] ??= { fps: 0, worstMs: 0, frames: 0 });
};

/** Whether the person has touched this frame yet — the rAF throttle's switch. */
let touched = false;
const touchListeners = new Set<() => void>();

const markTouched = (): void => {
  if (touched) return;
  touched = true;
  for (const listener of touchListeners) listener();
  touchListeners.clear();
};

if (typeof document !== "undefined") {
  // `pointerdown` rather than `click`: the throttle lifts on the touch, and a
  // game that waits for a full click has already lost its first frames.
  document.addEventListener("pointerdown", markTouched, { capture: true, passive: true });
  document.addEventListener("keydown", markTouched, { capture: true, passive: true });
}

export interface FrameInfo {
  /** Milliseconds since the previous frame, clamped to 100 (a tab that slept). */
  readonly dt: number;
  /** Milliseconds since the loop started running. */
  readonly elapsed: number;
  /** Frames per second over the last second, 0 until the first second is up. */
  readonly fps: number;
}

export interface FrameOptions {
  /** Run before the first touch too. Off by default — see the note above. */
  readonly eager?: boolean;
  /** Stop the loop without unmounting: a finished game, a paused board. */
  readonly running?: boolean;
}

/**
 * The game loop.
 *
 * `callback` is called once per displayed frame with the time since the last
 * one. It is NOT React state — write to a ref, a canvas, or a DOM style, and
 * call `setState` only when something a person reads actually changes. Sixty
 * setStates a second is sixty React renders a second, which is the stutter
 * everybody blames on the phone.
 *
 * The loop:
 *   · waits for the first touch (unless `eager`), because WebKit gives a
 *     cross-origin frame 30 fps until then — but paints ONE still frame
 *     (`dt` 0) at once, and again whenever the frame is resized, changes
 *     viewport or comes back into view, so a post that draws only here is
 *     never a blank rectangle in the chat. It was: 16 of 38 canvas posts in
 *     the corpus, and an owner's card that stayed empty on every phone
 *     until someone tapped it (§ 5.58);
 *   · pauses when the document is hidden and when the app is scrolled out of
 *     the timeline, so a post in a chat nobody is reading costs nothing;
 *   · never forces `prefers-reduced-motion` on gameplay — that setting is
 *     about decoration, and a person who asked for less motion still wants
 *     their snake to move. Decorative loops should check `Spiral.reducedMotion`.
 */
export const useFrame = (callback: (frame: FrameInfo) => void, options: FrameOptions = {}): void => {
  const latest = useRef(callback);
  latest.current = callback;
  const { eager = false, running = true } = options;
  const [ready, setReady] = useState(() => eager || touched);

  useEffect(() => {
    if (ready) return;
    const wake = () => setReady(true);
    touchListeners.add(wake);
    return () => {
      touchListeners.delete(wake);
    };
  }, [ready]);

  // While the loop is not running — before the first touch, or paused — a
  // still frame keeps the picture: `dt` 0, so nothing advances, drawn on the
  // next animation frame (after layout, so a canvas has its size) and again
  // when the box changes, since resizing a canvas clears it.
  useEffect(() => {
    if (ready && running) return;

    let handle = 0;
    const still = (): void => {
      if (handle !== 0) return;
      handle = requestAnimationFrame(() => {
        handle = 0;
        latest.current({ dt: 0, elapsed: 0, fps: 0 });
      });
    };
    const onVisibility = (): void => {
      if (!document.hidden) still();
    };

    still();
    window.addEventListener("resize", still);
    window.addEventListener("spiral-viewport", still);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (handle !== 0) cancelAnimationFrame(handle);
      window.removeEventListener("resize", still);
      window.removeEventListener("spiral-viewport", still);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ready, running]);

  useEffect(() => {
    if (!ready || !running) return;

    let handle = 0;
    let previous = performance.now();
    const started = previous;
    let frames = 0;
    let lastSecond = previous;
    let fps = 0;

    const tick = (now: number): void => {
      handle = requestAnimationFrame(tick);
      // A frame after a pause can be seconds long; a game that integrates it
      // teleports. 100 ms is four dropped frames — visible, and survivable.
      const dt = Math.min(now - previous, 100);
      previous = now;
      frames += 1;
      // The ruler reports what the loop actually got; a game that runs at 24
      // fps is a defect no layout rule can see (measure.ts).
      const seen = stats();
      seen.frames += 1;
      if (dt > seen.worstMs) seen.worstMs = dt;
      if (now - lastSecond >= 1000) {
        fps = Math.round((frames * 1000) / (now - lastSecond));
        stats().fps = fps;
        frames = 0;
        lastSecond = now;
      }
      latest.current({ dt, elapsed: now - started, fps });
    };

    const start = (): void => {
      if (handle !== 0) return;
      previous = performance.now();
      lastSecond = previous;
      handle = requestAnimationFrame(tick);
    };
    const stop = (): void => {
      if (handle === 0) return;
      cancelAnimationFrame(handle);
      handle = 0;
    };

    const onVisibility = (): void => {
      if (document.hidden) stop();
      else start();
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ready, running]);
};

// ---------------------------------------------------------------- sound

export type SpiralSoundName = "tap" | "pick" | "win" | "lose" | "pop" | "tick";

interface Tone {
  readonly type: OscillatorType;
  /** Frequencies in order; each is held for `step` seconds. */
  readonly notes: readonly number[];
  readonly step: number;
  readonly gain: number;
}

const TONES: Record<SpiralSoundName, Tone> = {
  tap: { type: "triangle", notes: [660], step: 0.045, gain: 0.16 },
  pick: { type: "triangle", notes: [520, 780], step: 0.055, gain: 0.18 },
  win: { type: "triangle", notes: [523, 659, 784, 1046], step: 0.085, gain: 0.2 },
  lose: { type: "sawtooth", notes: [300, 220, 160], step: 0.1, gain: 0.14 },
  pop: { type: "sine", notes: [880, 440], step: 0.04, gain: 0.18 },
  tick: { type: "square", notes: [1200], step: 0.02, gain: 0.08 },
};

let audio: AudioContext | undefined;
/** Whether anything in this frame plays sound — set by `useSound`. */
let wantsSound = false;

const context = (): AudioContext | undefined => {
  if (typeof window === "undefined") return undefined;
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return undefined;
  audio ??= new Ctor();
  // iOS starts every context suspended and only lets a user gesture resume
  // it; see `unlock` for which gestures count.
  if (audio.state === "suspended") void audio.resume();
  return audio;
};

/**
 * Start the context inside a gesture WebKit trusts with audio.
 *
 * A tap's `pointerdown` — where posts play their first sound, and where
 * `touched` is set — is not one: the HTML spec counts `pointerup`,
 * `touchend`, `click` and a key as activation, and a context resumed outside
 * one stays suspended on iOS. A sound played from `useChanged` is outside
 * any gesture at all. So the first such event of a post that uses sound
 * makes (or resumes) the context, and every sound after it plays.
 */
const unlock = (): void => {
  if (!wantsSound || (audio && audio.state !== "suspended")) return;
  context();
};

if (typeof document !== "undefined") {
  for (const type of ["pointerup", "touchend", "click", "keydown"]) {
    document.addEventListener(type, unlock, { capture: true, passive: true });
  }
}

/**
 * A voice for the post, synthesised — no files, no network, nothing for the
 * CSP to refuse.
 *
 * `play("win")` is the whole API. Sound is OFF until the person touches the
 * post (a post that makes noise on its own in a chat is a post people mute),
 * and it respects the frame's muted state by simply never starting a context
 * before that first gesture.
 */
export const useSound = (): ((name: SpiralSoundName, volume?: number) => void) => {
  wantsSound = true;
  return useCallback((name: SpiralSoundName, volume = 1) => {
    if (!touched) return;
    const ctx = context();
    if (!ctx) return;
    const tone = TONES[name] ?? TONES.tap;
    const start = ctx.currentTime;
    tone.notes.forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tone.type;
      osc.frequency.value = frequency;
      const at = start + index * tone.step;
      const level = Math.max(0, Math.min(1, volume)) * tone.gain;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(level, at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + tone.step * 0.98);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + tone.step);
    });
  }, []);
};

// ---------------------------------------------------------------- host feel

export type SpiralHapticStrength = "light" | "medium" | "heavy" | "success" | "warning";

/**
 * The tap answered in the hand.
 *
 * Nothing a frame can do reaches the Taptic engine, so this is a host call —
 * and it reads nothing back, which is why granting it does not widen what a
 * post can learn (§ 4.8). Silently does nothing where there is no hardware.
 */
export const useHaptic = (shared: () => SharedState): ((strength?: SpiralHapticStrength) => void) =>
  useCallback(
    (strength: SpiralHapticStrength = "light") => {
      void shared()
        .call("ui.haptic", { strength })
        .catch(() => {
          /* A phone without haptics is not an error worth an app's attention. */
        });
    },
    [shared],
  );

/**
 * Ask the host for the whole screen.
 *
 * A board in a chat row is 322 points wide; the same board full screen is a
 * game. The reader can always leave, and the host may refuse (it is the one
 * that knows whether a viewer is already open), so an app treats this as a
 * request, not a transition it can count on.
 */
export const requestExpandWith = (shared: () => SharedState): (() => Promise<void>) => () =>
  shared()
    .call("ui.expand", null)
    .then(() => undefined);
