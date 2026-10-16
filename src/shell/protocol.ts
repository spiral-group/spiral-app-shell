/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007 § 5.5. The wire shapes spoken over the MessagePort
(app -> shell) and over the native reply handler (shell -> host).

The envelope is deliberately the one the retired Element Call bridge used
(`attic/element-call/src/spiral/bridge.ts:222`): a request carries a method
and arguments, a reply is either `{ok: true, data}` or `{ok: false, code,
message}` with a small closed set of codes. Reusing it means the iOS side
maps errors the way the team already reads them, and `conflict` already
means what a state collision means here.

NOTHING in this file is a security boundary. The app can forge any message
it likes; every check that matters runs in the shell (`runtime.ts`) and
again natively. This module only describes and validates shapes.
*/

/** Protocol version spoken by this shell build. Bumped on breaking changes. */
export const PROTOCOL_VERSION = 1;

/** Error codes a reply may carry. Same vocabulary as the Element Call bridge. */
export type SpiralErrorCode =
  /** A state write lost a race; the caller should re-read and retry. */
  | "conflict"
  /** The post, instance or grant no longer exists. */
  | "gone"
  /** Well-formed but refused: missing capability, failed validation, quota. */
  | "rejected"
  /** The host could not service the request right now (offline, torn down). */
  | "unavailable";

/**
 * Methods the app may invoke. v1 is exactly the four capabilities, plus one
 * that exists only for the Brief 0066 spike.
 *
 * `spike.report` carries the probe's findings out of the sandboxed frame.
 * It is here — rather than on a side channel — because the frame's opaque
 * origin means the shell genuinely cannot read into it, and inventing a
 * second, unvalidated path for the spike would test something other than
 * the real one. It travels the same parse, capability and quota checks as
 * everything else, and production mounts never grant it, so a released
 * build refuses it like any ungranted method.
 */
export type SpiralMethod =
  | "app.context.read"
  | "members.basic.read"
  | "state.shared.read"
  | "state.shared.write"
  | "state.private.read"
  | "state.private.write"
  | "time.read"
  | "ui.haptic"
  | "ui.expand"
  | "spike.report";

/** Every method the shell will even consider routing. */
export const KNOWN_METHODS: readonly SpiralMethod[] = [
  "app.context.read",
  "members.basic.read",
  "state.shared.read",
  "state.shared.write",
  "state.private.read",
  "state.private.write",
  "time.read",
  "ui.haptic",
  "ui.expand",
  "spike.report",
] as const;

/** What a production post may be granted. `spike.report` is not among them. */
export const V1_CAPABILITIES: readonly SpiralMethod[] = [
  "app.context.read",
  "members.basic.read",
  "state.shared.read",
  "state.shared.write",
  // This phone's own corner of a post (§ 5.78): what the post wrote here,
  // for this account, and nowhere else — the move behind a sealed hash. It
  // reads nothing about the room and sends nothing to it, so it does not
  // widen what a post can learn (§ 4.8).
  "state.private.read",
  "state.private.write",
  "time.read",
  // Feel, not data: a tap that answers in the hand, and a game that can ask
  // for the whole screen. Neither reads anything, so neither widens what a
  // post can learn about the room (§ 4.8).
  "ui.haptic",
  "ui.expand",
] as const;

export interface SpiralRequest {
  /** Correlates the reply. Unique per port. */
  readonly id: string;
  readonly method: SpiralMethod;
  /** Method-specific payload; validated natively, not here. */
  readonly args: unknown;
  /**
   * True when the call happened inside a user gesture. v1 has no method that
   * requires it, but the flag is carried from the start so adding one later
   * (e.g. `chat.message.send`, ADR-0007 § 4.6) does not need a protocol bump.
   */
  readonly userActivation: boolean;
}

export type SpiralReply =
  | { readonly id: string; readonly ok: true; readonly data: unknown }
  | {
      readonly id: string;
      readonly ok: false;
      readonly code: SpiralErrorCode;
      readonly message: string;
    };

/** Shell -> app, unsolicited: state changed, teardown imminent, etc. */
export type SpiralPush =
  | { readonly kind: "state.changed"; readonly state: unknown; readonly seq: number }
  /**
   * The room's people changed while the post is mounted — someone joined or
   * left. `data` is exactly what `members.basic.read` would answer now,
   * `{ members: [...] }`, so one parser reads both (§ 5.67). Without it a
   * newcomer appeared only on the post's next mount (§ 7 #26).
   */
  | { readonly kind: "members.changed"; readonly data: unknown }
  | { readonly kind: "teardown"; readonly reason: string }
  /**
   * Where the app is being shown. `row` is a chat bubble — small, fixed,
   * never scrolls, because a swipe there belongs to the timeline. `expanded`
   * is the full-screen viewer — the app may scroll its own overflow, and
   * the timeline is not underneath. Sent on mount and on every change.
   */
  | { readonly kind: "viewport.changed"; readonly mode: SpiralViewportMode };

export type SpiralViewportMode = "row" | "expanded";

/**
 * App -> shell, out of band: the app could not start or has crashed.
 *
 * Needed because the sandboxed frame is genuinely opaque to the shell — it
 * has no `window.webkit`, so a console relay cannot reach it, and its DOM
 * cannot be read. Without this channel a failed artifact is indistinguishable
 * from a blank one, and the native side has nothing to show an error card
 * from (ADR-0007 § 4.5).
 */
