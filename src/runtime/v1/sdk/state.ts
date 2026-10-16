/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007 § 5.4, § 5.5. `state.shared.read`, `state.shared.write`,
and the optimistic copy that sits between them.

The app sends an OPERATION and nothing else. It does not compute the resulting
state and it does not choose the `seq`: the host holds the authoritative fold,
and an app folding from a base it read a moment ago would write a full-state
snapshot that is wrong — and `SpiralAppStateFold` makes the newest action
carrying a `state` the base every other client starts from, so one stale
snapshot becomes everyone's.

What the app keeps here is therefore a GUESS: the last state the host vouched
for, with this app's own un-echoed operations replayed on top. It exists only
so that a tap moves the number in the same frame. Every authoritative push
replaces it.

Completeness (notebook § 5.11) is deliberately absent. A post whose action set
has a gap shows a loader instead of the app, so an app that is running has
already been vouched for. There is no partial state for it to render, and
handing it a flag to check would invite it to render one.
*/

import {
  applyOperation,
  coalesceGrouped,
  MAX_BATCH,
  decodeFloats,
  encodeFloats,
  normaliseOperation,
  type SpiralOp,
  type SpiralState,
} from "./operations";
import type { SpiralSummary } from "./summary";

// Types only. The shell's validators are the SHELL's boundary — pulling them
// in here would ship a copy of them inside the frame they exist to guard, and
// would suggest the app's own checks count for something. They do not.
import type {
  SpiralMethod,
  SpiralRequest,
  SpiralRuntimeError,
} from "../../../shell/protocol";

export type SpiralStateListener = (state: SpiralState) => void;

/**
 * An operation applied locally and sent, but not yet seen coming back.
 *
 * Wrapped rather than held as a bare `SpiralOp` so that a refused write can
 * find its own entry again: two taps on the same button produce equal
 * operations, and only identity tells them apart.
 */
interface PendingOperation {
  readonly op: SpiralOp;
}

/** An `apply` waiting to be sent, with the promise its caller holds. */
interface OutgoingOperation {
  readonly entry: PendingOperation;
  readonly summary: SpiralSummary | undefined;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

/**
 * How long after a send the SDK holds further operations back, to send them
 * together. Every action is a Matrix event in an E2EE room; a clicker tapped
 * ten times a second was ten events a second, for everyone in the room to
 * decrypt. The FIRST operation after a quiet spell goes at once — a single
 * vote must not wait — and what follows inside the window goes as one
 * `batch` when the window closes. Under continuous tapping that is one event
 * per window, with the taps summed (`coalesce`).
 */
export const COALESCE_MS = 300;

export interface SharedStateOptions {
  /** Zero sends every operation at once. For tests of the wire, not for apps. */
  readonly coalesceMs?: number;
}

interface InFlightRequest {
  readonly resolve: (data: unknown) => void;
  readonly reject: (error: Error) => void;
}

/**
 * What the host vouches for, as both `state.shared.read` and a
 * `state.changed` push deliver it.
 *
 * The read answers with the same pair the push carries rather than a bare
 * document, because the two can race: a read round trip can land after an
 * unsolicited push that already moved the state on, and without the `seq`
 * there is no way to tell that apart from a genuine newer fold.
 */
interface Snapshot {
  readonly state: SpiralState;
  readonly seq: number;
}

const parseSnapshot = (data: unknown, source: string): Snapshot => {
  if (typeof data !== "object" || data === null) {
    throw new Error(`${source}: no state`);
  }
  const candidate = data as Record<string, unknown>;
  const state = candidate["state"];
  const seq = candidate["seq"];

  // Refused rather than coerced to `{}`: a counter that silently renders zero
  // because the envelope changed shape is the failure § 5.11 is written to
  // prevent, only quieter.
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    throw new Error(`${source}: state is not an object`);
  }
  if (typeof seq !== "number") {
    throw new Error(`${source}: no seq`);
  }

  // What the host stores is what the wire allowed; the app asked for
  // numbers and gets numbers back.
  return { state: decodeFloats(state) as SpiralState, seq };
};

/**
 * Whether this call is inside a user gesture.
 *
 * No v1 method requires it, but `SpiralRequest` carries it from the start so
 * that adding one later needs no protocol bump (protocol.ts). Read through a
 * cast because `userActivation` is not present everywhere the SDK loads: the
 * test runner has a `navigator` without it, and so will the browser mock
 * (step 5.4).
 */
const inUserGesture = (): boolean => {
  const activation = (
    globalThis as { navigator?: { userActivation?: { isActive?: boolean } } }
  ).navigator?.userActivation;
  return activation?.isActive === true;
};

