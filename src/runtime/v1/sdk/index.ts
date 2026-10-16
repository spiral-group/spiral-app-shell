/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007 § 5.4. `@spiral/sdk` — the whole v1 surface.

Four capabilities, and nothing else exists. There is no route from here to
the room's messages, to the network, or to another post: an app can read who
is looking, who else is in the room, and the post's own state, and it can
change that state. That is the entire vocabulary, and it is what makes
rendering a post without asking anyone's permission defensible (§ 4.8).

An artifact reaches this file by importing `@spiral/sdk`, which
`transpile.ts` rewrites to `/runtime/v1/sdk.js`. It ships in the client
release next to React, never inside an artifact (ADR-0007 § 4.1).
*/

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { handshakeLanguage, HostFacts, parseMembers, type SpiralContext, type SpiralMember } from "./context";
import { createSharedState, type SharedState } from "./state";
import { PrivateStore } from "./private";
import { mine, type SpiralOp, type SpiralState, type SpiralValue } from "./operations";
import type { SpiralSummary } from "./summary";
import { requestExpandWith, useFrame, useHaptic as useHapticWith, useSound } from "./play";
import type { SpiralHapticStrength } from "./play";
import type { SpiralInit } from "../../../shell/protocol";

export type { SpiralOp, SpiralObject, SpiralPath, SpiralState, SpiralValue } from "./operations";
export type { SpiralContext, SpiralMember } from "./context";
export type { SpiralAddressees, SpiralNotify, SpiralPingKind, SpiralSummary, SpiralSummaryInput } from "./summary";
export { summary } from "./summary";
export { useLeaderboard, useSeats } from "./games";
export type { SpiralLeaderboard, SpiralScore, SpiralSeats } from "./games";
export { useSealed } from "./sealed";
export type { SpiralSealed, SpiralSealedOptions } from "./sealed";
export { useFrame, useSound } from "./play";
export type { FrameInfo, FrameOptions, SpiralSoundName, SpiralHapticStrength } from "./play";
export { OWNED_NAMESPACE } from "./operations";

/**
 * Bind to the port the shell handed over during the handshake.
 *
 * Lazy, not module-level, for two reasons. The handshake globals are set by
 * `bootstrap.ts` before it blob-imports the artifact, so they are always
 * there by the time an app calls something — but this module is also loaded
 * by the test runner, where they never will be, and a top-level throw would
 * make that a build failure rather than a clear message.
 *
 * There is exactly one port and this is it. The frame has no `window.webkit`
 * and no network (`connect-src 'none'`), so a second channel to the host is
 * not merely discouraged, it does not exist (ADR-0007 § 4.2, § 5.6).
 */
let bound: SharedState | undefined;
let facts: HostFacts | undefined;
let viewer: string | undefined;

const shared = (): SharedState => {
  if (bound !== undefined) return bound;

  const handshake = globalThis as {
    __spiralPort?: MessagePort;
    __spiralInit?: SpiralInit;
  };
  const port = handshake.__spiralPort;
  const init = handshake.__spiralInit;
  if (port === undefined || init === undefined) {
    throw new Error("@spiral/sdk was loaded outside a Spiral app frame");
  }

  bound = createSharedState(port, init.capabilities);
  viewer = init.viewerId;
  return bound;
};

/** The viewer's user ID, known from the handshake. */
const viewerId = (): string => {
  shared();
  return viewer ?? "";
};

const hostFacts = (): HostFacts => (facts ??= new HostFacts(shared()));

let kept: PrivateStore | undefined;
/**
 * This phone's own corner of the post (§ 5.78), for `useSealed`. Not an app
 * API — the generator's export list does not name it — because what a post
 * keeps here is invisible to everyone else in the room, and the one thing it
 * is FOR is a move that must stay hidden until it is opened.
 */
export const privateStore = (): PrivateStore =>
  (kept ??= new PrivateStore((method, args) => shared().call(method, args ?? null)));

