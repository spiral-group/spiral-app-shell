/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066. The local fold against the Swift one.

Every case here is read off
`agent-x-ios/ElementX/Sources/Services/AgentPlatform/SpiralApp/SpiralAppOperation.swift`
and its `SpiralAppValue` helpers, because those are what compute the `state`
that goes into the Matrix event. This file is not testing that the fold is
sensible — it is testing that it is the SAME. A divergence shows up on a
device as a number that changes twice for one tap, which is both the hardest
kind of bug to see in a screenshot and the exact thing the optimistic apply
was added to avoid.

The awkward cases are the valuable ones: `listRemove` on a non-list, a path
through an array, `setIfAbsent` over null. Those are where two independent
implementations drift.
*/

import { describe, expect, it, vi } from "vitest";

import { applyOperation, coalesce, decodeFloats, encodeFloats, mine, normaliseOperation, ownerOf, type SpiralOp, type SpiralState } from "./operations";

describe("set", () => {
  it("writes at a top-level path", () => {
    expect(applyOperation({}, { set: { path: "a", value: 1 } })).toEqual({ a: 1 });
  });

  it("creates the objects along the way", () => {
    // `setting` walks with `members[head] ?? .object([:])`, so a missing
    // parent is built rather than treated as a miss.
    expect(applyOperation({}, { set: { path: "a.b.c", value: "x" } })).toEqual({
      a: { b: { c: "x" } },
    });
  });

  it("replaces a parent that is not an object", () => {
    // The Swift comment is explicit: an app that writes `a.b` after setting
    // `a` to a number has contradicted itself, and refusing would leave two
    // clients disagreeing — which is what the fold exists to prevent.
    expect(applyOperation({ a: 5 }, { set: { path: "a.b", value: true } })).toEqual({
      a: { b: true },
    });
  });

  it("walks through a null parent the way it walks through any other scalar", () => {
    // Worth pinning because the obvious JavaScript for this — `members[head]
    // ?? {}` — would swallow the null and stop mirroring Swift's
    // nil-coalescing, which fills in only for an absent key.
    expect(applyOperation({ a: null }, { set: { path: "a.b", value: 1 } })).toEqual({
      a: { b: 1 },
    });
  });

  it("overwrites a whole subtree", () => {
    expect(
      applyOperation({ a: { b: 1, c: 2 } }, { set: { path: "a", value: null } }),
    ).toEqual({ a: null });
  });

  it("does not touch the state it was given", () => {
    // Rollback and re-fold both re-run the whole pending list over the base,
    // so a fold that mutated its input would corrupt the base it folds from.
    const before: SpiralState = { a: { b: 1 } };
    applyOperation(before, { set: { path: "a.b", value: 2 } });
    expect(before).toEqual({ a: { b: 1 } });
  });
});

describe("setIfAbsent", () => {
  it("writes into an empty slot", () => {
    expect(applyOperation({}, { setIfAbsent: { path: "winner", value: "ann" } })).toEqual({
      winner: "ann",
    });
  });

  it("leaves an existing value alone", () => {
    expect(
      applyOperation({ winner: "ann" }, { setIfAbsent: { path: "winner", value: "bob" } }),
    ).toEqual({ winner: "ann" });
  });

  it("counts null as absent", () => {
    // Swift says why: an app that clears a slot by writing null should not
    // then be unable to claim it again.
    expect(
      applyOperation({ winner: null }, { setIfAbsent: { path: "winner", value: "bob" } }),
    ).toEqual({ winner: "bob" });
  });

  it("counts false and zero as present", () => {
    // They are `.bool(false)` and `.number(0)`, not `.null` — the check is on
    // the case, not on truthiness, and JavaScript's instinct is the wrong one.
    expect(applyOperation({ a: false }, { setIfAbsent: { path: "a", value: 1 } })).toEqual({
      a: false,
    });
    expect(applyOperation({ a: 0 }, { setIfAbsent: { path: "a", value: 1 } })).toEqual({
      a: 0,
    });
  });
});