export class SharedState {
  /** The last state the host vouched for. */
  private base: SpiralState = {};
  /**
   * `seq` of `base`. Starts below any the host can send, so the first read
   * always wins. Used ONLY to drop a stale read reply: § 5.2 defines `seq` as
   * the *sender's* view of the sequence, so two clients can legitimately
   * claim the same one and it cannot order two authoritative folds.
   */
  private baseSeq = -1;
  /** `base` with `pending` replayed — what subscribers see. */
  private view: SpiralState = {};
  private pending: PendingOperation[] = [];
  /** Set by the first state the host vouches for — a read or a push. */
  private loaded = false;

  private readonly listeners = new Set<SpiralStateListener>();
  /** Who wants to hear the roster change (`useRoomMembers`). */
  private readonly memberListeners = new Set<(members: unknown) => void>();
  private readonly inFlight = new Map<string, InFlightRequest>();
  private nextId = 0;
  private primed = false;

  private outbox: OutgoingOperation[] = [];
  private quietUntil = 0;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly coalesceMs: number;

  constructor(
    private readonly port: MessagePort,
    private readonly capabilities: readonly SpiralMethod[],
    options: SharedStateOptions = {},
  ) {
    this.coalesceMs = options.coalesceMs ?? COALESCE_MS;
    // `addEventListener` rather than `onmessage`: the bootstrap already
    // called `port.start()` and left the port on a global that anything in
    // the realm can reach — the probe posts on it directly — and `onmessage`
    // is one slot, so taking it would silently displace another listener or
    // be displaced by one.
    this.port.addEventListener("message", this.onMessage);
  }

  /** Current guess. Stable between changes, as `useSyncExternalStore` requires. */
  snapshot(): SpiralState {
    return this.view;
  }

  /** Fresh read, then the guess built on it. */
  async get(): Promise<SpiralState> {
    await this.read();
    return this.view;
  }

