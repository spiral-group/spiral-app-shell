/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 step 5.1. The optimistic copy, over a real `MessageChannel`.

The store is driven through an actual port rather than a stubbed method,
because the port is where the awkward parts live: replies and unsolicited
pushes arrive on one channel and have to be told apart, and everything is
asynchronous in the same way it is on the device. A stub that resolved a
promise directly would pass while the wire format was wrong.

The host here is a fake, and deliberately a rude one — it answers when the
test says so, not when the store would like it to, so that "before the host
replied" is an observable state rather than a hopeful comment.
*/

import { afterEach, describe, expect, it } from "vitest";

import { createSharedState, type SharedState } from "./state";
import type { SpiralState } from "./operations";
import type { SpiralMethod, SpiralRequest } from "../../../shell/protocol";

const GRANTED: readonly SpiralMethod[] = ["state.shared.read", "state.shared.write"];

/** One turn of the event loop, which is what a port hop costs in Node. */
/**
 * Let queued work run.
 *
 * One macrotask tick is NOT reliably enough: a `MessageChannel` delivery is
 * itself a macrotask, so under load the request can still be in flight when
 * the assertion runs. That produced a flake roughly one run in six — visible
 * only because the suite was run repeatedly rather than once. Draining a few
 * rounds is still a guess; `waitFor` below is the one to use when a test can
 * name what it is waiting for.
 */
