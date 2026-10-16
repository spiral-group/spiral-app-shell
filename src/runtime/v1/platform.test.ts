/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 § 5.57. iOS WebKit ignores textAlign for text with a flag or a
variation-selector emoji; the runtime draws such text left-aligned from where
the alignment would have started it. A fake context stands in for the canvas:
what is tested is the arithmetic and that the context is left as it was.
*/

import { describe, expect, it } from "vitest";

import { anchorShift, correctTextDrawing, type TextContext } from "./platform";

class FakeContext implements TextContext {
  textAlign: CanvasTextAlign = "start";
  direction: CanvasDirection = "ltr";
  readonly calls: { text: string; x: number; y: number; maxWidth: number | undefined; align: CanvasTextAlign }[] = [];
  /** Ten pixels a character — enough to check the arithmetic. */
  measureText(text: string): { width: number } {
    return { width: [...text].length * 10 };
  }
  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    this.calls.push({ text, x, y, maxWidth, align: this.textAlign });
  }
  strokeText(text: string, x: number, y: number, maxWidth?: number): void {
    this.calls.push({ text, x, y, maxWidth, align: this.textAlign });
  }
}
correctTextDrawing(FakeContext.prototype);

describe("text drawn to a canvas", () => {
  it("is centred by the runtime, not by the engine", () => {
    const ctx = new FakeContext();
    ctx.textAlign = "center";
    ctx.fillText("ВІТАЄМО", 150, 20);

    expect(ctx.calls).toEqual([{ text: "ВІТАЄМО", x: 115, y: 20, maxWidth: undefined, align: "left" }]);
    expect(ctx.textAlign).toBe("center");
  });

  it("is right-aligned the same way, and end means right left-to-right", () => {
    const ctx = new FakeContext();
    ctx.textAlign = "right";
    ctx.strokeText("abc", 300, 10);
    ctx.textAlign = "end";
    ctx.fillText("abcd", 300, 10);

    expect(ctx.calls.map((c) => [c.x, c.align])).toEqual([
      [270, "left"],
      [260, "left"],
    ]);
  });

  it("leaves left and start alone", () => {
    const ctx = new FakeContext();
    ctx.textAlign = "left";
    ctx.fillText("abc", 5, 10);
    ctx.textAlign = "start";
    ctx.fillText("abc", 5, 10);

    expect(ctx.calls.map((c) => [c.x, c.align])).toEqual([
      [5, "left"],
      [5, "start"],
    ]);
  });

  it("uses the squeezed width when maxWidth is shorter than the text", () => {
    const ctx = new FakeContext();
    ctx.textAlign = "center";
    ctx.fillText("abcdefghij", 100, 0, 60);

    expect(ctx.calls[0]).toMatchObject({ x: 70, maxWidth: 60 });
  });

  it("reads start and end right-to-left", () => {
    const ctx = new FakeContext();
    ctx.direction = "rtl";
    ctx.textAlign = "start";
    expect(anchorShift(ctx, "abc")).toBe(30);
    ctx.textAlign = "end";
    expect(anchorShift(ctx, "abc")).toBe(0);
  });
});
