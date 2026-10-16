/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007. A host that is not there, so an app can be built in a
plain browser.

Designing an Interactive Post otherwise means a full device cycle per change:
build the shell, rebuild the app, install, navigate, tap. This stands in for
the native side well enough to see layout, states and the shape of the data —
and deliberately NOT well enough to be mistaken for a pass.

What it is honest about: it is in-memory, single-client, and nothing it does
touches Matrix. Two browser tabs do not share state. A summary is accepted and
dropped, because the thing that would render it is the native card. The proof
that a post works is still two phones in one room.
*/

import { checkArguments } from "../../shell/arguments";
import type { SpiralInit, SpiralReply, SpiralRequest } from "../../shell/protocol";
import { V1_CAPABILITIES } from "../../shell/protocol";
import { applyOperation, ownerOf, type SpiralOp, type SpiralState } from "./sdk/operations";

export interface MockRoom {
  readonly userId?: string;
  readonly roomId?: string;
  readonly postId?: string;
  /** Who else is in the room. The viewer is added if absent. */
  readonly members?: readonly { readonly userId: string; readonly displayName?: string }[];
  /** Where the post starts. Useful for laying out a state an app rarely reaches. */
  readonly state?: SpiralState;
  /** What this phone keeps for the post (`state.private.*`, § 5.78). Empty by default. */
  readonly private?: SpiralState;
  /** What `time.read` answers, in ms since the epoch. The real clock by default. */
  readonly now?: () => number;
  /** The viewer's app language, as the handshake carries it. "uk" by default. */
  readonly language?: string;
}

/**
 * Install a fake host on the globals the SDK binds to, and return a teardown.
 *
 * Must run BEFORE the app imports `@spiral/sdk`, because the SDK binds once
 * and keeps what it found — the same order `bootstrap.ts` guarantees on a
 * device.
 */
/**
 * Refuse a request, out loud.
 *
 * On a phone a refused write is written to the log — `write refused
 * (rejected): …` — because the frame's own console reaches nobody. The mock
 * was silent, so a module whose every write was refused looked perfectly
 * healthy in the harness: `drag-dots` wrote `path: ""`, which the shell and
 * the native session both refuse, and it sat in the corpus as clean.
 */
const refuse = (request: SpiralRequest, message: string): SpiralReply => {
  console.error(`[spiral-app] write refused (rejected): ${message}`);
  return { id: request.id, ok: false, code: "rejected", message };
};

let resetActive: (() => void) | undefined;
let privateActive: ((next: SpiralState) => void) | undefined;
let pushActive: ((message: unknown) => void) | undefined;

/** Every write the installed host accepted, in order: what a harness checks a move against. */
let writes: { readonly op: SpiralOp; readonly summary?: unknown }[] = [];
let replaceActive: ((next: SpiralState) => void) | undefined;

