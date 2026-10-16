/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066. End-to-end over the REAL built artifact.

`transpile.test.ts` checks hand-written snippets. This file takes the actual
bytes the artifact build produced — the hostile probe, 19 kB of bundled
TypeScript and JSX with dynamic imports, template literals and strings that
look like import statements — and runs the production transpile over them.

The step 5.1 counter is here for a narrower reason: it is the first artifact
to import `@spiral/sdk`, and a specifier that resolves to a path the scheme
handler does not publish fails as a blank post on a device rather than as a
red line here.

It is the closest thing to the device path that can run without a device:
fetch-as-text is simulated by reading the file, and everything after it is the
same code the sandboxed frame runs.

Skips (rather than fails) when the artifact has not been built, so a fresh
clone can run `pnpm test` before `pnpm build`.
*/

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { initTranspiler, transpile } from "./transpile";

const ARTIFACT = resolve(__dirname, "../../../dist/artifacts/probe.jsx");
const built = existsSync(ARTIFACT);

const COUNTER = resolve(__dirname, "../../../dist/artifacts/counter.jsx");
const counterBuilt = existsSync(COUNTER);

beforeAll(async () => {
  await initTranspiler();
});

describe.skipIf(!built)("pipeline over the built probe artifact", () => {
  const source = built ? readFileSync(ARTIFACT, "utf8") : "";

  it("ships bare specifiers that only the runtime can resolve", () => {
    // If the artifact build ever stops externalising React, the probe would
    // carry its own copy and the spike would test the wrong thing.
    expect(source).toMatch(/^import .* from "react\/jsx-runtime";/m);
    expect(source).toMatch(/^import .* from "react";/m);
  });

  it("compiles without throwing", () => {
    expect(() => transpile(source, "app.jsx")).not.toThrow();
  });

  it("resolves every runtime import to a served path", () => {
    const out = transpile(source, "app.jsx");
    expect(out).toContain(`from "/runtime/v1/react.js"`);
    expect(out).not.toMatch(/from "react"/);
    expect(out).not.toMatch(/from "react\/jsx-runtime"/);
  });

  it("keeps the default export the bootstrap mounts", () => {
    const out = transpile(source, "app.jsx");
    expect(out).toMatch(/as default/);
  });

  it("leaves string literals that resemble imports alone", () => {
    // The probe contains `.join(", ")` and similar; the regex-based
    // implementation this replaced threw on exactly that.
    const out = transpile(source, "app.jsx");
    expect(out).toContain(`join(",")`);
  });

  it("produces output of a sane size", () => {
    const out = transpile(source, "app.jsx");
    expect(out.length).toBeGreaterThan(source.length / 2);
    expect(out.length).toBeLessThan(source.length * 3);
  });
});

describe.skipIf(!counterBuilt)("pipeline over the built counter artifact", () => {
  const source = counterBuilt ? readFileSync(COUNTER, "utf8") : "";

  it("ships the SDK as a bare specifier, like a generated app would", () => {
    expect(source).toMatch(/^import .* from "@spiral\/sdk";/m);
  });

  it("resolves the SDK to the path the host publishes", () => {
    // `/runtime/v1/sdk.js` is what `SpiralAppShell.bundledResource(forPath:)`
    // answers on an artifact origin. Any other spelling is a 404 inside a
    // frame nothing can see into.
    const out = transpile(source, "app.jsx");
    expect(out).toContain(`"/runtime/v1/sdk.js"`);
    expect(out).not.toMatch(/"@spiral\/sdk"/);
  });

  it("keeps the default export the bootstrap mounts", () => {
    expect(transpile(source, "app.jsx")).toMatch(/as default/);
  });
});
