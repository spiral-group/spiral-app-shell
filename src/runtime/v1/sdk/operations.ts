/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007 § 5.2. The six operations, and the fold that applies one
of them to a state document.

This is a SECOND implementation of
`agent-x-ios/ElementX/Sources/Services/AgentPlatform/SpiralApp/SpiralAppOperation.swift`
and the path helpers in `SpiralAppValue.swift`. Two implementations of one
fold is a cost taken deliberately: the app applies an operation optimistically,
before the host has written anything, so that a tap moves the number in the
same frame. The local result therefore has to be the value the host pushes
back a moment later, or the number changes twice for one tap.

Every rule here is the Swift's rule — including the ones that read like
oversights, because they are the behaviour on the wire either way:
`listRemove` leaves a non-list untouched while `listAppend` replaces one;
`setIfAbsent` counts null as absent; a non-object parent is overwritten rather
than refused. Where the two sides could disagree, the Swift wins: it is what
writes the Matrix event that every other client folds from.
*/

/** Any JSON value. A state document is nothing more than one (`SpiralAppValue`). */
export type SpiralValue =
  | null
  | boolean
  | number
  | string
  | readonly SpiralValue[]
  | SpiralObject;

export type SpiralObject = { readonly [key: string]: SpiralValue };

/**
 * A post's whole shared state.
 *
 * Always an object: `SpiralAppStateFold.fold` seeds an empty one, and every
 * operation is refused unless its path has at least one component, so nothing
 * an app can send replaces the root with a scalar.
 */
export type SpiralState = SpiralObject;

/**
 * Where in the state document an operation writes.
 *
 * A dotted string is the short form and reads well — `"votes.yes"`. It cannot
 * address a key that CONTAINS a dot, and every Matrix user ID does
 * (`@a:spiral.md`), so an array is the form to reach a per-user slot:
 * `["votes", "@a:spiral.md"]`. Written dotted, that same path splits into
 * three components and writes somewhere nobody meant.
 */
export type SpiralPath = string | readonly string[];

/**
 * One operation, in the shape `SpiralAppOperation.init?(json:)` parses: a
 * single-key object whose key names the operation.
 *
 * The names are wire names and the Swift switch matches them literally —
 * `del`, not `delete`; `by`, not `amount`.
 */
export type SpiralOp =
  /** Overwrite whatever is at `path`. */
  | { readonly set: { readonly path: SpiralPath; readonly value: SpiralValue } }
  /** Write only if nothing is there — "first spin wins", without a lock. */
  | { readonly setIfAbsent: { readonly path: SpiralPath; readonly value: SpiralValue } }
  /** Remove `path`. Idempotent. */
  | { readonly del: { readonly path: SpiralPath } }
  /** Add to a number, creating it at zero when absent. */
  | { readonly incr: { readonly path: SpiralPath; readonly by: number } }
  /** Append to a list, creating it when absent. */
  | { readonly listAppend: { readonly path: SpiralPath; readonly item: SpiralValue } }
  /** Remove list members whose `id` matches. */
  | { readonly listRemove: { readonly path: SpiralPath; readonly id: string } }
  /**
   * Several of the above, applied in order as one action. The SDK builds
   * these from a burst of `apply` calls (see `coalesce`); an app never has
   * to. Cannot nest; at most `MAX_BATCH` members — `SpiralAppOperation`
   * refuses more, and refuses a nested one.
   */
  | { readonly batch: { readonly ops: readonly SpiralOp[] } };

/** Most operations one batch may carry. Mirrors `SpiralAppOperation.maxBatchSize`. */
export const MAX_BATCH = 64;

/** The single-key operation names, in the order a multi-key object is read. */
const OPERATION_NAMES = ["set", "setIfAbsent", "del", "incr", "listAppend", "listRemove", "batch"] as const;

/**
 * A Matrix event cannot carry a fraction.
 *
 * Canonical JSON has no floats at all: Synapse answers `M_BAD_JSON: Bad
 * JSON value: float` and the write is lost. But fractions are exactly what
 * a drawing, a physics step or a share of the vote is made of — a stroke
 * stored in the box's own units is `0.42`, so that the same drawing fits a
 * 322-pt row and a 402-pt viewer.
 *
 * Rounding was the first answer and it was wrong in the most visible way:
 * every coordinate between 0 and 1 became 0 or 1, and a drawing came out as
 * four lines along the edges of the canvas (two simulators, 2026-09-19).
 *
 * So a fraction travels as a STRING and comes back a number. The tag is a
 * control character: valid JSON, one byte, and nothing a person can type.
 * The app never sees it — `apply` encodes on the way out and every snapshot
 * is decoded on the way in — and the host, which only stores and folds, does
 * not care that a value is a string.
 */
