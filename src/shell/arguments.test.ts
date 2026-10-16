/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

The sender is hostile by assumption, so these are mostly refusals. The ones
worth reading twice are the values that pass `typeof` and then ruin the state
for everyone: NaN, Infinity, and an operation object carrying two operations.
*/

import { describe, expect, it } from "vitest";

import { checkArguments } from "./arguments";

const write = (op: unknown) => checkArguments("state.shared.write", { op });

describe("readers", () => {
  it("accept no arguments at all", () => {
    expect(checkArguments("state.shared.read", null)).toBeUndefined();
    expect(checkArguments("app.context.read", undefined)).toBeUndefined();
    expect(checkArguments("members.basic.read", {})).toBeUndefined();
  });
});

describe("state.private.write", () => {
  it("takes one small object, whole", () => {
    expect(checkArguments("state.private.read", null)).toBeUndefined();
    expect(checkArguments("state.private.write", { state: { sealed: { r1: { v: "rock", s: "ab" } } } })).toBeUndefined();
    expect(checkArguments("state.private.write", { state: [] })).toMatch(/needs \{ state/);
    expect(checkArguments("state.private.write", null)).toMatch(/needs \{ state/);
    expect(checkArguments("state.private.write", { state: { x: "y".repeat(9000) } })).toMatch(/a post may keep 8192/);
  });
});

describe("state.shared.write", () => {
  it("accepts every operation the runtime knows", () => {
    expect(write({ set: { path: "a", value: 1 } })).toBeUndefined();
    expect(write({ setIfAbsent: { path: "a", value: null } })).toBeUndefined();
    expect(write({ del: { path: "a" } })).toBeUndefined();
    expect(write({ incr: { path: "a", by: -2 } })).toBeUndefined();
    expect(write({ listAppend: { path: "a", item: { id: "1" } } })).toBeUndefined();
    expect(write({ listRemove: { path: "a", id: "1" } })).toBeUndefined();
  });

  it("accepts a batch of known operations, one level deep", () => {
    expect(write({ batch: { ops: [{ set: { path: "turn", value: "b" } }, { listAppend: { path: "history", item: "e2-e4" } }] } })).toBeUndefined();
    expect(write({ batch: { ops: [] } })).toMatch(/at least one/);
    expect(write({ batch: { ops: [{ batch: { ops: [{ del: { path: "a" } }] } }] } })).toMatch(/nest/);
    expect(write({ batch: { ops: [{ multiply: { path: "a", by: 2 } }] } })).toMatch(/batch: unknown operation/);
    expect(write({ batch: { ops: Array.from({ length: 65 }, () => ({ del: { path: "a" } })) } })).toMatch(/at most 64/);
  });

  it("refuses an unknown operation", () => {
    // A newer client's seventh operation must not be forwarded as if this
    // runtime could carry it out.
    expect(write({ multiply: { path: "a", by: 2 } })).toMatch(/unknown operation/);
  });

  it("refuses an object carrying two operations", () => {
    // The wire form is single-key. Two means the sender and this runtime
    // disagree about what was asked for, and picking one would be a guess.
    expect(write({ set: { path: "a", value: 1 }, del: { path: "a" } })).toMatch(/exactly one/);
  });

  it("refuses an empty path rather than treating it as the root", () => {
    expect(write({ set: { path: "", value: 1 } })).toMatch(/non-empty path/);
    expect(write({ del: {} })).toMatch(/non-empty path/);
  });

  it("refuses an increment that is not a finite number", () => {
    // These survive `typeof x === "number"` and then poison every later fold,
    // on every client, permanently — JSON has no way back from NaN.
    expect(write({ incr: { path: "a", by: Number.NaN } })).toMatch(/finite/);
    expect(write({ incr: { path: "a", by: Number.POSITIVE_INFINITY } })).toMatch(/finite/);
    expect(write({ incr: { path: "a", by: "2" } })).toMatch(/finite/);
  });

  it("refuses a set with no value, which is not the same as setting null", () => {
    expect(write({ set: { path: "a" } })).toMatch(/needs a value/);
    expect(write({ set: { path: "a", value: null } })).toBeUndefined();
  });

  it("refuses a listRemove without a string id", () => {
    expect(write({ listRemove: { path: "a", id: 1 } })).toMatch(/needs an id/);
  });

  it("refuses shapes that are not an operation at all", () => {
    expect(write(null)).toMatch(/must be an object/);
    expect(write([{ del: { path: "a" } }])).toMatch(/must be an object/);
    expect(write("del")).toMatch(/must be an object/);
    expect(checkArguments("state.shared.write", null)).toMatch(/needs an object/);
  });
});

describe("paths", () => {
  it("accepts an array, which is the only form that reaches a user ID", () => {
    // Dotted, `@a:spiral.md` splits on its own dot and writes somewhere else.
    expect(write({ set: { path: ["votes", "@a:spiral.md"], value: 1 } })).toBeUndefined();
  });

  it("refuses an array with an empty component", () => {
    expect(write({ del: { path: ["a", ""] } })).toMatch(/non-empty path/);
    expect(write({ del: { path: [] } })).toMatch(/non-empty path/);
  });

  it("refuses a path that is neither a string nor an array of strings", () => {
    expect(write({ del: { path: ["a", 1] } })).toMatch(/non-empty path/);
    expect(write({ del: { path: 1 } })).toMatch(/non-empty path/);
  });
});

describe("summary", () => {
  const withSummary = (summary: unknown) =>
    checkArguments("state.shared.write", { op: { del: { path: "a" } }, summary });

  it("is optional", () => {
    expect(withSummary(undefined)).toBeUndefined();
    expect(withSummary({ notify: "none" })).toBeUndefined();
  });

  it("accepts a line, a countdown and an addressed ping", () => {
    expect(
      withSummary({
        line: "2 of 5 voted",
        countdown_to: "2026-09-14T12:00:00.000Z",
        notify: "ping",
        notify_users: ["@a:spiral.md"],
      }),
    ).toBeUndefined();
  });

  it("accepts a line per language, and refuses any other shape (§ 5.68)", () => {
    expect(withSummary({ line: { uk: "Колесо обрало: Аня", en: "The wheel picked Anya" }, notify: "badge" })).toBeUndefined();
    expect(withSummary({ line: 7 })).toMatch(/summary.line/);
    expect(withSummary({ line: {} })).toMatch(/summary.line/);
    expect(withSummary({ line: { uk: 1 } })).toMatch(/summary.line/);
    expect(withSummary({ line: { "not a language": "x" } })).toMatch(/summary.line/);
  });

  it("refuses a ping that names nobody", () => {
    // The one shape here that reaches real people. § 5.2: ping must be
    // addressed, never room-wide — so it is refused, not downgraded, because
    // downgrading would hide that the app asked for something it may not have.
    expect(withSummary({ notify: "ping" })).toMatch(/name who to ping/);
    expect(withSummary({ notify: "ping", notify_users: [] })).toMatch(/name who to ping/);
  });

  it("admits a kind of ping it knows, and refuses one it does not (§ 5.75)", () => {
    expect(withSummary({ notify: "ping", notify_users: ["@a:spiral.md"], notify_kind: "record" })).toBeUndefined();
    expect(withSummary({ notify: "ping", notify_users: ["@a:spiral.md"], notify_kind: "shout" })).toMatch(/notify_kind must be one of/);
  });

  it("refuses a notify level the client has no meaning for", () => {
    expect(withSummary({ notify: "shout" })).toMatch(/must be one of/);
  });

  it("refuses a countdown that is not a date", () => {
    // It is rendered as a live countdown by native code that cannot ask again.
    expect(withSummary({ countdown_to: "soon" })).toMatch(/ISO-8601/);
  });

  it("refuses a notify_users that is not user ids", () => {
    expect(withSummary({ notify_users: "@a:spiral.md" })).toMatch(/list of user ids/);
    expect(withSummary({ notify_users: ["", "@a:spiral.md"] })).toMatch(/list of user ids/);
  });
});