describe("del", () => {
  it("removes the member", () => {
    expect(applyOperation({ a: 1, b: 2 }, { del: { path: "a" } })).toEqual({ b: 2 });
  });

  it("is idempotent on a path that is not there", () => {
    // Two clients can both delete the same item before either sees the other.
    expect(applyOperation({ b: 2 }, { del: { path: "a" } })).toEqual({ b: 2 });
  });

  it("removes a nested member without disturbing its siblings", () => {
    expect(applyOperation({ a: { b: 1, c: 2 } }, { del: { path: "a.b" } })).toEqual({
      a: { c: 2 },
    });
  });

  it("leaves a parent that is not an object alone", () => {
    // `removing` guards on `case .object` and returns `self`; unlike a write,
    // it does not build a path to something it is about to remove.
    expect(applyOperation({ a: 5 }, { del: { path: "a.b" } })).toEqual({ a: 5 });
  });
});

describe("incr", () => {
  it("creates the number at zero when absent", () => {
    expect(applyOperation({}, { incr: { path: "count", by: 1 } })).toEqual({ count: 1 });
  });

  it("adds to an existing number", () => {
    expect(applyOperation({ count: 41 }, { incr: { path: "count", by: 1 } })).toEqual({
      count: 42,
    });
  });

  it("treats a value that is not a number as zero", () => {
    // `if case .number(let value) = state.value(at: path) ?? .null` — anything
    // else falls to the `else` branch and the old value is overwritten.
    expect(applyOperation({ count: "seven" }, { incr: { path: "count", by: 2 } })).toEqual({
      count: 2,
    });
    expect(applyOperation({ count: true }, { incr: { path: "count", by: 2 } })).toEqual({
      count: 2,
    });
  });

  it("subtracts when `by` is negative", () => {
    expect(applyOperation({ count: 3 }, { incr: { path: "count", by: -1 } })).toEqual({
      count: 2,
    });
  });
});

describe("listAppend", () => {
  it("creates the list when absent", () => {
    expect(applyOperation({}, { listAppend: { path: "items", item: "milk" } })).toEqual({
      items: ["milk"],
    });
  });

  it("appends to an existing list", () => {
    expect(
      applyOperation({ items: ["milk"] }, { listAppend: { path: "items", item: "eggs" } }),
    ).toEqual({ items: ["milk", "eggs"] });
  });

  it("replaces a value that is not a list", () => {
    expect(
      applyOperation({ items: 5 }, { listAppend: { path: "items", item: "milk" } }),
    ).toEqual({ items: ["milk"] });
  });
});

describe("listRemove", () => {
  it("removes every member carrying the id, not only the first", () => {
    // The Swift doc comment says "the first list member whose `id` matches";
    // the implementation is `items.filter { … }`, which removes all of them.
    // The code is what writes the event, so the code is the contract.
    const state: SpiralState = {
      items: [{ id: "a" }, { id: "b" }, { id: "a", note: "duplicate" }],
    };
    expect(applyOperation(state, { listRemove: { path: "items", id: "a" } })).toEqual({
      items: [{ id: "b" }],
    });
  });

  it("keeps members that have no string id", () => {
    // `guard case .object(let members), case .string(let itemID)? = members["id"]
    // else { return true }` — anything unmatchable survives.
    const state: SpiralState = { items: ["milk", { id: 7 }, { note: "no id" }, { id: "a" }] };
    expect(applyOperation(state, { listRemove: { path: "items", id: "a" } })).toEqual({
      items: ["milk", { id: 7 }, { note: "no id" }],
    });
  });

  it("leaves a path that is not a list untouched", () => {
    // The one asymmetry with `listAppend`, and the easiest to get wrong:
    // `listRemove` guards and returns the state, so it does NOT replace the
    // value with an empty list.
    expect(applyOperation({ items: 5 }, { listRemove: { path: "items", id: "a" } })).toEqual({
      items: 5,
    });
    expect(applyOperation({}, { listRemove: { path: "items", id: "a" } })).toEqual({});
  });
});