  /**
   * Apply locally, then send. The local half is the whole point: the host's
   * round trip is a Matrix event away, and a button that waits for it feels
   * broken.
   */
  apply(rawOp: SpiralOp, summary?: SpiralSummary): Promise<void> {
    // Forgiving at the edge: several operations in one object become a
    // batch, so the app's optimistic fold, the shell's check and the host
    // all see the one shape they know (see `normaliseOperation`).
    // Several operations in one object become a batch. The FOLD keeps the
    // author's own numbers — fractions and all — so the tap shows what was
    // meant; only what goes on the wire is encoded, in `flush`.
    const op = normaliseOperation(rawOp);
    const entry: PendingOperation = { op };

    // Folded BEFORE it joins the queue. An operation that cannot be folded
    // must not be left in `pending`, because every later fold would hit it
    // again and the app would stop updating for good — which is exactly what
    // happened when an unknown operation threw here.
    this.pending.push(entry);
    try {
      this.refold();
    } catch (error) {
      this.pending.pop();
      this.refold();
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    return new Promise<void>((resolve, reject) => {
      this.outbox.push({ entry, summary, resolve, reject });
      this.scheduleFlush();
    });
  }

  /** Send now if the line is quiet, otherwise when the window closes. */
  private scheduleFlush(): void {
    if (this.flushTimer !== undefined) return;
    const wait = Math.max(0, this.quietUntil - Date.now());
    if (wait === 0) {
      this.flush();
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, wait);
  }

  /**
   * Send everything waiting as one action — or as few as the batch bound
   * allows. Each chunk carries the last summary among its members: what the
   * post says after a burst is what it says after the last tap.
   */
  private flush(): void {
    const waiting = this.outbox;
    this.outbox = [];
    if (waiting.length === 0) return;
    this.quietUntil = Date.now() + this.coalesceMs;

    const grouped = coalesceGrouped(waiting, (item) => item.entry.op);

    // A BATCH MAY NOT CONTAIN A BATCH, and one written by an app already is
    // one: `normaliseOperation` turns `apply({set…}, {incr…})` into a batch,
    // so wrapping a burst of those in another batch produced a nested one,
    // which the shell refuses and the native session refuses again. Every
    // write in the burst was dropped — nine of the corpus's fifty-three
    // posts did it, and the harness could not see it because it had a live
    // host for only the first module (2026-09-21).
    //
    // A batch IS a sequence, so splicing its operations in is exactly what
    // it meant. Flattened before the bound is applied, so the bound still
    // counts operations rather than groups.
    const groups = grouped.flatMap((group) => {
      const op = group.op;
      if (!(typeof op === "object" && op !== null && "batch" in op)) return [group];
      const inner = op.batch.ops;
      // The items ride the LAST one: they are read only for the summary, and
      // the summary of a burst is the summary of its last tap.
      return inner.map((sub, index) => ({
        op: sub,
        items: index === inner.length - 1 ? group.items : [],
      }));
    });

    for (let start = 0; start < groups.length; start += MAX_BATCH) {
      const chunk = groups.slice(start, start + MAX_BATCH);
      const ops = chunk.map((group) => group.op);
      const op: SpiralOp = ops.length === 1 ? ops[0]! : { batch: { ops } };
      const members = chunk.flatMap((group) => group.items);
      const summary = [...members].reverse().find((item) => item.summary !== undefined)?.summary;

      // The operation and, optionally, what the post should SAY about it.
      // Not the resulting state and not a `seq`: those are the host's to
      // compute, for the reason at the top of this file.
      // Encoded HERE, at the edge: a Matrix event cannot carry a fraction
      // (see `encodeFloats`), and everything above this line — the optimistic
      // fold, the app's own state — keeps real numbers.
      const wire = encodeFloats(op);
      this.request("state.shared.write", summary ? { op: wire, summary } : { op: wire }).then(
        () => {
          for (const item of members) item.resolve();
        },
        (error: unknown) => {
          // Refused: the host will never write this action, so the guesses
          // have to come back out. Only these entries — other operations may
          // still be in flight and are still good guesses.
          for (const item of members) {
            const index = this.pending.indexOf(item.entry);
            if (index !== -1) this.pending.splice(index, 1);
          }
          this.refold();
          const failure = error instanceof Error ? error : new Error(String(error));
          for (const item of members) item.reject(failure);
        },
      );
    }
  }

  subscribe(listener: SpiralStateListener): () => void {
    this.listeners.add(listener);
    // § 5.4 reads `state.shared.read` as "current fold + subscription to new
    // actions", so the first subscriber is what triggers the read. It also
    // closes the window the handshake leaves open: the bootstrap starts the
    // port before an artifact exists, so a push could have arrived before
    // this object did, and the read supersedes anything missed.
    this.prime();
    return () => {
      this.listeners.delete(listener);
    };
  }

  private prime(): void {
    if (this.primed) return;
    this.primed = true;
    void this.read().catch((error: unknown) => {
      this.report(`could not read the post's state: ${String(error)}`);
    });
  }

  private async read(): Promise<void> {
    const snapshot = parseSnapshot(
      await this.request("state.shared.read", null),
      "state.shared.read",
    );
    // A read that raced a push comes back holding the older fold. Adopting it
    // would walk the state backwards for as long as it takes the next action
    // to arrive.
    if (snapshot.seq < this.baseSeq) return;
    this.adopt(snapshot);
  }

  /**
   * Take the host's word for the state, and drop the guesses it may already
   * hold.
   *
   * The tempting refinement is to keep replaying operations the host has not
   * acknowledged yet, on the grounds that it cannot have folded in what it
   * has not answered for. That reasoning holds only if the host always writes
   * the event before it replies, which is a property of a native handler that
   * is not written yet — and if it is ever false, the replay double-counts an
   * `incr` that the pushed state already contains. A number that disagrees
   * with the room is a worse failure than a value that flickers back for one
   * round trip, so for what was SENT the authoritative state wins outright.
   *
   * What was never sent is another matter: it is still in the outbox, waiting
   * for the coalescing window, and the host cannot have folded what it has
   * not been given. Dropping it too made a tap vanish for up to 300 ms
   * whenever an earlier action came back — a seat claimed, then the move
   * that followed it gone from the board, long enough to let a second move
   * through; a sum being typed, fed back three digits short (§ 5.80). So the
   * unsent guesses are replayed over the new state.
   */
  private adopt(snapshot: Snapshot): void {
    this.base = snapshot.state;
    this.baseSeq = snapshot.seq;
    const unsent = new Set(this.outbox.map((item) => item.entry));
    this.pending = this.pending.filter((entry) => unsent.has(entry));
    this.loaded = true;
    this.refold();
  }

  /**
   * Whether the host has vouched for a state yet. Until it has, the app is
   * looking at `{}` — not a post nobody has touched, but one whose state is
   * still on its way (`useChanged`).
   */
  isLoaded(): boolean {
    return this.loaded;
  }

  private refold(): void {
    this.view = this.pending.reduce(
      (state, entry) => applyOperation(state, entry.op),
      this.base,
    );
    for (const listener of this.listeners) listener(this.view);
  }

  /**
   * One call to the host, for a method that is not about state.
   *
   * Exposed so `context` and `members` do not each need their own port, id
   * sequence and in-flight map — there is one channel out of this frame and
   * everything must share it.
   */
  call(method: SpiralMethod, args: unknown = null): Promise<unknown> {
    return this.request(method, args);
  }

  private request(method: SpiralMethod, args: unknown): Promise<unknown> {
    // § 5.4: the handshake returns the actually granted set and "the SDK
    // disables the rest locally". Refusing here keeps an ungranted call off
    // the port entirely, so it never spends the app's in-flight budget
    // (LIMITS.maxInFlight) on an answer that is already known.
    if (!this.capabilities.includes(method)) {
      return Promise.reject(new Error(`${method} was not granted to this app`));
    }

    const id = `sdk-${this.nextId++}`;
    const reply = new Promise<unknown>((resolve, reject) => {
      this.inFlight.set(id, { resolve, reject });
    });

    const request: SpiralRequest = {
      id,
      method,
      args,
      userActivation: inUserGesture(),
    };
    this.port.postMessage(request);

    // No timer here: the shell answers every request within
    // `LIMITS.requestTimeoutMs` or replies `unavailable` itself (runtime.ts),
    // and a second timeout would only race the first to a worse message.
    return reply;
  }

  private readonly onMessage = (event: MessageEvent): void => {
    const data: unknown = event.data;
    if (typeof data !== "object" || data === null) return;
    const message = data as Record<string, unknown>;

    if (typeof message["kind"] === "string") {
      this.onPush(message);
      return;
    }
    if (typeof message["id"] === "string") {
      this.onReply(message["id"], message);
    }
  };

  /** Be told when the host says the room's people changed. */
  onMembersChanged(listener: (members: unknown) => void): () => void {
    this.memberListeners.add(listener);
    return () => {
      this.memberListeners.delete(listener);
    };
  }

  private onPush(message: Record<string, unknown>): void {
    if (message["kind"] === "members.changed") {
      for (const listener of this.memberListeners) listener(message["data"]);
      return;
    }

    if (message["kind"] === "state.changed") {
      try {
        this.adopt(parseSnapshot(message, "state.changed"));
      } catch (error) {
        this.report(String(error));
      }
      return;
    }

    if (message["kind"] === "teardown") {
      // The port is about to close, so nothing in flight will ever be
      // answered. Rejecting is what rolls back the optimistic writes.
      const reason = message["reason"];
      const error = new Error(
        `the app was torn down: ${typeof reason === "string" ? reason : "no reason given"}`,
      );
      for (const request of this.inFlight.values()) request.reject(error);
      this.inFlight.clear();
      // And whatever had not left yet: the window it was waiting for will
      // never close on a port that is going away.
      if (this.flushTimer !== undefined) clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
      const waiting = this.outbox;
      this.outbox = [];
      for (const item of waiting) {
        const index = this.pending.indexOf(item.entry);
        if (index !== -1) this.pending.splice(index, 1);
      }
      if (waiting.length > 0) this.refold();
      for (const item of waiting) item.reject(error);
    }
  }

  private onReply(id: string, message: Record<string, unknown>): void {
    const request = this.inFlight.get(id);
    if (request === undefined) return;
    this.inFlight.delete(id);

    if (message["ok"] === true) {
      request.resolve(message["data"] ?? null);
      return;
    }

    // The code is folded into the message rather than exposed as a typed
    // error, because the v1 surface is three calls (brief 0066 step 5.1) and
    // an app that can branch on `conflict` would be expected to retry — which
    // is the host's job, not its own.
    const code = message["code"];
    const detail = message["message"];
    request.reject(
      new Error(
        `${typeof code === "string" ? code : "unavailable"}: ` +
          `${typeof detail === "string" ? detail : "the host refused the request"}`,
      ),
    );
  }

  /**
   * Say something the native log can actually see.
   *
   * The frame is opaque to the shell — no console relay reaches in, no DOM
   * read gets out — so `SpiralRuntimeError` is the only channel (protocol.ts).
   * A counter stuck at zero because its first read failed is exactly the
   * blank frame that channel exists to explain.
   */
  private report(message: string): void {
    console.error("[spiral-sdk]", message);
    const error: SpiralRuntimeError = {
      kind: "runtime-error",
      message: `[spiral-sdk] ${message}`,
      stage: "unknown",
    };
    this.port.postMessage(error);
  }
}

export const createSharedState = (
  port: MessagePort,
  capabilities: readonly SpiralMethod[],
  options: SharedStateOptions = {},
): SharedState => new SharedState(port, capabilities, options);