export const FLOAT_TAG = "\u0001f";

export const encodeFloats = <T>(value: T): T => {
  if (typeof value === "number") {
    if (Number.isInteger(value)) return value;
    if (!Number.isFinite(value)) return 0 as unknown as T;
    return `${FLOAT_TAG}${value}` as unknown as T;
  }
  if (Array.isArray(value)) return value.map(encodeFloats) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = encodeFloats(inner);
    }
    return out as unknown as T;
  }
  return value;
};

export const decodeFloats = <T>(value: T): T => {
  if (typeof value === "string") {
    return value.startsWith(FLOAT_TAG)
      ? (Number(value.slice(FLOAT_TAG.length)) as unknown as T)
      : value;
  }
  if (Array.isArray(value)) return value.map(decodeFloats) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = decodeFloats(inner);
    }
    return out as unknown as T;
  }
  return value;
};

/**
 * Turn `{ set: …, setIfAbsent: … }` into a batch of the two.
 *
 * The wire form carries exactly ONE operation per object, and the host
 * refuses anything else — correctly, because two keys with no order would
 * be ambiguous. But a model writing a post reaches for the compact form
 * constantly (`apply({ set: …, setIfAbsent: … })` to claim a record and its
 * holder), and the refusal arrives as an unhandled rejection inside a frame
 * whose console reaches nobody: the tap simply does nothing. A real shared
 * drawing lost every stroke this way (2026-09-19).
 *
 * Object key order in JavaScript is insertion order for string keys, so
 * "in the order given" is exactly what the author wrote.
 */
export const normaliseOperation = (op: SpiralOp): SpiralOp => {
  if (op === null || typeof op !== "object") return op;
  const keys = Object.keys(op).filter((key) => (OPERATION_NAMES as readonly string[]).includes(key));
  if (keys.length <= 1) return op;
  const ops = keys.map((key) => ({ [key]: (op as Record<string, unknown>)[key] }) as SpiralOp);
  return { batch: { ops } };
};

const isObject = (value: SpiralValue | undefined): value is SpiralObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isArray = (value: SpiralValue | undefined): value is readonly SpiralValue[] =>
  Array.isArray(value);

/**
 * Read a member the way a Swift dictionary lookup does.
 *
 * Plain `members[key]` also finds `constructor`, `toString` and the rest of
 * `Object.prototype`, none of which the Matrix event carried. The app chooses
 * the path, so a lookup of "constructor" has to miss here exactly as it
 * misses in `SpiralAppValue.value(at:)` — otherwise the two folds disagree on
 * a path an app picked on purpose.
 */
const readOwn = (members: SpiralObject, key: string): SpiralValue | undefined =>
  Object.hasOwn(members, key) ? members[key] : undefined;

/**
 * Write a member without letting the key escape into the prototype.
 *
 * `members["__proto__"] = value` re-parents the object instead of adding a
 * member, so a `set` on that path would change nothing the host would echo
 * back. `defineProperty` stores it as an own property, which is what the
 * Swift dictionary does with the same key.
 */