export const installMockHost = (room: MockRoom = {}): (() => void) => {
  const userId = room.userId ?? "@you:example.org";
  const postId = room.postId ?? "$mock-post";
  const roomId = room.roomId ?? "!mock:example.org";

  // The viewer keeps the name the room gives them when it gives one: a
  // harness measuring with "You" never saw what a real name does to a row.
  const members = [
    { userId, displayName: room.members?.find((member) => member.userId === userId)?.displayName ?? "You" },
    ...(room.members ?? []).filter((member) => member.userId !== userId),
  ];

  let state: SpiralState = room.state ?? {};
  let seq = 0;
  let kept: SpiralState = room.private ?? {};
  privateActive = (next) => {
    kept = next;
  };

  const channel = new MessageChannel();
  const host = channel.port2;

  const answer = (request: SpiralRequest): SpiralReply => {
    // THE SAME SHAPE CHECK THE SHELL RUNS.
    //
    // The mock replaces the shell as well as the host, so anything the
    // shell would refuse used to sail straight through here — and a corpus
    // app that wrote `path: ""` passed every gate while being, in
    // production, completely dead: the shell refuses an empty path, the
    // native session refuses it again, and every write it made was rejected
    // (corpus, 2026-09-21). Running the real checker closes the class
    // rather than that one rule.
    const badArguments = checkArguments(request.method, request.args);
    if (badArguments !== undefined) {
      return refuse(request, badArguments);
    }

    switch (request.method) {
      case "app.context.read":
        return { id: request.id, ok: true, data: { userId, roomId, postId } };

      case "members.basic.read":
        return {
          id: request.id,
          ok: true,
          data: {
            members: members.map((member) => ({
              userId: member.userId,
              displayName: member.displayName ?? member.userId,
            })),
          },
        };

      case "state.shared.read":
        return { id: request.id, ok: true, data: { state, seq } };

      // This phone's corner of the post: kept, and sent nowhere.
      case "state.private.read":
        return { id: request.id, ok: true, data: { state: kept } };

      case "state.private.write":
        kept = (request.args as { state: SpiralState }).state;
        return { id: request.id, ok: true, data: null };

      case "time.read":
        return { id: request.id, ok: true, data: { now: (room.now ?? Date.now)(), floor: 0 } };

      case "state.shared.write": {
        const op = (request.args as { op?: SpiralOp } | null)?.op;
        if (op === undefined) {
          return { id: request.id, ok: false, code: "rejected", message: "no operation" };
        }
        // `by.<someone else>` is theirs — the host refuses it before it is
        // sent, and so does the mock, so an app finds out in the browser.
        const owner = ownerOf(op);
        if (owner !== undefined && owner !== userId) {
          return {
            id: request.id,
            ok: false,
            code: "rejected",
            message: `by.${owner} belongs to ${owner}`,
          };
        }
        // The native session computes the state and the sequence; doing the
        // same here is what makes the mock's echo look like a real one.
        state = applyOperation(state, op);
        seq += 1;
        const said = (request.args as { summary?: unknown } | null)?.summary;
        writes.push(said === undefined ? { op } : { op, summary: said });
        return { id: request.id, ok: true, data: null };
      }

      case "ui.haptic":
      case "ui.expand":
        // Feel, with nothing to feel it with. The harness answers so an app
        // that taps and buzzes behaves identically here and on a phone.
        return { id: request.id, ok: true, data: null };

      default:
        return {
          id: request.id,
          ok: false,
          code: "rejected",
          message: `${request.method} is not mocked`,
        };
    }
  };

  host.addEventListener("message", (event: MessageEvent) => {
    const request = event.data as SpiralRequest;
    if (typeof request?.id !== "string") return;

    const reply = answer(request);
    host.postMessage(reply);

    // Pushed after the reply, as the host does: the authoritative state
    // arrives as its own message, not folded into the acknowledgement.
    if (request.method === "state.shared.write" && reply.ok) {
      host.postMessage({ kind: "state.changed", state, seq });
    }
  });
  host.start();

  const init: SpiralInit = {
    kind: "spiral-init",
    protocol: 1,
    instanceId: postId,
    capabilities: V1_CAPABILITIES,
    runtimeVersion: "1",
    viewerId: userId,
    language: room.language ?? "uk",
  };

  const globals = globalThis as { __spiralPort?: MessagePort; __spiralInit?: SpiralInit };
  globals.__spiralPort = channel.port1;
  globals.__spiralInit = init;
  channel.port1.start();

  // ONE HOST PER PROCESS, EMPTIED BETWEEN APPS.
  //
  // The SDK binds to `__spiralPort` once, at import, and keeps what it
  // found — the comment above has said so since this file was written. A
  // harness that installed a fresh host for each of 53 modules therefore
  // gave a live channel to the FIRST one and a dead port to the other 52:
  // every write they made went nowhere, and the checks that ran after a tap
  // were checking nothing. Measured before fixing: 3 writes reached the host
  // across 53 modules and some six hundred taps (2026-09-21).
  //
  // So the state can be emptied without rebinding the channel.
  resetActive = () => {
    state = room.state ?? {};
    seq = 0;
    writes = [];
    kept = room.private ?? {};
  };
  writes = [];
  pushActive = (message) => host.postMessage(message);
  replaceActive = (next) => {
    state = next;
    seq += 1;
    host.postMessage({ kind: "state.changed", state, seq });
  };

  return () => {
    resetActive = undefined;
    pushActive = undefined;
    replaceActive = undefined;
    privateActive = undefined;
    host.close();
    channel.port1.close();
    delete globals.__spiralPort;
    delete globals.__spiralInit;
  };
};

/**
 * Empty the installed host's shared state, leaving the channel alone.
 *
 * For a harness that runs many apps against one host: each app must start
 * from nothing, and re-installing would hand it a port the SDK is not
 * listening to.
 */
export const resetMockState = (): void => {
  resetActive?.();
};

/**
 * What the app wrote, and what each write said — its op and its summary. The
 * way a harness asks «did that move tell the other player?» (§ 5.75).
 */
export const mockWrites = (): readonly { readonly op: SpiralOp; readonly summary?: unknown }[] => writes;

/**
 * Set the installed host's shared state and tell the app, as when someone
 * else's action lands — for a harness playing the other side.
 */
export const setMockState = (next: SpiralState): void => {
  replaceActive?.(next);
};

/**
 * What this phone keeps for the post from here on (`state.private.*`,
 * § 5.78) — for a harness that measures a sealed game from the side of a
 * player who has already sealed. Read by the app on its next mount.
 */
export const setMockPrivate = (next: SpiralState): void => {
  privateActive?.(next);
};

/**
 * Say something to the app as the host would, unasked — `members.changed`
 * when the room's people change (§ 5.67), `viewport.changed`. For a harness
 * that wants to see the app follow.
 */
export const pushToMockApp = (message: unknown): void => {
  pushActive?.(message);
};

/**
 * The viewer's language from here on, for a harness that measures one post
 * as each of its readers would see it (§ 5.60). The SDK reads the handshake's
 * language afresh on every call, so a new one takes effect at the next mount.
 */
export const setMockLanguage = (language: string): void => {
  const globals = globalThis as { __spiralInit?: SpiralInit };
  if (globals.__spiralInit === undefined) return;
  globals.__spiralInit = { ...globals.__spiralInit, language };
};