describe("paths", () => {
  it("drops empty components, because Swift's split does", () => {
    // `dotted.split(separator: ".")` omits empty subsequences, so "a..b" and
    // "a.b" address the same member on both sides.
    expect(applyOperation({}, { set: { path: "a..b", value: 1 } })).toEqual({ a: { b: 1 } });
    expect(applyOperation({}, { set: { path: ".a.", value: 1 } })).toEqual({ a: 1 });
  });

  it("changes nothing when the path is empty", () => {
    // `guard !path.isEmpty` in every case of `init?(json:)`: the host refuses
    // to build the operation at all, so the local guess is "nothing happened".
    expect(applyOperation({ a: 1 }, { set: { path: "", value: 2 } })).toEqual({ a: 1 });
    expect(applyOperation({ a: 1 }, { incr: { path: "...", by: 1 } })).toEqual({ a: 1 });
  });

  it("does not walk into a list", () => {
    // `value(at:)` descends objects only, so "items.0" misses — and the write
    // that follows replaces the array with an object, exactly as `setting`
    // does for any other non-object parent.
    expect(applyOperation({ items: [7] }, { incr: { path: "items.0", by: 1 } })).toEqual({
      items: { 0: 1 },
    });
  });

  it("does not read or write through Object.prototype", () => {
    // The app chooses the path. In Swift these are ordinary dictionary keys;
    // in JavaScript a naive `members[key]` would find `constructor` on the
    // prototype, and a naive assignment to `__proto__` would re-parent the
    // object instead of storing a member. Either one is a divergence on a
    // path an app picked deliberately.
    //
    // Asserted without an object literal, because the literal is the same
    // trap: `{ __proto__: … }` sets the prototype rather than a member, so an
    // expectation written that way silently reads `{}`.
    const written = applyOperation({}, { set: { path: "__proto__.owned", value: true } });
    expect(Object.hasOwn(written, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(written)).toBe(Object.prototype);
    expect(written["__proto__"]).toEqual({ owned: true });
    expect(({} as Record<string, unknown>)["owned"]).toBeUndefined();

    expect(applyOperation({}, { incr: { path: "constructor.count", by: 1 } })).toEqual({
      constructor: { count: 1 },
    });
  });
});

describe("paths through a key that contains a dot", () => {
  // Every Matrix user ID does, and a per-user slot is the first thing a poll
  // or a checklist needs. This is the case the design's own example got
  // wrong: "votes.@bohdan:spiral.md" splits into three components.
  const user = "@bohdan:spiral.md";

  it("reaches the slot an array names", () => {
    const state = applyOperation({}, { set: { path: ["votes", user], value: "carpathians" } });
    expect(state).toEqual({ votes: { [user]: "carpathians" } });
  });

  it("does not reach it when the same path is written dotted", () => {
    // Kept as a test rather than a comment: this is why the array form exists,
    // and someone will otherwise "simplify" it back.
    const state = applyOperation({}, { set: { path: `votes.${user}`, value: "carpathians" } });
    expect(state).toEqual({ votes: { "@bohdan:spiral": { md: "carpathians" } } });
  });

  it("refuses an array with an empty component instead of shortening it", () => {
    expect(applyOperation({ a: 1 }, { del: { path: ["a", ""] } })).toEqual({ a: 1 });
    expect(applyOperation({ a: 1 }, { del: { path: [] } })).toEqual({ a: 1 });
  });

  it("counts per user without the keys colliding", () => {
    let state: SpiralState = {};
    state = applyOperation(state, { incr: { path: ["tally", "@a:spiral.md"], by: 1 } });
    state = applyOperation(state, { incr: { path: ["tally", "@b:spiral.md"], by: 2 } });
    expect(state).toEqual({ tally: { "@a:spiral.md": 1, "@b:spiral.md": 2 } });
  });
});

describe("an operation this runtime does not know", () => {
  // The device case: the last branch reached for `op.listRemove.path`
  // unconditionally, so this threw from inside the OPTIMISTIC fold — before
  // any write was attempted — and left the app unable to fold anything ever
  // again.
  const unknown = { multiply: { path: "count", by: 2 } } as unknown as SpiralOp;

  it("changes nothing instead of throwing", () => {
    expect(() => applyOperation({ count: 1 }, unknown)).not.toThrow();
    expect(applyOperation({ count: 1 }, unknown)).toEqual({ count: 1 });
  });

  it("leaves the state usable for the next operation", () => {
    let state: SpiralState = { count: 1 };
    state = applyOperation(state, unknown);
    state = applyOperation(state, { incr: { path: "count", by: 1 } });
    expect(state).toEqual({ count: 2 });
  });
});

describe("owned paths", () => {
  it("builds the path in array form, because a user id contains dots", () => {
    expect(mine("@a:spiral.md", "vote")).toEqual(["by", "@a:spiral.md", "vote"]);
    expect(mine("@a:spiral.md")).toEqual(["by", "@a:spiral.md"]);
  });

  it("names the owner of an operation under `by`, and nobody otherwise", () => {
    expect(ownerOf({ set: { path: ["by", "@a:spiral.md", "vote"], value: 1 } })).toBe("@a:spiral.md");
    expect(ownerOf({ incr: { path: ["by", "@b:spiral.md", "score"], by: 1 } })).toBe("@b:spiral.md");
    expect(ownerOf({ del: { path: "by" } })).toBeUndefined();
    expect(ownerOf({ set: { path: "count", value: 1 } })).toBeUndefined();
    expect(ownerOf({ listAppend: { path: ["votes"], item: 1 } })).toBeUndefined();
  });
});

describe("batch", () => {
  it("applies its members in order", () => {
    const state = applyOperation({}, {
      batch: { ops: [{ set: { path: "a", value: 1 } }, { incr: { path: "a", by: 2 } }] },
    });
    expect(state).toEqual({ a: 3 });
  });
});

describe("coalesce", () => {
  it("sums adjacent increments on one path", () => {
    expect(
      coalesce([
        { incr: { path: "n", by: 1 } },
        { incr: { path: ["n"], by: 2 } },
        { incr: { path: "n", by: 3 } },
      ]),
    ).toEqual([{ incr: { path: "n", by: 6 } }]);
  });

  it("keeps the last of adjacent sets on one path", () => {
    expect(
      coalesce([{ set: { path: "v", value: 1 } }, { set: { path: "v", value: 2 } }]),
    ).toEqual([{ set: { path: "v", value: 2 } }]);
  });

  it("never merges across an unrelated operation, because order is meaning", () => {
    // A setIfAbsent between two sets sees the first set's value; merging
    // the sets past it would change what it sees.
    const ops = [
      { set: { path: "v", value: 1 } },
      { setIfAbsent: { path: "w", value: 0 } },
      { set: { path: "v", value: 2 } },
    ];
    expect(coalesce(ops)).toEqual(ops);
  });

  it("does not merge increments on different paths", () => {
    const ops = [{ incr: { path: "a", by: 1 } }, { incr: { path: "b", by: 1 } }];
    expect(coalesce(ops)).toEqual(ops);
  });
});

describe("several operations in one object", () => {
  it("becomes a batch, in the order they were written", () => {
    const op = normaliseOperation({
      set: { path: "best", value: 12 },
      setIfAbsent: { path: "bestUser", value: "@a:h" },
    } as never);
    expect(op).toEqual({
      batch: {
        ops: [
          { set: { path: "best", value: 12 } },
          { setIfAbsent: { path: "bestUser", value: "@a:h" } },
        ],
      },
    });
  });

  it("leaves a single operation exactly as it was", () => {
    const one = { incr: { path: "n", by: 1 } } as const;
    expect(normaliseOperation(one)).toBe(one);
  });

  it("folds the normalised batch to the same state as two applies", () => {
    const state = applyOperation(
      {},
      normaliseOperation({ set: { path: "a", value: 1 }, incr: { path: "b", by: 2 } } as never),
    );
    expect(state).toEqual({ a: 1, b: 2 });
  });
});

/** Every non-integer number anywhere in a value — what Synapse rejects. */
const fractionsIn = (value: unknown): number[] => {
  if (typeof value === "number") return Number.isInteger(value) ? [] : [value];
  if (Array.isArray(value)) return value.flatMap(fractionsIn);
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(fractionsIn);
  }
  return [];
};

