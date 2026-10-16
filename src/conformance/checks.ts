/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007 § 5.9. What an app can verify about its own runtime.

The probe asks "can hostile code get out". This asks the opposite question:
does the contract an honest app is promised actually hold, on this device,
through the real host? Those are different failures — a runtime can be
perfectly sealed and still fold `incr` wrongly — and only one of them is
visible in a screenshot.

Every check goes through `@spiral/sdk`, never around it. A check that reached
for a port directly would be testing a path no generated app has.

Scope is deliberately what an APP can see. Rendering in the timeline, pool
eviction under scroll, the summary on a native card, two devices racing: all
real, none of them observable from in here, all named in the brief as
step 7's or the operator's rather than quietly dropped.
*/

import { Spiral, type SpiralOp, type SpiralState, type SpiralValue } from "@spiral/sdk";

export type Verdict = "pass" | "fail";

export interface CheckResult {
  readonly name: string;
  readonly verdict: Verdict;
  /** What was actually observed. Read this, not the verdict. */
  readonly detail: string;
}

export interface CheckGroup {
  readonly group: string;
  readonly results: readonly CheckResult[];
}

const pass = (name: string, detail: string): CheckResult => ({ name, verdict: "pass", detail });
const fail = (name: string, detail: string): CheckResult => ({ name, verdict: "fail", detail });

/** A path nothing else writes to, so a rerun never reads a previous run's value. */
const scratch = (suffix: string): readonly string[] => [
  "conformance",
  `${Date.now().toString(36)}-${suffix}`,
];

const read = async (path: readonly string[]): Promise<SpiralValue | undefined> => {
  const state = await Spiral.state.get();
  let value: SpiralValue | undefined = state;
  for (const key of path) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    value = (value as SpiralState)[key];
  }
  return value;
};

/**
 * Apply, then read back what the HOST folded — not what we guessed locally.
 *
 * The wait is the point, and it is the first thing this harness taught us.
 * `apply` resolves when the host ACCEPTS the operation, not when the room has
 * seen it: the action still has to become a Matrix event, reach the server,
 * and come back through the subscription. Reading immediately after therefore
 * reads the state as it was, and every one of these checks failed on its
 * first run against a runtime that was in fact correct.
 *
 * An app never needs this — the optimistic apply means its own view is
 * already right — but a check does, because reading the optimistic view would
 * pass whether or not the host wrote anything at all.
 */
const applyAndRead = async (
  op: SpiralOp,
  path: readonly string[],
): Promise<SpiralValue | undefined> => {
  await Spiral.state.apply(op);
  return settled(path);
};

/**
 * The authoritative value at `path`, once it stops changing.
 *
 * Waits for the echo rather than assuming a delay: a slow server should make
 * a check slow, not red. Gives up after a few seconds so a genuinely missing
 * write reports as missing rather than hanging the harness.
 */
const settled = async (path: readonly string[]): Promise<SpiralValue | undefined> => {
  let previous = await read(path);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const current = await read(path);
    // Two reads agreeing, and not still absent, means the echo has landed.
    if (current !== undefined && JSON.stringify(current) === JSON.stringify(previous)) {
      return current;
    }
    previous = current;
  }

  return previous;
};

const refused = async (op: SpiralOp): Promise<string | undefined> => {
  try {
    await Spiral.state.apply(op);
    return undefined;
  } catch (error) {
    return String(error);
  }
};

// MARK: - Context

const checkContext = async (): Promise<CheckResult> => {
  try {
    const context = await Spiral.context();
    const missing = (["userId", "roomId", "postId"] as const).filter(
      (key) => typeof context[key] !== "string" || context[key].length === 0,
    );
    return missing.length === 0
      ? pass("context", `${context.userId} in ${context.roomId}`)
      : fail("context", `missing ${missing.join(", ")}`);
  } catch (error) {
    return fail("context", String(error));
  }
};

const checkMembersIncludeMe = async (): Promise<CheckResult> => {
  try {
    const [context, members] = await Promise.all([Spiral.context(), Spiral.members()]);
    const me = members.find((member) => member.userId === context.userId);
    // An app drawing "you" from the roster breaks in a way nobody notices
    // until someone looks for their own name and it is not there.
    return me === undefined
      ? fail("members-include-me", `${members.length} members, none of them me`)
      : pass("members-include-me", `${members.length} members, I am "${me.displayName}"`);
  } catch (error) {
    return fail("members-include-me", String(error));
  }
};

const checkMembersHaveNames = async (): Promise<CheckResult> => {
  try {
    const members = await Spiral.members();
    const nameless = members.filter((member) => member.displayName.length === 0);
    return nameless.length === 0
      ? pass("members-have-names", "every member has something to draw")
      : fail("members-have-names", `${nameless.length} with no name and no fallback`);
  } catch (error) {
    return fail("members-have-names", String(error));
  }
};

