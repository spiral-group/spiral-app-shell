/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007 § 5.2. What a method's `args` must look like.

The envelope check in `protocol.ts` answers "is this a request at all". This
answers "is this a request this method could possibly service", and it exists
because the alternative is what the code used to say out loud: *validated
natively, not here*. That made the shell a blind pipe into the one call that
writes an event into a room.

The native side does validate — an unknown operation decodes to nil and is
refused. This is not a replacement for that and must never become one. It is
the near check: the frame is hostile by assumption, and the cheapest place to
refuse malformed input is the one that has not yet crossed a process boundary
or a round trip.

Written by hand rather than with a schema library on purpose. The shapes are
four fields deep, the shell ships in every release, and the existing envelope
parser is already this shape — so a dependency would buy consistency with
itself and cost every user the bytes.
*/

import { LIMITS, type SpiralMethod } from "./protocol";

/** Operations the runtime knows. Mirrors Swift's `SpiralAppOperation`. */
const OPERATIONS = ["set", "setIfAbsent", "del", "incr", "listAppend", "listRemove"] as const;

type OperationName = (typeof OPERATIONS)[number];

/** Mirrors Swift's `SpiralAppOperation.maxBatchSize` and the SDK's `MAX_BATCH`. */
const MAX_BATCH = 64;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A path addresses a place in the state document: a dotted string, or an
 * array of components when a key contains a dot — which every Matrix user ID
 * does, and keying state by user is the first thing an app wants.
 *
 * Empty is refused rather than treated as the root: every operation in the
 * Swift decoder rejects it, so allowing it here would only move the failure
 * somewhere more expensive to read. So is an array with an empty component,
 * which would address a key no writer can name.
 */
const isPath = (value: unknown): boolean => {
  if (typeof value === "string") return value.length > 0;
  if (!Array.isArray(value)) return false;
  return value.length > 0 && value.every((part) => typeof part === "string" && part.length > 0);
};

/**
 * Whether `value` is one operation the runtime can carry out.
 *
 * Exactly one key, because the wire form is a single-key object and a second
 * key means the sender and this runtime disagree about what was asked for.
 */
const checkOperation = (value: unknown, nested = false): string | undefined => {
  if (!isObject(value)) return "op must be an object";

  const names = Object.keys(value);
  if (names.length !== 1) return `op must carry exactly one operation, saw ${names.length}`;

  // A burst of taps travels as one `batch`, the SDK's coalescing (§ 5.6.3).
  // This check was written before batches existed and refused every one of
  // them — so a chess move whose second write (turn + history) was batched
  // never reached the room, and the game stuck on white's turn on every
  // phone (2026-09-18). One level deep, as in Swift's decoder.
  if (names[0] === "batch") {
    if (nested) return "batch cannot nest";
    const body = value["batch"];
    if (!isObject(body) || !Array.isArray(body["ops"])) return "batch needs ops";
    const ops = body["ops"] as unknown[];
    if (ops.length === 0) return "batch needs at least one op";
    if (ops.length > MAX_BATCH) return `batch carries ${ops.length} ops, at most ${MAX_BATCH}`;
    for (const op of ops) {
      const problem = checkOperation(op, true);
      if (problem) return `batch: ${problem}`;
    }
    return undefined;
  }

  const name = names[0] as OperationName;
  if (!OPERATIONS.includes(name)) return `unknown operation: ${name}`;

  const body = value[name];
  if (!isObject(body)) return `${name} must carry an object`;
  if (!isPath(body["path"])) return `${name} needs a non-empty path`;

  switch (name) {
    case "set":
    case "setIfAbsent":
      return "value" in body ? undefined : `${name} needs a value`;
    case "del":
      return undefined;
    case "incr":
      // Not merely "a number": NaN and the infinities survive `typeof` and
      // then poison every later fold, on every client, permanently.
      return typeof body["by"] === "number" && Number.isFinite(body["by"])
        ? undefined
        : "incr needs a finite number to add";
    case "listAppend":
      return "item" in body ? undefined : "listAppend needs an item";
    case "listRemove":
      return typeof body["id"] === "string" ? undefined : "listRemove needs an id";
  }
};