const flush = async (): Promise<void> => {
  for (let round = 0; round < 4; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

/** Wait until `ready()` holds, or give up with a message worth reading. */
const waitFor = async (what: string, ready: () => boolean): Promise<void> => {
  for (let round = 0; round < 50; round += 1) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`timed out waiting for ${what}`);
};

/** The native side, as far as the SDK can tell. */
class FakeHost {
  private readonly received: SpiralRequest[] = [];
  readonly runtimeErrors: string[] = [];

  constructor(private readonly port: MessagePort) {
    port.addEventListener("message", (event: MessageEvent) => {
      const message = event.data as Record<string, unknown>;
      // The bootstrap's out-of-band error channel shares this port and has no
      // `id`, so it is picked apart here the way `AppRuntime` does.
      if (message["kind"] === "runtime-error") {
        this.runtimeErrors.push(String(message["message"]));
        return;
      }
      this.received.push(message as unknown as SpiralRequest);
    });
    port.start();
  }

  /** Whether a request for `method` has arrived yet. */
  has(method: SpiralMethod): boolean {
    return this.received.some((request) => request.method === method);
  }

  /** The oldest un-taken request for a method. Fails loudly when there is none. */
  take(method: SpiralMethod): SpiralRequest {
    const index = this.received.findIndex((request) => request.method === method);
    if (index === -1) throw new Error(`the app never called ${method}`);
    const [request] = this.received.splice(index, 1);
    return request as SpiralRequest;
  }

  get outstanding(): number {
    return this.received.length;
  }

  answer(request: SpiralRequest, data: unknown): void {
    this.port.postMessage({ id: request.id, ok: true, data });
  }

  refuse(request: SpiralRequest, code: string, message: string): void {
    this.port.postMessage({ id: request.id, ok: false, code, message });
  }

  push(state: SpiralState, seq: number): void {
    this.port.postMessage({ kind: "state.changed", state, seq });
  }
}

let channel: MessageChannel | undefined;

/** A store wired to a fake host, primed with a state the host vouches for. */
const wire = async (
  state: SpiralState,
  seq: number,
  capabilities: readonly SpiralMethod[] = GRANTED,
  // Coalescing off by default: these tests are about the wire, one operation
  // at a time. The tests of coalescing itself turn it on.
  coalesceMs = 0,
): Promise<{ store: SharedState; host: FakeHost; seen: SpiralState[] }> => {
  channel = new MessageChannel();
  const host = new FakeHost(channel.port2);
  const store = createSharedState(channel.port1, capabilities, { coalesceMs });

  const seen: SpiralState[] = [];
  store.subscribe((next) => seen.push(next));

  await flush();
  host.answer(host.take("state.shared.read"), { state, seq });
  await flush();
  seen.length = 0;

  return { store, host, seen };
};

afterEach(() => {
  // Node keeps the event loop alive for an open port, so the run would never
  // finish without this.
  channel?.port1.close();
  channel?.port2.close();
  channel = undefined;
});

describe("reading", () => {
  it("reads the state through the host on the first subscription", async () => {
    channel = new MessageChannel();
    const host = new FakeHost(channel.port2);
    const store = createSharedState(channel.port1, GRANTED);

    store.subscribe(() => undefined);
    await waitFor("the first read", () => host.has("state.shared.read"));

    const request = host.take("state.shared.read");
    expect(request.args).toBeNull();

    host.answer(request, { state: { count: 3 }, seq: 4 });
    await flush();
    expect(store.snapshot()).toEqual({ count: 3 });
  });

  it("reads once however many subscribers arrive", async () => {
    const { host, store } = await wire({ count: 1 }, 1);
    store.subscribe(() => undefined);
    store.subscribe(() => undefined);
    await flush();
    expect(host.outstanding).toBe(0);
  });

  it("ignores a read that comes back older than what it already holds", async () => {
    const { store, host } = await wire({ count: 5 }, 9);

    const pending = store.get();
    await flush();
    const request = host.take("state.shared.read");

    // The push lands while the read is still in the air — the ordering the
    // `seq` on a read reply exists to resolve.
    host.push({ count: 6 }, 10);
    await flush();
    host.answer(request, { state: { count: 5 }, seq: 9 });
    await flush();

    await expect(pending).resolves.toEqual({ count: 6 });
    expect(store.snapshot()).toEqual({ count: 6 });
  });

  it("reports a malformed reply instead of rendering an empty state", async () => {
    channel = new MessageChannel();
    const host = new FakeHost(channel.port2);
    const store = createSharedState(channel.port1, GRANTED);

    store.subscribe(() => undefined);
    await flush();
    host.answer(host.take("state.shared.read"), { state: { count: 1 } });
    await flush();

    // The frame is opaque to the shell, so the only evidence that a counter
    // is stuck at zero for a protocol reason travels this channel.
    expect(host.runtimeErrors.join(" ")).toContain("seq");
    expect(store.snapshot()).toEqual({});
  });
});

describe("optimistic apply", () => {
  it("notifies subscribers before the host has answered", async () => {
    const { store, seen, host } = await wire({ count: 2 }, 1);

    // No `await` between the call and the assertion: the point is that the UI
    // does not wait for a Matrix event.
    const written = store.apply({ incr: { path: "count", by: 1 } });
    expect(seen).toEqual([{ count: 3 }]);
    expect(store.snapshot()).toEqual({ count: 3 });

    await flush();
    host.answer(host.take("state.shared.write"), null);
    await written;
  });

  it("sends the operation and nothing else", async () => {
    const { store, host } = await wire({ count: 0 }, 1);

    const written = store.apply({ incr: { path: "count", by: 1 } });
    await flush();
    const request = host.take("state.shared.write");

    // The host holds the authoritative fold. An app that also sent a `state`
    // or a `seq` would be offering a snapshot computed from a base it cannot
    // know is current, and `SpiralAppStateFold` makes that snapshot everyone
    // else's base.
    expect(request.args).toEqual({ op: { incr: { path: "count", by: 1 } } });

    host.answer(request, null);
    await written;
  });

  it("stacks two taps before either is answered", async () => {
    const { store, host, seen } = await wire({ count: 0 }, 1);

    const first = store.apply({ incr: { path: "count", by: 1 } });
    const second = store.apply({ incr: { path: "count", by: 1 } });
    expect(seen).toEqual([{ count: 1 }, { count: 2 }]);

    await flush();
    host.answer(host.take("state.shared.write"), null);
    host.answer(host.take("state.shared.write"), null);
    await Promise.all([first, second]);
  });

  it("refuses a method the handshake did not grant, without using the port", async () => {
    const { store, host } = await wire({ count: 0 }, 1, ["state.shared.read"]);

    // § 5.4: the SDK disables locally whatever was not granted. Spending an
    // in-flight slot on a refusal the app already knows about would be the
    // app's own quota (LIMITS.maxInFlight) wasted.
    await expect(store.apply({ incr: { path: "count", by: 1 } })).rejects.toThrow(
      "state.shared.write was not granted",
    );
    await flush();
    expect(host.outstanding).toBe(0);
  });
});

describe("rollback", () => {
  it("puts a refused change back and says so", async () => {
    const { store, host, seen } = await wire({ count: 2 }, 1);

    const written = store.apply({ incr: { path: "count", by: 1 } });
    expect(store.snapshot()).toEqual({ count: 3 });

    await flush();
    host.refuse(host.take("state.shared.write"), "rejected", "state exceeds 16 KiB");
    await expect(written).rejects.toThrow("rejected: state exceeds 16 KiB");

    expect(store.snapshot()).toEqual({ count: 2 });
    expect(seen).toEqual([{ count: 3 }, { count: 2 }]);
  });

  it("rolls back only the operation that was refused", async () => {
    const { store, host } = await wire({ count: 0 }, 1);

    const first = store.apply({ incr: { path: "count", by: 1 } });
    const second = store.apply({ incr: { path: "count", by: 10 } });
    expect(store.snapshot()).toEqual({ count: 11 });

    await flush();
    const firstRequest = host.take("state.shared.write");
    const secondRequest = host.take("state.shared.write");

    host.refuse(firstRequest, "conflict", "lost a race");
    await expect(first).rejects.toThrow("conflict");
    expect(store.snapshot()).toEqual({ count: 10 });

    host.answer(secondRequest, null);
    await second;
  });

  it("rejects everything still in flight when the app is torn down", async () => {
    const { store, host } = await wire({ count: 0 }, 1);

    const written = store.apply({ incr: { path: "count", by: 1 } });
    await flush();
    host.take("state.shared.write");

    // The port is about to close, so nothing would ever answer; without this
    // the promise — and the optimistic change — would hang forever.
    channel?.port2.postMessage({ kind: "teardown", reason: "scrolled out of view" });
    await expect(written).rejects.toThrow("scrolled out of view");
    expect(store.snapshot()).toEqual({ count: 0 });
  });
});

describe("coalescing", () => {
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  it("sends the first operation at once and the burst that follows as one batch", async () => {
    // A single vote must not wait; a clicker must not be ten events a second.
    const { store, host, seen } = await wire({ count: 0 }, 1, GRANTED, 40);

    const first = store.apply({ incr: { path: "count", by: 1 } });
    await flush();
    expect(host.outstanding).toBe(1);
    host.answer(host.take("state.shared.write"), null);
    await first;

    const taps = [1, 2, 3].map(() => store.apply({ incr: { path: "count", by: 1 } }));
    const note = store.apply({ listAppend: { path: "log", item: "x" } }, { line: "tapped", notify: "badge" });
    // Every tap moved the number in the same frame, before anything was sent.
    expect(seen.at(-1)).toEqual({ count: 4, log: ["x"] });
    await flush();
    expect(host.outstanding).toBe(0);

    await sleep(60);
    const request = host.take("state.shared.write");
    expect(request.args).toEqual({
      op: { batch: { ops: [{ incr: { path: "count", by: 3 } }, { listAppend: { path: "log", item: "x" } }] } },
      summary: { line: "tapped", notify: "badge" },
    });
    host.answer(request, null);
    await Promise.all([...taps, note]);
  });

  it("does not wrap a burst that coalesces to one operation in a batch", async () => {
    const { store, host } = await wire({ count: 0 }, 1, GRANTED, 40);
    host.answer(await (async () => {
      const p = store.apply({ incr: { path: "count", by: 1 } });
      await flush();
      const r = host.take("state.shared.write");
      void p;
      return r;
    })(), null);

    const taps = [1, 2].map(() => store.apply({ incr: { path: "count", by: 5 } }));
    await sleep(60);
    const request = host.take("state.shared.write");
    expect(request.args).toEqual({ op: { incr: { path: "count", by: 10 } } });
    host.answer(request, null);
    await Promise.all(taps);
  });

  it("rolls back every member of a refused batch and rejects each caller", async () => {
    const { store, host } = await wire({ count: 0 }, 1, GRANTED, 40);
    const first = store.apply({ incr: { path: "count", by: 1 } });
    await flush();
    host.answer(host.take("state.shared.write"), null);
    await first;

    const a = store.apply({ incr: { path: "count", by: 1 } });
    const b = store.apply({ set: { path: "title", value: "t" } });
    expect(store.snapshot()).toEqual({ count: 2, title: "t" });

    await sleep(60);
    host.refuse(host.take("state.shared.write"), "rejected", "notOwner");
    await expect(a).rejects.toThrow("notOwner");
    await expect(b).rejects.toThrow("notOwner");
    expect(store.snapshot()).toEqual({ count: 1 });
  });

  it("rejects what was still waiting when the app is torn down", async () => {
    const { store, host } = await wire({ count: 0 }, 1, GRANTED, 40);
    const first = store.apply({ incr: { path: "count", by: 1 } });
    await flush();
    host.answer(host.take("state.shared.write"), null);
    await first;

    const waiting = store.apply({ incr: { path: "count", by: 1 } });
    channel?.port2.postMessage({ kind: "teardown", reason: "scrolled out of view" });
    await expect(waiting).rejects.toThrow("scrolled out of view");
    expect(store.snapshot()).toEqual({ count: 1 });
  });
});

describe("authoritative pushes", () => {
  it("overrides the optimistic state", async () => {
    const { store, host, seen } = await wire({ count: 0 }, 1);

    void store.apply({ incr: { path: "count", by: 1 } }).catch(() => undefined);
    expect(store.snapshot()).toEqual({ count: 1 });

    // Another member's action, folded by the host. It wins whatever this app
    // has guessed — including the guess it is still waiting on.
    host.push({ count: 40 }, 2);
    await flush();

    expect(store.snapshot()).toEqual({ count: 40 });
    expect(seen.at(-1)).toEqual({ count: 40 });
  });

  it("keeps what it has not sent yet over a pushed state, and drops what it has", async () => {
    // A seat claimed, then a move inside the coalescing window: the claim
    // leaves at once, the move waits. The claim's echo used to wipe the
    // waiting move off the board for up to 300 ms (§ 5.80).
    const { store, host } = await wire({}, 1, GRANTED, 60);

    void store.apply({ set: { path: "seat", value: "me" } }).catch(() => undefined);
    await flush();
    expect(host.outstanding).toBe(1);
    void store.apply({ listAppend: { path: "moves", item: 4 } }).catch(() => undefined);
    expect(host.outstanding, "the move went out inside the window").toBe(1);

    // The room confirms the seat — and nothing of the move, which it has
    // not been sent.
    host.push({ seat: "me" }, 2);
    await flush();
    expect(store.snapshot()).toEqual({ seat: "me", moves: [4] });

    // Something SENT and then overtaken by the room is the room's to say.
    await new Promise((resolve) => setTimeout(resolve, 80));
    host.push({ seat: "me", other: 1 }, 3);
    await flush();
    expect(store.snapshot()).toEqual({ seat: "me", other: 1 });
  });

  it("keeps folding from the state it was pushed", async () => {
    const { store, host } = await wire({ count: 0 }, 1);

    host.push({ count: 40 }, 2);
    await flush();

    void store.apply({ incr: { path: "count", by: 2 } }).catch(() => undefined);
    expect(store.snapshot()).toEqual({ count: 42 });
  });

  it("reports a push it cannot read rather than folding a guess", async () => {
    const { store, host } = await wire({ count: 7 }, 1);

    host.push("not a state" as unknown as SpiralState, 2);
    await flush();

    expect(host.runtimeErrors.join(" ")).toContain("not an object");
    expect(store.snapshot()).toEqual({ count: 7 });
  });
});

describe("subscribe", () => {
  it("returns an unsubscribe that stops the notifications", async () => {
    const { store, host } = await wire({ count: 0 }, 1);

    const seen: SpiralState[] = [];
    const unsubscribe = store.subscribe((state) => seen.push(state));

    host.push({ count: 1 }, 2);
    await flush();
    expect(seen).toEqual([{ count: 1 }]);

    unsubscribe();
    host.push({ count: 2 }, 3);
    await flush();

    expect(seen).toEqual([{ count: 1 }]);
    expect(store.snapshot()).toEqual({ count: 2 });
  });

  it("leaves the other subscribers alone", async () => {
    const { store, host } = await wire({ count: 0 }, 1);

    const first: SpiralState[] = [];
    const second: SpiralState[] = [];
    const unsubscribe = store.subscribe((state) => first.push(state));
    store.subscribe((state) => second.push(state));

    unsubscribe();
    host.push({ count: 1 }, 2);
    await flush();

    expect(first).toEqual([]);
    expect(second).toEqual([{ count: 1 }]);
  });

  it("hands out a snapshot that only changes when the state does", async () => {
    // `useSyncExternalStore` re-renders on every identity change and warns
    // when the snapshot is a fresh object each call, so this is a contract
    // with React, not an optimisation.
    const { store, host } = await wire({ count: 0 }, 1);

    const before = store.snapshot();
    expect(store.snapshot()).toBe(before);

    host.push({ count: 1 }, 2);
    await flush();
    expect(store.snapshot()).not.toBe(before);
  });

  it("does not nest a batch inside a batch when a burst is coalesced", async () => {
    // `normaliseOperation` turns several operations in one `apply` into a
    // batch, so a burst of those used to be wrapped in a SECOND batch —
    // which the shell refuses ("batch cannot nest") and the native session
    // refuses again, dropping every write in the burst. Nine of the corpus's
    // fifty-three posts write that way (2026-09-21).
    const { store, host } = await wire({}, 0, GRANTED, 5);
    // The FIRST write leaves at once; a burst forms from the ones after it,
    // so three applies are needed for two to be coalesced together.
    store.apply({ set: { path: "a", value: 1 }, incr: { path: "n", by: 1 } });
    store.apply({ set: { path: "b", value: 2 }, incr: { path: "n", by: 1 } });
    store.apply({ set: { path: "c", value: 3 }, incr: { path: "n", by: 1 } });
    await waitFor("the burst to be sent", () => host.outstanding >= 2);
    await flush();

    let batched = 0;
    while (host.has("state.shared.write")) {
      const request = host.take("state.shared.write");
      const op = (request.args as { op: Record<string, unknown> }).op;
      if (!("batch" in op)) continue;
      batched += 1;
      for (const sub of (op as { batch: { ops: unknown[] } }).batch.ops) {
        expect(
          Object.keys(sub as object),
          `a batch inside a batch: ${JSON.stringify(op)}`,
        ).not.toContain("batch");
      }
    }
    // The burst must actually have been batched, or this proves nothing.
    expect(batched, "the burst was never coalesced into a batch").toBeGreaterThan(0);
  });
});

describe("the roster (§ 5.67)", () => {
  it("tells whoever listens when the host says the people changed", async () => {
    const { store } = await wire({}, 0);
    const heard: unknown[] = [];
    const stop = store.onMembersChanged((members) => heard.push(members));

    channel?.port2.postMessage({ kind: "members.changed", data: { members: [{ userId: "@a:h" }] } });
    await flush();
    stop();
    channel?.port2.postMessage({ kind: "members.changed", data: { members: [] } });
    await flush();

    expect(heard).toEqual([{ members: [{ userId: "@a:h" }] }]);
  });
});
