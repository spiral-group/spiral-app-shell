//
// Copyright 2026 Spiral.
//
// The edits harness is an INSTRUMENT, not a gate: it is pointed at whichever
// trial corpus is being measured, and collected by the default run it fails
// on modules that are broken on purpose. Its own config so it is run
// deliberately and never by accident — and NOT merged with the base, whose
// `exclude` is what keeps it out of that run.
//
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["eval/edits.test.tsx"], exclude: ["node_modules/**"] },
});
