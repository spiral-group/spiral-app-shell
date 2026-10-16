/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 § 5.57. Where WebKit on the phone draws differently from WebKit
anywhere else, the runtime evens it out — a post should not have to know.

Canvas text alignment. On iOS WebKit, `fillText` and `strokeText` IGNORE
`textAlign` when the string holds certain emoji sequences — a flag (a pair of
regional indicators, 🇺🇦) or a character with a variation selector (❤️) —
and draw it as if left-aligned from the anchor. A single-code-point emoji
(🎉), Cyrillic and CJK are drawn correctly. Found on a greeting card whose
owner asked for its banner centred: «ВІТАЄМО В УКРАЇНІ! 🇺🇦» started at the
middle and ran off the right edge, on the phone only — macOS WebKit, where
the ruler runs, centres it (probe in the device lab, 2026-09-25).

`measureText` is right even then (width 194, left 97, right 97 for that
string), so the fix is arithmetic: draw left-aligned from where the requested
alignment would have started the text. Always, not only when an emoji is
seen — which sequences trigger it is WebKit's business, and the arithmetic is
exact for every string.
*/

type TextDraw = (text: string, x: number, y: number, maxWidth?: number) => void;

/** The part of a 2D context the correction reads and writes. */
export interface TextContext {
  textAlign: CanvasTextAlign;
  direction: CanvasDirection;
  measureText(text: string): { readonly width: number };
}

/**
 * How far left of the anchor `x` the text starts under the context's
 * alignment: 0 for left, half its drawn width for center, all of it for
 * right. `maxWidth` squeezes a longer text to that width, so the drawn width
 * is the smaller of the two.
 */
export const anchorShift = (ctx: TextContext, text: string, maxWidth?: number): number => {
  const rtl = ctx.direction === "rtl";
  const align = ctx.textAlign;
  const fromRight = align === "right" || (align === "end" && !rtl) || (align === "start" && rtl);
  if (align !== "center" && !fromRight) return 0;
  let width = ctx.measureText(text).width;
  if (maxWidth !== undefined && maxWidth > 0 && width > maxWidth) width = maxWidth;
  return align === "center" ? width / 2 : width;
};

/** Replace `fillText` and `strokeText` on a 2D context prototype. */
export const correctTextDrawing = (proto: object): void => {
  for (const name of ["fillText", "strokeText"] as const) {
    const original = (proto as Record<string, unknown>)[name] as TextDraw | undefined;
    if (typeof original !== "function") continue;
    Object.defineProperty(proto, name, {
      configurable: true,
      writable: true,
      value: function (this: TextContext, text: string, x: number, y: number, maxWidth?: number): void {
        const draw = (atX: number): void => {
          if (maxWidth === undefined) original.call(this, text, atX, y);
          else original.call(this, text, atX, y, maxWidth);
        };
        const shift = anchorShift(this, String(text), maxWidth);
        if (shift === 0) {
          draw(x);
          return;
        }
        const align = this.textAlign;
        this.textAlign = "left";
        try {
          draw(x - shift);
        } finally {
          this.textAlign = align;
        }
      },
    });
  }
};

let corrected = false;

/** Install the corrections in this realm, once, before any post code runs. */
export const correctPlatform = (): void => {
  if (corrected) return;
  corrected = true;
  const realm = globalThis as {
    CanvasRenderingContext2D?: { prototype: object };
    OffscreenCanvasRenderingContext2D?: { prototype: object };
  };
  if (realm.CanvasRenderingContext2D) correctTextDrawing(realm.CanvasRenderingContext2D.prototype);
  if (realm.OffscreenCanvasRenderingContext2D) correctTextDrawing(realm.OffscreenCanvasRenderingContext2D.prototype);
};
