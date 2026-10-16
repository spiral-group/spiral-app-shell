/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Pack the built first-party artifacts into containers the client can verify.

Vite emits a bare module. What a post carries is that module PLUS a manifest,
packed and addressed by the SHA-256 of the packed bytes (ADR-0007 § 5.12).
Doing it here rather than in Swift means the client only ever reads the format
one way — the way an agent-generated artifact will also be written.

The digest is written beside each container because the harness needs it to
build the post event, and computing it in two places is how two places come to
disagree.
*/

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { pack } from "../src/artifact/container.ts";

const here = dirname(fileURLToPath(import.meta.url));
const artifacts = join(here, "../dist/artifacts");

/**
 * What each first-party artifact declares.
 *
 * The probe asks for `spike.report`, which production never grants — that is
 * the point of it being here: the DEBUG harness passes a wider allowed set,
 * and a release build refusing this manifest is the behaviour we want.
 */
const MANIFESTS = {
  counter: {
    app_id: "counter",
    runtime: "1",
    entry: "app.jsx",
    aspect: "4:3",
    state_channel: "matrix",
    capabilities: ["app.context.read", "members.basic.read", "state.shared.read", "state.shared.write", "time.read"],
    limits: { max_state_bytes: 16384 },
  },
  conformance: {
    app_id: "conformance",
    runtime: "1",
    entry: "app.jsx",
    aspect: "3:4",
    state_channel: "matrix",
    capabilities: ["app.context.read", "members.basic.read", "state.shared.read", "state.shared.write", "time.read"],
    limits: { max_state_bytes: 16384 },
  },
  motion: {
    app_id: "motion",
    runtime: "1",
    entry: "app.jsx",
    aspect: "3:4",
    state_channel: "matrix",
    capabilities: ["app.context.read", "members.basic.read", "state.shared.read", "state.shared.write", "time.read"],
    limits: { max_state_bytes: 16384 },
  },
  lab: {
    app_id: "lab",
    runtime: "1",
    entry: "app.jsx",
    aspect: "1:1",
    state_channel: "matrix",
    capabilities: ["app.context.read", "members.basic.read", "state.shared.read", "state.shared.write", "time.read", "ui.haptic", "ui.expand"],
    limits: { max_state_bytes: 16384 },
  },
  probe: {
    app_id: "probe",
    runtime: "1",
    entry: "app.jsx",
    aspect: "1:1",
    state_channel: "matrix",
    capabilities: [
      "app.context.read",
      "members.basic.read",
      "state.shared.read",
      "state.shared.write",
      "spike.report",
    ],
    limits: { max_state_bytes: 16384 },
  },
};

for (const [name, manifest] of Object.entries(MANIFESTS)) {
  const source = readFileSync(join(artifacts, `${name}.jsx`), "utf8");
  const packed = pack(manifest, source);
  const digest = createHash("sha256").update(packed).digest("hex");

  writeFileSync(join(artifacts, `${name}.spiralapp`), packed);
  writeFileSync(join(artifacts, `${name}.sha256`), digest);

  console.log(`${name}.spiralapp  ${(packed.length / 1024).toFixed(1)} kB  ${digest.slice(0, 12)}…`);
}