export const Spiral = {
  state: {
    /** The post's current shared state, read through the host. */
    get: (): Promise<SpiralState> => shared().get(),

    /**
     * Send one operation.
     *
     * Resolves when the host has accepted it, NOT when everyone else has seen
     * it — the Matrix event still has to land. Rejects when the host refuses,
     * having first put the optimistic change back; an app that ignores the
     * rejection will show a number the room does not agree with.
     */
    apply: (op: SpiralOp, said?: SpiralSummary): Promise<void> => shared().apply(op, said),

    /** Fires on every change, optimistic or authoritative. */
    subscribe: (listener: (state: SpiralState) => void): (() => void) =>
      shared().subscribe(listener),
  },

  /**
   * `Spiral.state.apply`, one level up.
   *
   * The name a model reaches for first: 1 of 20 generated posts called
   * `Spiral.apply(...)` and its tap did nothing (harness, 2026-09-17).
   * Cheaper to answer to the obvious name than to teach every model not
   * to use it.
   */
  apply: (op: SpiralOp, said?: SpiralSummary): Promise<void> => shared().apply(op, said),

  /** Who is looking at this post, and where. Fixed for a mounted app. */
  context: (): Promise<SpiralContext> => hostFacts().readContext(),

  /**
   * Whether the phone asked for less motion.
   *
   * DECORATION should honour it — a looping float, a shimmer, a card that
   * keeps breathing. Gameplay should not: someone who turned it on still
   * wants their snake to move.
   */
  get reducedMotion(): boolean {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  },

  /** Ask the host for the whole screen — a row-sized board becomes a game. */
  expand: (): Promise<void> => requestExpandWith(shared)(),

  /**
   * The clock, as the host sees it.
   *
   * Never `Date.now()` in a post. Two phones disagree about the time, and
   * a countdown or a deadline that reads its own clock shows them two
   * different answers. The host's clock is at least never earlier than the
   * room's newest event, so a phone running behind cannot reopen something
   * that has closed. `now()` asks once; `useNow` keeps a local clock in step
   * with it.
   */
  time: {
    now: (): Promise<number> => hostFacts().readTime(),
  },

  /** The viewer's user ID. Synchronous: it came with the handshake. */
  get viewer(): string {
    return viewerId();
  },

  /**
   * The language the viewer's app is shown in — "uk", "ru", "en". Also
   * synchronous, from the handshake: a template's own words can follow it
   * from the first frame (§ 5.60).
   */
  get language(): string {
    return handshakeLanguage();
  },

  /**
   * The path to `key` in the viewer's OWN namespace, `by.<viewer>.<key>`.
   *
   * Only the viewer can write there, and the host folds it only from the
   * viewer's own actions — so a vote, a confirmation, a score kept here is
   * genuinely theirs. Read anyone's with `state.by?.[userId]`.
   */
  mine: (...key: readonly string[]): readonly string[] => mine(viewerId(), ...key),

  /**
   * Display names and avatars of the room's members.
   *
   * Not cached, because someone can join or leave while a post is on screen
   * and "3 of 5" against a stale roster is wrong in a way nobody would think
   * to check.
   */
  members: (): Promise<readonly SpiralMember[]> => hostFacts().readMembers(),
} as const;

// Module-scope so the identities stay stable across renders;
// `useSyncExternalStore` re-subscribes whenever `subscribe` changes.
const subscribeToState = (onChange: () => void): (() => void) =>
  shared().subscribe(onChange);
const readState = (): SpiralState => shared().snapshot();

/**
 * The shared state, and the way to change it.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the store is
 * written to from outside React — by an authoritative push that can land
 * mid-render — and this is the hook that exists to read such a store without
 * tearing.
 */
export const useSharedState = (): readonly [
  SpiralState,
  (op: SpiralOp, said?: SpiralSummary) => Promise<void>,
] => [useSyncExternalStore(subscribeToState, readState), Spiral.state.apply];

const readLoaded = (): boolean => shared().isLoaded();

/**
 * Something that HAPPENED while the post is on screen — a move, a press, a
 * spin, a feed landing now, from this viewer or anyone — as opposed to the
 * state a post opens with.
 *
 * `onChange(value, before)` runs when `value` (a number or a string: a count,
 * a timestamp, a winner) changes after the post's state has arrived; never
 * for the arrival itself. A post renders first with `{}` and gets its state a
 * moment later, so a post that animated every change animated on every
 * opening: a cat that jumped at a press made days ago, a finished game that
 * played its fanfare to everyone scrolling past. Timing the arrival out
 * (§ 5.76, the wheel's 900 ms) fails on a slow first read; the SDK KNOWS
 * when the host first vouched for a state.
 *
 *   useChanged(state.presses ?? 0, (n, before) => { if (n > before) play(n); });
 */
export const useChanged = <T extends string | number | boolean | null | undefined,>(
  value: T,
  onChange: (value: T, before: T) => void,
): void => {
  const loaded = useSyncExternalStore(subscribeToState, readLoaded);
  const before = useRef<{ readonly value: T } | undefined>(undefined);
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (!loaded) return;
    const previous = before.current;
    before.current = { value };
    if (previous !== undefined && !Object.is(previous.value, value)) latest.current(value, previous.value);
  }, [loaded, value]);
};

/**
 * The viewer's own slice of the state, `state.by[viewer]`, and a way to write
 * into it by key. What a poll, an RSVP or a quiz keeps per person.
 */
export const useOwnState = (): readonly [
  Readonly<Record<string, SpiralValue>>,
  (key: string, value: SpiralValue, said?: SpiralSummary) => Promise<void>,
] => {
  const [state, apply] = useSharedState();
  const by = state[OWNED_NAMESPACE_KEY];
  const own =
    typeof by === "object" && by !== null && !Array.isArray(by)
      ? (by as Readonly<Record<string, SpiralValue>>)[Spiral.viewer]
      : undefined;
  const ownObject =
    typeof own === "object" && own !== null && !Array.isArray(own)
      ? (own as Readonly<Record<string, SpiralValue>>)
      : {};
  return [ownObject, (key, value, said) => apply({ set: { path: Spiral.mine(key), value } }, said)];
};