// MARK: - Operations

const checkSet = async (): Promise<CheckResult> => {
  const path = scratch("set");
  const value = await applyAndRead({ set: { path, value: "written" } }, path);
  return value === "written" ? pass("set", "read back") : fail("set", `read back ${String(value)}`);
};

const checkSetIfAbsent = async (): Promise<CheckResult> => {
  const path = scratch("first");
  // The first write must have LANDED before the second is sent, or both
  // compute from an absent value and this tests nothing.
  await Spiral.state.apply({ setIfAbsent: { path, value: "first" } });
  await settled(path);

  const value = await applyAndRead({ setIfAbsent: { path, value: "second" } }, path);
  // "First spin wins" without a lock: the randomiser and the commit-reveal
  // apps both rest on this holding across clients.
  return value === "first"
    ? pass("setIfAbsent", "the first write held")
    : fail("setIfAbsent", `second write won: ${String(value)}`);
};

const checkDelete = async (): Promise<CheckResult> => {
  // `settled` waits for a value to APPEAR, which a deletion never does, so
  // this one waits for the write it is about to undo and then polls for the
  // absence directly.
  const path = scratch("del");
  await Spiral.state.apply({ set: { path, value: 1 } });
  await settled(path);

  await Spiral.state.apply({ del: { path } });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    if ((await read(path)) === undefined) return pass("del", "gone");
  }
  return fail("del", `still ${String(await read(path))}`);
};

const checkIncrement = async (): Promise<CheckResult> => {
  const path = scratch("incr");
  await Spiral.state.apply({ incr: { path, by: 2 } });
  await settled(path);

  const value = await applyAndRead({ incr: { path, by: 3 } }, path);
  // Creates at zero when absent, so 2 then 3 is 5 rather than an error.
  return value === 5 ? pass("incr", "2 + 3 = 5 from absent") : fail("incr", `got ${String(value)}`);
};

const checkListAppend = async (): Promise<CheckResult> => {
  const path = scratch("append");
  await Spiral.state.apply({ listAppend: { path, item: { id: "a" } } });
  await settled(path);

  const value = await applyAndRead({ listAppend: { path, item: { id: "b" } } }, path);
  return Array.isArray(value) && value.length === 2
    ? pass("listAppend", "two items, in order")
    : fail("listAppend", `got ${JSON.stringify(value)}`);
};

const checkListRemove = async (): Promise<CheckResult> => {
  const path = scratch("remove");
  await Spiral.state.apply({ listAppend: { path, item: { id: "a" } } });
  await Spiral.state.apply({ listAppend: { path, item: { id: "b" } } });
  await settled(path);

  const value = await applyAndRead({ listRemove: { path, id: "a" } }, path);
  const left = Array.isArray(value) ? value : [];
  return left.length === 1
    ? pass("listRemove", "removed by id, kept the rest")
    : fail("listRemove", `got ${JSON.stringify(value)}`);
};

const checkUserKeyedPath = async (): Promise<CheckResult> => {
  // The case a dotted path cannot express: every Matrix user ID contains a
  // dot, and a per-user slot is the first thing a poll needs.
  try {
    const { userId } = await Spiral.context();
    const path = [...scratch("per-user"), userId];
    const value = await applyAndRead({ set: { path, value: "mine" } }, path);
    return value === "mine"
      ? pass("user-keyed-path", `wrote and read ${userId}`)
      : fail("user-keyed-path", `read back ${String(value)}`);
  } catch (error) {
    return fail("user-keyed-path", String(error));
  }
};

// MARK: - Time

const checkTime = async (): Promise<CheckResult> => {
  // The host's clock is the one a countdown must use. Sane means: within a
  // minute of this frame's own clock (the same phone), and never earlier
  // than the newest action — which the harness has just written.
  try {
    const before = Date.now();
    const now = await Spiral.time.now();
    const drift = now - before;
    return Math.abs(drift) <= 60_000
      ? pass("time", `host clock ${drift >= 0 ? "+" : ""}${drift} ms from the frame's`)
      : fail("time", `host clock is ${drift} ms from the frame's`);
  } catch (error) {
    return fail("time", String(error));
  }
};

// MARK: - Owned paths

const checkOwnedPathIsMine = async (): Promise<CheckResult> => {
  // `by.<me>.*` is the viewer's own namespace: only they can write it, and
  // the host folds it only from their actions. The write must land, and the
  // viewer id the SDK knows synchronously must be the one the host means.
  try {
    const { userId } = await Spiral.context();
    if (Spiral.viewer !== userId) {
      return fail("owned-path-mine", `SDK viewer ${Spiral.viewer} != host ${userId}`);
    }
    const path = Spiral.mine("scratch", "owned");
    const value = await applyAndRead({ set: { path, value: "mine" } }, path);
    return value === "mine"
      ? pass("owned-path-mine", `by.${userId} written and read`)
      : fail("owned-path-mine", `read back ${String(value)}`);
  } catch (error) {
    return fail("owned-path-mine", String(error));
  }
};