export interface SpiralRuntimeError {
  readonly kind: "runtime-error";
  /** Message safe to log; already stringified by the bootstrap. */
  readonly message: string;
  /**
   * Coarse stage, so the host can tell "bad artifact" from "bad runtime".
   *
   * `live` is everything AFTER the first render: a click handler that threw,
   * a rejected promise, an effect that blew up. Those were invisible until
   * this stage existed — the four start-up stages only cover `main()`, so an
   * app that mounted and then died looked exactly like one running quietly.
   */
  readonly stage: "load" | "compile" | "import" | "render" | "live" | "unknown";
}

/**
 * A line from the frame's console, relayed. The frame is opaque to the host
 * — its console reaches nobody — so the bootstrap forwards `console.*`
 * and the layout report through the port, and the shell writes them to
 * ITS console, which the native host mirrors into the app log.
 */
export interface SpiralRuntimeLog {
  readonly kind: "runtime-log";
  readonly level: "log" | "warn" | "error";
  readonly message: string;
}

export const parseRuntimeLog = (value: unknown): SpiralRuntimeLog | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate["kind"] !== "runtime-log") return undefined;
  if (typeof candidate["message"] !== "string") return undefined;
  const level = candidate["level"];
  return {
    kind: "runtime-log",
    level: level === "warn" || level === "error" ? level : "log",
    message: candidate["message"].slice(0, 4000),
  };
};

/** The frame says the app has drawn something. */
export const RUNTIME_PAINTED = "runtime-painted";

export const isRuntimePainted = (value: unknown): boolean =>
  typeof value === "object" && value !== null &&
  (value as Record<string, unknown>)["kind"] === RUNTIME_PAINTED;

export const parseRuntimeError = (value: unknown): SpiralRuntimeError | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate["kind"] !== "runtime-error") return undefined;
  if (typeof candidate["message"] !== "string") return undefined;

  const stage = candidate["stage"];
  const known =
    stage === "load" ||
    stage === "compile" ||
    stage === "import" ||
    stage === "render" ||
    stage === "live";

  return {
    kind: "runtime-error",
    message: candidate["message"],
    stage: known ? stage : "unknown",
  };
};

/** The first message the shell sends into a fresh iframe. */
export interface SpiralInit {
  readonly kind: "spiral-init";
  readonly protocol: number;
  readonly instanceId: string;
  /** Capabilities actually granted — the SDK disables everything else. */
  readonly capabilities: readonly SpiralMethod[];
  readonly runtimeVersion: string;
  /**
   * The Matrix user ID of whoever is looking at this post. Known at mount
   * and fixed for the mount, so it travels here rather than through a
   * round trip: an app needs it synchronously, in render, to find its own
   * namespace under `by.<viewerId>` (owned paths, notebook § 5.34 #1).
   */
  readonly viewerId: string;
  /**
   * The language the app is shown in, as a primary subtag — "uk", "ru",
   * "en". Here for the same reason as the viewer: a post that speaks its
   * reader's language needs it in the first render (§ 5.60). Optional: a
   * host that does not send it leaves the SDK to `navigator.language`.
   */
  readonly language?: string;
}

/** Limits enforced by the shell before anything reaches the host. */
export const LIMITS = {
  /** Largest request the shell will forward, in bytes of JSON. */
  maxRequestBytes: 64 * 1024,
  /**
   * Largest private state a post may keep on a phone, in bytes of JSON. A
   * sealed move is tens of bytes and a fleet a few hundred; this is room for
   * a game's worth of them, not a place to store a post's data.
   */
  maxPrivateBytes: 8 * 1024,
  /** Concurrent un-answered requests per app. */
  maxInFlight: 32,
  /** How long the shell waits for the host before replying `unavailable`. */
  requestTimeoutMs: 5_000,
} as const;

/**
 * Structural check on a message arriving from the untrusted iframe.
 *
 * Returns the typed request or a reason string. Deliberately total: any
 * shape that is not exactly right is refused rather than coerced, because
 * the sender is hostile by assumption.
 */
export const parseRequest = (value: unknown): SpiralRequest | { error: string } => {
  if (typeof value !== "object" || value === null) {
    return { error: "not an object" };
  }
  const candidate = value as Record<string, unknown>;

  if (typeof candidate["id"] !== "string" || candidate["id"].length === 0) {
    return { error: "missing id" };
  }
  if (typeof candidate["method"] !== "string") {
    return { error: "missing method" };
  }
  if (!KNOWN_METHODS.includes(candidate["method"] as SpiralMethod)) {
    return { error: `unknown method: ${candidate["method"]}` };
  }
  if (typeof candidate["userActivation"] !== "boolean") {
    return { error: "missing userActivation" };
  }

  return {
    id: candidate["id"],
    method: candidate["method"] as SpiralMethod,
    args: candidate["args"] ?? null,
    userActivation: candidate["userActivation"],
  };
};

export const failure = (
  id: string,
  code: SpiralErrorCode,
  message: string,
): SpiralReply => ({ id, ok: false, code, message });

export const success = (id: string, data: unknown): SpiralReply => ({
  id,
  ok: true,
  data,
});