const putOwn = (
  members: Record<string, SpiralValue>,
  key: string,
  value: SpiralValue,
): void => {
  Object.defineProperty(members, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
};

/**
 * `SpiralAppOperation.path(from:)`.
 *
 * An array is taken as written, except that one empty component refuses the
 * whole path — it would address a key no writer can name, and shortening it
 * silently would write somewhere else instead.
 *
 * A dotted string drops empty components, because Swift's
 * `split(separator:)` omits them by default, which makes "a..b" and "a.b"
 * address the same member. An empty result is the decoder's refusal condition
 * (`guard !path.isEmpty` in all six cases), and every caller here treats it
 * as one.
 */
/**
 * The top-level key under which each user has a namespace of their own.
 *
 * `by.<userId>.*` is writable only by `<userId>` and is folded by the host
 * from that user's own actions alone — never from another sender's `state`
 * blob. It is what makes "who voted", "who confirmed", "who scored" honest.
 * An app keys per-person data here and gets that for free; anywhere else is
 * shared, rewritable data, which is sometimes also what it wants.
 *
 * Mirrors `SpiralAppOperation.ownedNamespace`.
 */
export const OWNED_NAMESPACE = "by";

/** The path to `key` inside `userId`'s own namespace. Array form on purpose:
 * a user ID contains dots and a dotted string would split it. */
export const mine = (userId: string, ...key: readonly string[]): readonly string[] => [
  OWNED_NAMESPACE,
  userId,
  ...key,
];

/** Whose namespace `op` writes into, or undefined for shared state. */
export const ownerOf = (op: SpiralOp): string | undefined => {
  const path = pathComponents(pathOf(op));
  return path.length >= 2 && path[0] === OWNED_NAMESPACE ? path[1] : undefined;
};

const pathOf = (op: SpiralOp): SpiralPath => {
  if ("set" in op) return op.set.path;
  if ("setIfAbsent" in op) return op.setIfAbsent.path;
  if ("del" in op) return op.del.path;
  if ("incr" in op) return op.incr.path;
  if ("listAppend" in op) return op.listAppend.path;
  if ("listRemove" in op) return op.listRemove.path;
  return [];
};

const samePath = (a: SpiralPath, b: SpiralPath): boolean => {
  const left = pathComponents(a);
  const right = pathComponents(b);
  return left.length === right.length && left.every((component, i) => component === right[i]);
};

/**
 * A burst of operations as the fewest that mean the same thing.
 *
 * Adjacent `incr` on one path become one `incr` of the sum; a `set` followed
 * by a `set` on the same path keeps the last. Both are exactly what the fold
 * would compute from the sequence, so nothing about the state changes — only
 * how many Matrix events it takes to say it. Everything else is kept in
 * order. Nothing is reordered: a merge across an unrelated operation could
 * change what a `setIfAbsent` between them sees.
 */
export const coalesce = (ops: readonly SpiralOp[]): readonly SpiralOp[] =>
  coalesceGrouped(ops, (op) => op).map((group) => group.op);

/** One coalesced operation and the items that went into it. */
export interface CoalescedGroup<T> {
  readonly op: SpiralOp;
  readonly items: readonly T[];
}

/**
 * `coalesce`, keeping track of which inputs each output came from — so a
 * caller holding a promise per input can settle exactly the right ones.
 */
export const coalesceGrouped = <T>(
  items: readonly T[],
  opOf: (item: T) => SpiralOp,
): readonly CoalescedGroup<T>[] => {
  const out: { op: SpiralOp; items: T[] }[] = [];
  for (const item of items) {
    const op = opOf(item);
    const last = out[out.length - 1];
    if (last !== undefined && "incr" in last.op && "incr" in op && samePath(last.op.incr.path, op.incr.path)) {
      last.op = { incr: { path: last.op.incr.path, by: last.op.incr.by + op.incr.by } };
      last.items.push(item);
      continue;
    }
    if (last !== undefined && "set" in last.op && "set" in op && samePath(last.op.set.path, op.set.path)) {
      last.op = op;
      last.items.push(item);
      continue;
    }
    out.push({ op, items: [item] });
  }
  return out;
};

const pathComponents = (path: SpiralPath): readonly string[] => {
  if (typeof path !== "string") {
    return path.length > 0 && path.every((component) => component.length > 0) ? path : [];
  }
  return path.split(".").filter((component) => component.length > 0);
};

/** `SpiralAppValue.value(at:)`. Only objects are walked; arrays are opaque. */
const valueAt = (value: SpiralValue, path: readonly string[]): SpiralValue | undefined => {
  const head = path[0];
  if (head === undefined) return value;
  if (!isObject(value)) return undefined;
  const child = readOwn(value, head);
  if (child === undefined) return undefined;
  return valueAt(child, path.slice(1));
};

/**
 * `SpiralAppValue.setting(_:to:)`.
 *
 * Intermediate values that are not objects are replaced rather than refused,
 * for the reason the Swift gives: an app that writes `a.b` after setting `a`
 * to a number has contradicted itself, and refusing would leave two clients
 * disagreeing about the state — the one thing the fold exists to prevent.
 */
const settingAt = (
  value: SpiralValue,
  path: readonly string[],
  newValue: SpiralValue,
): SpiralValue => {
  const head = path[0];
  if (head === undefined) return newValue;

  const members: Record<string, SpiralValue> = isObject(value) ? { ...value } : {};
  // Swift's `members[head] ?? .object([:])` fills in only for an ABSENT key.
  // JavaScript's `??` would also swallow a member that is there and null,
  // which is a different value to keep walking from.
  const existing = readOwn(members, head);
  putOwn(
    members,
    head,
    settingAt(existing === undefined ? {} : existing, path.slice(1), newValue),
  );
  return members;
};

/** `SpiralAppValue.removing(_:)`. A path that is not there is not an error. */
const removingAt = (value: SpiralValue, path: readonly string[]): SpiralValue => {
  const head = path[0];
  if (head === undefined) return value;
  if (!isObject(value)) return value;

  const members: Record<string, SpiralValue> = { ...value };
  if (path.length === 1) {
    delete members[head];
  } else {
    const child = readOwn(members, head);
    if (child !== undefined) putOwn(members, head, removingAt(child, path.slice(1)));
  }
  return members;
};

/**
 * The root stays an object through any write, because `setting` builds one at
 * every level it walks and no operation reaches here with an empty path. The
 * assertion records that rather than inventing a branch the fold cannot take.
 */
const asState = (value: SpiralValue): SpiralState => value as SpiralState;

/**
 * `SpiralAppOperation.applied(to:)`.
 *
 * An operation whose path is empty returns the state untouched, because the
 * Swift decoder refuses to build such an operation at all: the host will
 * reject the whole action, so the honest local guess is that nothing changed.
 */
export const applyOperation = (state: SpiralState, op: SpiralOp): SpiralState => {
  if ("set" in op) {
    const path = pathComponents(op.set.path);
    if (path.length === 0) return state;
    return asState(settingAt(state, path, op.set.value));
  }

  if ("setIfAbsent" in op) {
    const path = pathComponents(op.setIfAbsent.path);
    if (path.length === 0) return state;
    // Null counts as absent: an app that clears a slot by writing null should
    // not then be unable to claim it again.
    const existing = valueAt(state, path);
    if (existing !== undefined && existing !== null) return state;
    return asState(settingAt(state, path, op.setIfAbsent.value));
  }

  if ("batch" in op) {
    return op.batch.ops.reduce(applyOperation, state);
  }

  if ("del" in op) {
    const path = pathComponents(op.del.path);
    if (path.length === 0) return state;
    return asState(removingAt(state, path));
  }

  if ("incr" in op) {
    const path = pathComponents(op.incr.path);
    if (path.length === 0) return state;
    const existing = valueAt(state, path);
    const current = typeof existing === "number" ? existing : 0;
    return asState(settingAt(state, path, current + op.incr.by));
  }

  if ("listAppend" in op) {
    const path = pathComponents(op.listAppend.path);
    if (path.length === 0) return state;
    const existing = valueAt(state, path);
    const items = isArray(existing) ? [...existing] : [];
    items.push(op.listAppend.item);
    return asState(settingAt(state, path, items));
  }

  // Named rather than assumed, and this matters more than it looks. The last
  // branch used to reach for `op.listRemove.path` unconditionally, so an
  // operation this runtime does not know threw a TypeError — from inside the
  // optimistic fold, which runs before the write is even attempted. The
  // throw left the operation in the pending queue, every later fold hit it
  // again, and the app stopped updating altogether with nothing on screen to
  // say why. Found by the conformance harness, on a device.
  //
  // An unrecognised operation now changes nothing here. It is still refused —
  // by the shell before the round trip and by the host after it — so the app
  // learns about it from the rejection rather than from a frozen view.
  if (!("listRemove" in op)) return state;

  const path = pathComponents(op.listRemove.path);
  if (path.length === 0) return state;
  const existing = valueAt(state, path);
  // Unlike `listAppend`, a path that is not a list is left alone rather than
  // replaced with an empty one — the Swift guards and returns the state.
  if (!isArray(existing)) return state;
  const id = op.listRemove.id;
  const remaining = existing.filter((item) => {
    if (!isObject(item)) return true;
    const itemId = readOwn(item, "id");
    if (typeof itemId !== "string") return true;
    return itemId !== id;
  });
  return asState(settingAt(state, path, remaining));
};