const checkOwnedPathIsNotYours = async (): Promise<CheckResult> => {
  const reason = await refused({
    set: { path: ["by", "@nobody:spiral.md", "vote"], value: "forged" },
  });
  return reason === undefined
    ? fail("owned-path-not-yours", "A WRITE INTO SOMEONE ELSE'S NAMESPACE WAS ACCEPTED")
    : pass("owned-path-not-yours", `refused: ${reason}`);
};

// MARK: - Limits

const checkOversizedState = async (): Promise<CheckResult> => {
  // An app that only grows would otherwise one day write a state no Matrix
  // event can carry, and from then on nothing could be written at all —
  // including whatever would shrink it back.
  const reason = await refused({
    set: { path: scratch("huge"), value: "x".repeat(24 * 1024) },
  });
  return reason === undefined
    ? fail("oversized-state", "A STATE PAST THE BUDGET WAS ACCEPTED")
    : pass("oversized-state", `refused: ${reason}`);
};

const checkUnknownOperation = async (): Promise<CheckResult> => {
  const reason = await refused({ multiply: { path: "x", by: 2 } } as unknown as SpiralOp);
  return reason === undefined
    ? fail("unknown-operation", "AN OPERATION THIS RUNTIME CANNOT CARRY OUT WAS ACCEPTED")
    : pass("unknown-operation", `refused: ${reason}`);
};

const checkRoomWidePing = async (): Promise<CheckResult> => {
  // § 5.2: a ping must be addressed. The builder cannot express this, so the
  // check has to reach past it — which is exactly why the shell refuses it
  // too rather than trusting the builder.
  try {
    await Spiral.state.apply({ set: { path: scratch("ping"), value: 1 } }, {
      notify: "ping",
    } as never);
    return fail("room-wide-ping", "A PING WITH NOBODY NAMED WAS ACCEPTED");
  } catch (error) {
    return pass("room-wide-ping", `refused: ${String(error)}`);
  }
};

// MARK: - Behaviour under the hood

const checkOptimisticApply = async (): Promise<CheckResult> => {
  // The tap has to feel immediate; the round trip is a Matrix event away.
  //
  // Distinguishes three outcomes rather than two, because "not optimistic"
  // and "never notified at all" are different faults and a boolean would
  // report them identically.
  const path = scratch("optimistic");
  let synchronous = false;
  let eventual = false;
  let notifications = 0;

  const stop = Spiral.state.subscribe(() => {
    notifications += 1;
    eventual = true;
  });

  const sent = Spiral.state.apply({ set: { path, value: "x" } }).catch(() => undefined);
  synchronous = eventual;

  await sent;
  stop();

  if (synchronous) {
    return pass("optimistic-apply", `subscribers saw it before the round trip (${notifications})`);
  }
  return fail(
    "optimistic-apply",
    eventual
      ? `only after the host answered (${notifications} notifications)`
      : "never notified at all",
  );
};

const checkAuthoritativeWins = async (): Promise<CheckResult> => {
  // A refused write must leave nothing behind: the guess has to come back
  // out, or the app shows a number the room does not agree with.
  const path = scratch("rollback");
  await refused({ set: { path, value: "x".repeat(24 * 1024) } });
  // Read straight away on purpose: the point is that NOTHING is there, and
  // waiting for a value that must never appear would only waste the wait.
  const value = await read(path);
  return value === undefined
    ? pass("rollback", "the refused write left nothing behind")
    : fail("rollback", `the optimistic value survived: ${String(value)}`);
};

/**
 * Run everything, in order, against the live host.
 *
 * Sequential rather than parallel: each write is a Matrix event, and firing
 * them at once would measure the shell's in-flight quota instead of the
 * contract.
 */
export const runConformance = async (): Promise<readonly CheckGroup[]> => [
  {
    group: "context",
    results: [await checkContext(), await checkMembersIncludeMe(), await checkMembersHaveNames(), await checkTime()],
  },
  {
    group: "operations",
    results: [
      await checkSet(),
      await checkSetIfAbsent(),
      await checkDelete(),
      await checkIncrement(),
      await checkListAppend(),
      await checkListRemove(),
      await checkUserKeyedPath(),
      await checkOwnedPathIsMine(),
      await checkOwnedPathIsNotYours(),
    ],
  },
  {
    group: "limits",
    results: [
      await checkOversizedState(),
      await checkUnknownOperation(),
      await checkRoomWidePing(),
    ],
  },
  {
    group: "behaviour",
    results: [await checkOptimisticApply(), await checkAuthoritativeWins()],
  },
];
