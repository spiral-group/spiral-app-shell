/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066. The ruler, in an engine that lays out.

Every other test here runs in happy-dom, which does not lay out: every rect
is zero, so `measureLayout` cannot say anything and the corpus has never
been checked for the one thing a reader actually sees. Layout was therefore
a device ritual — build, install, drive the Layout lab by hand, read a log —
and between rituals nothing stopped a regression.

WebKit rather than Chromium, because the kit is written for the engine it
will run in: container queries in `cqmin`/`cqh`, `:has()`, `justify-content:
safe center`. A pass in Chromium would be a pass in an engine no reader has.

It is not the device. Fonts are the Mac's, not the phone's, so anything that
depends on how wide a word renders can differ, and the numbers here are
checked against a device sweep before they are believed.
*/

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["eval/layout.test.tsx"],
    browser: {
      enabled: true,
      provider: "playwright",
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: "webkit" }],
    },
  },
});