/** `none` \u00b7 `badge` \u00b7 `ping`. The app suggests; the client decides. */
const NOTIFY = ["none", "badge", "ping"] as const;

/** Why it pings — what the push says first (§ 5.74). */
const NOTIFY_KIND = ["turn", "challenge", "record", "result", "mention"] as const;

/**
 * Whether `value` is a summary a native card could render.
 *
 * Absent is fine — an app that says nothing simply has nothing to show where
 * its own code is not running.
 *
 * The rule with teeth is the last one: § 5.2 says `ping` must be addressed
 * and never room-wide. A ping with nobody named is the one shape here that
 * would reach real people, so it is refused rather than downgraded.
 */
const checkSummary = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value)) return "summary must be an object";

  // A line, or one per language — `{ uk: "…", ru: "…" }` — so each reader's
  // phone shows its own (§ 5.68). Keys are language subtags; every value a
  // string. The first cut of § 5.68 forgot this check existed: the kit
  // wrote the object, the shell refused every write, and the wheel did not
  // turn (2026-09-26).
  if ("line" in value) {
    const line = value["line"];
    const perLanguage =
      isObject(line) &&
      Object.entries(line).every(([k, v]) => /^[a-z]{2,3}$/.test(k) && typeof v === "string") &&
      Object.keys(line).length > 0;
    if (typeof line !== "string" && !perLanguage) {
      return "summary.line must be a string, or {language: string}";
    }
  }

  if ("countdown_to" in value) {
    const countdown = value["countdown_to"];
    if (typeof countdown !== "string" || Number.isNaN(Date.parse(countdown))) {
      return "summary.countdown_to must be an ISO-8601 date";
    }
  }

  const users = value["notify_users"];
  if (users !== undefined) {
    if (!Array.isArray(users) || users.some((id) => typeof id !== "string" || id.length === 0)) {
      return "summary.notify_users must be a list of user ids";
    }
  }

  const notify = value["notify"];
  if (notify !== undefined) {
    if (typeof notify !== "string" || !NOTIFY.includes(notify as (typeof NOTIFY)[number])) {
      return `summary.notify must be one of ${NOTIFY.join(", ")}`;
    }
    if (notify === "ping" && (!Array.isArray(users) || users.length === 0)) {
      return "summary.notify ping must name who to ping";
    }
  }

  const kind = value["notify_kind"];
  if (kind !== undefined && (typeof kind !== "string" || !NOTIFY_KIND.includes(kind as (typeof NOTIFY_KIND)[number]))) {
    return `summary.notify_kind must be one of ${NOTIFY_KIND.join(", ")}`;
  }

  return undefined;
};

/**
 * Check `args` for `method`.
 *
 * Returns a reason to refuse, or `undefined` when the shape is serviceable.
 * Deliberately says nothing about whether the REQUEST should succeed — that
 * is the host's judgement, and duplicating it here would be two sources of
 * truth for one answer.
 */
export const checkArguments = (method: SpiralMethod, args: unknown): string | undefined => {
  switch (method) {
    case "state.shared.write": {
      if (!isObject(args)) return "state.shared.write needs an object";
      return checkOperation(args["op"]) ?? checkSummary(args["summary"]);
    }

    // The phone's own corner of the post (§ 5.78): replaced whole, an object,
    // and small — it holds a sealed move, not the post's data.
    case "state.private.write": {
      if (!isObject(args) || !isObject(args["state"])) return "state.private.write needs { state: {…} }";
      const bytes = new TextEncoder().encode(JSON.stringify(args["state"])).length;
      if (bytes > LIMITS.maxPrivateBytes) {
        return `private state is ${bytes} bytes; a post may keep ${LIMITS.maxPrivateBytes} on a phone`;
      }
      return undefined;
    }

    // Readers take no arguments, but `null` and an empty object both arrive
    // from honest callers, so neither is worth refusing over.
    case "app.context.read":
    case "members.basic.read":
    case "state.shared.read":
    case "state.private.read":
      return undefined;

    // The spike channel carries whatever the probe found. Shaping it here
    // would mean this file had to change every time an attack was added, and
    // production never grants it anyway.
    case "spike.report":
      return undefined;
  }
};