describe("a Matrix event cannot carry a fraction", () => {
  it("sends a fraction as a string and reads it back as a number", () => {
    const op = {
      listAppend: { path: "strokes", item: { pts: [[0.42, 0.9], [0.5, 0.11]], w: 0.02 } },
    };
    const wire = encodeFloats(op);
    // What Synapse refuses is a fractional NUMBER; the digits living on
    // inside a string are exactly the point of the encoding.
    expect(fractionsIn(wire)).toEqual([]);
    expect(decodeFloats(wire)).toEqual(op);
  });

  it("leaves integers, strings and null exactly as they were", () => {
    const op = { set: { path: "turn", value: "b" } } as const;
    expect(encodeFloats(op)).toEqual(op);
    expect(encodeFloats({ incr: { path: "n", by: 3 } })).toEqual({ incr: { path: "n", by: 3 } });
    expect(decodeFloats({ a: "plain", b: null, c: 7 })).toEqual({ a: "plain", b: null, c: 7 });
  });

  it("keeps a drawing's coordinates to the pixel", () => {
    // The failure this replaces: rounding turned every 0…1 coordinate into
    // 0 or 1, and the drawing came out as lines along the canvas edges.
    const points = [[0.0123, 0.9876], [0.5001, 0.4999]];
    expect(decodeFloats(encodeFloats(points))).toEqual(points);
  });
});
