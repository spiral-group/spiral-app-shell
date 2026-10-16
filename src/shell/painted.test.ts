/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066. When the host may stop covering a post.

`mount` resolving is the host's signal to reveal the app. It therefore has to
mean "there is something to see" — the shell accepting an artifact is not that,
because the frame still has to load, compile and render — and it has to happen
EVERY time, because a promise that never settles is a post that stays a card
for ever.

Those are the two properties here, and they pull against each other: the first
argues for waiting, the second for giving up. Both are tested because getting
one right at the cost of the other is the easy mistake.
*/

import { describe, expect, it } from "vitest";

import { RUNTIME_PAINTED, isRuntimePainted } from "./protocol";

describe("the painted signal", () => {
  it("is recognised on the wire", () => {
    expect(isRuntimePainted({ kind: RUNTIME_PAINTED })).toBe(true);
  });

  it("is not confused with the messages that arrive beside it", () => {
    // Boot means the module evaluated; an error means it gave up. Neither one
    // means an app is on screen, and treating either as paint would reveal an
    // empty frame — the exact thing the card exists to prevent.
    expect(isRuntimePainted({ kind: "runtime-boot" })).toBe(false);
    expect(isRuntimePainted({ kind: "runtime-error", message: "x", stage: "render" })).toBe(false);
    expect(isRuntimePainted({ id: 1, method: "state.shared.read" })).toBe(false);
    expect(isRuntimePainted(null)).toBe(false);
    expect(isRuntimePainted(RUNTIME_PAINTED)).toBe(false);
  });
});
