/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066. The only channel out of a sandboxed frame.

The frame is opaque: no console relay reaches it, its DOM cannot be read, and
`window.webkit` is absent. Everything the host will ever learn about a failing
artifact arrives as one of these messages, so a parser that quietly downgrades
a stage is a parser that hides the failure it was written to surface.
*/

import { describe, expect, it } from "vitest";

import { parseRuntimeError } from "./protocol";

describe("parseRuntimeError", () => {
  it("keeps every stage the bootstrap can report", () => {
    // `live` is the one that matters most and was missing longest: errors
    // after the first render — a click handler, an effect, a rejected promise
    // — were reported by nothing at all.
    for (const stage of ["load", "compile", "import", "render", "live"] as const) {
      const parsed = parseRuntimeError({ kind: "runtime-error", message: "boom", stage });
      expect(parsed?.stage, `stage ${stage} must survive parsing`).toBe(stage);
    }
  });

  it("downgrades a stage it does not know rather than dropping the error", () => {
    const parsed = parseRuntimeError({ kind: "runtime-error", message: "boom", stage: "later" });
    expect(parsed?.stage).toBe("unknown");
    expect(parsed?.message).toBe("boom");
  });

  it("ignores anything that is not a runtime error", () => {
    expect(parseRuntimeError({ kind: "runtime-boot" })).toBeUndefined();
    expect(parseRuntimeError({ kind: "runtime-error" })).toBeUndefined();
    expect(parseRuntimeError(null)).toBeUndefined();
    expect(parseRuntimeError("runtime-error")).toBeUndefined();
  });
});