const OWNED_NAMESPACE_KEY = "by";

/** Where the app is shown, and how big that is right now. */
export interface SpiralViewport {
  /** `row`: a chat bubble, small and fixed, never scrolls. `expanded`: the full-screen viewer. */
  readonly mode: "row" | "expanded";
  readonly width: number;
  readonly height: number;
}

const readViewport = (): SpiralViewport => ({
  mode: document.documentElement.dataset["spiralViewport"] === "expanded" ? "expanded" : "row",
  width: window.innerWidth,
  height: window.innerHeight,
});

/**
 * The box the app is in. Most apps never need it — the kit's layout classes
 * size themselves from the container — but a board that wants more rows
 * when expanded, or a list that shows "+3 more" only in a row, reads it here.
 */
export const useViewport = (): SpiralViewport => {
  const [viewport, setViewport] = useState<SpiralViewport>(readViewport);
  useEffect(() => {
    const update = () => setViewport(readViewport());
    window.addEventListener("resize", update);
    window.addEventListener("spiral-viewport", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("spiral-viewport", update);
    };
  }, []);
  return viewport;
};

/**
 * The tap answered in the hand. `const haptic = useHaptic(); haptic("light")`.
 */
export const useHaptic = (): ((strength?: SpiralHapticStrength) => void) => useHapticWith(shared);

/**
 * Ask the host for the whole screen. `const expand = useExpand(); expand()`.
 */
export const useExpand = (): (() => Promise<void>) => {
  const request = requestExpandWith(shared);
  return useCallback(() => request(), [request]);
};

/**
 * The host's clock, ticking. `undefined` until the host has answered once,
 * because a countdown drawn from the frame's own clock for the first frame
 * and the host's after is a countdown that jumps.
 *
 * One round trip, then local time plus the offset it revealed: a tick every
 * `everyMs` costs the port nothing.
 */
export const useNow = (everyMs = 1000): number | undefined => {
  const [offset, setOffset] = useState<number>();
  const [now, setNow] = useState<number>();

  useEffect(() => {
    let live = true;
    void Spiral.time.now()
      .then((hostNow) => {
        if (!live) return;
        const delta = hostNow - Date.now();
        setOffset(delta);
        setNow(hostNow);
      })
      .catch(() => {
        // The SDK has already reported it; a post that cannot read the time
        // renders without it rather than with a wrong one.
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (offset === undefined) return undefined;
    const tick = setInterval(() => setNow(Date.now() + offset), everyMs);
    return () => clearInterval(tick);
  }, [offset, everyMs]);

  return now;
};

/**
 * The room's members, once they arrive, in the same order on every phone
 * (by user ID — see `parseMembers`).
 *
 * `undefined` until the read answers, rather than an empty array: an app
 * showing "0 of 0 voted" for a moment is worse than one showing nothing, and
 * the two are indistinguishable if loading and empty share a value.
 */
export const useRoomMembers = (): readonly SpiralMember[] | undefined => {
  const [members, setMembers] = useState<readonly SpiralMember[]>();

  useEffect(() => {
    let live = true;
    void Spiral.members()
      .then((value) => {
        if (live) setMembers(value);
      })
      .catch(() => {
        // The SDK has already reported it to the host; an app that cannot
        // read the roster should render without it rather than break.
        if (live) setMembers([]);
      });
    // And afterwards, whenever the room's people change (§ 5.67): someone
    // who joins while the post is open is a player at once.
    const stop = shared().onMembersChanged((value) => {
      try {
        if (live) setMembers(parseMembers(value));
      } catch {
        // A push the SDK cannot read changes nothing.
      }
    });
    return () => {
      live = false;
      stop();
    };
  }, []);

  return members;
};

/**
 * Who is looking at this post.
 *
 * ALWAYS AN OBJECT. It used to be `SpiralContext | undefined` — undefined
 * until the host answered — and the first thing anyone writes is
 * `const { userId } = useSpiralContext()`, which throws on the first render,
 * on a phone as surely as in a harness (corpus, 2026-09-21). The type said
 * so and the trap was sprung anyway, which is the definition of a shape that
 * should not exist.
 *
 * `userId` is real from the first frame: the handshake carries the viewer,
 * so there is nothing to wait for. The room and the post arrive with the
 * read a moment later and are empty strings until then — an app that shows
 * them renders one frame without, which is what it would have done anyway.
 */
export const useSpiralContext = (): SpiralContext => {
  const [context, setContext] = useState<SpiralContext>(() => ({
    userId: Spiral.viewer,
    roomId: "",
    postId: "",
    language: Spiral.language,
  }));

  useEffect(() => {
    let live = true;
    void Spiral.context()
      .then((value) => {
        if (live) setContext(value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return context;
};
