/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007 § 5.12. What an Interactive Post's artifact IS, as
bytes.

An artifact is a manifest and one module. Its identity is the SHA-256 of the
packed bytes, so three independent implementations — this packer, the Rust
one the agent will use, and the Swift unpacker — must produce and read the
same bytes from the same contents, forever.

That is why it is not tar and not zip. Both carry timestamps, permissions and
compression choices; none of those may change an identity, and all of them
differ between writers. The format below has nothing in it that is not the
contents:

    SPIRALv1\n
    manifest.json\n<decimal byte count>\n<bytes>
    app.jsx\n<decimal byte count>\n<bytes>

Entry order is fixed by the specification rather than by the writer. Byte
counts are of the UTF-8 bytes, not of the JavaScript string's length — the
two differ the moment an app contains a non-ASCII character, which for us is
the common case rather than the exotic one.
*/

/**
 * Capabilities a v1 artifact may ask for. Mirrors `SpiralAppCapability` —
 * and the mirror is checked by `scripts/check-capabilities.mjs`, because it
 * stopped being one: step 6.12 added the hand and the full screen here in
 * the shell's protocol but left this list, and the backend's, behind.
 */
export const V1_CAPABILITIES = [
  "app.context.read",
  "members.basic.read",
  "state.shared.read",
  "state.shared.write",
  "state.private.read",
  "state.private.write",
  "time.read",
  "ui.haptic",
  "ui.expand",
] as const;

export type ArtifactCapability = (typeof V1_CAPABILITIES)[number];

/**
 * What an artifact declares about itself.
 *
 * `capabilities` is a REQUEST. The host grants what it grants and refuses the
 * mount if an artifact asks for more than the runtime offers — an app that
 * expects a capability it will not get is better not started than started
 * half-working.
 */
export interface ArtifactManifest {
  readonly app_id: string;
  /** Runtime major version this was written against. */
  readonly runtime: string;
  /** Always `app.jsx` in v1; named so the format can outlive that. */
  readonly entry: string;
  /** `w:h`, e.g. `4:3`. The host sizes the row from it before loading. */
  readonly aspect: string;
  readonly state_channel: "matrix" | "private";
  readonly capabilities: readonly ArtifactCapability[];
  readonly limits: { readonly max_state_bytes: number };
}

export const MAGIC = "SPIRALv1";

const encoder = new TextEncoder();

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const entry = (name: string, body: Uint8Array): Uint8Array =>
  concat([encoder.encode(`${name}\n${body.length}\n`), body]);

/**
 * Pack a manifest and a module into artifact bytes.
 *
 * The manifest is serialised HERE rather than taken as text, so its key order
 * is this function's and not the caller's. Two callers writing the same
 * manifest must produce the same digest, and `JSON.stringify` over an object
 * literal preserves insertion order — which is the caller's, not ours.
 */
export const pack = (manifest: ArtifactManifest, source: string): Uint8Array => {
  const manifestJSON = JSON.stringify({
    app_id: manifest.app_id,
    runtime: manifest.runtime,
    entry: manifest.entry,
    aspect: manifest.aspect,
    state_channel: manifest.state_channel,
    capabilities: [...manifest.capabilities],
    limits: { max_state_bytes: manifest.limits.max_state_bytes },
  });

  return concat([
    encoder.encode(`${MAGIC}\n`),
    entry("manifest.json", encoder.encode(manifestJSON)),
    entry(manifest.entry, encoder.encode(source)),
  ]);
};

export interface UnpackedArtifact {
  readonly manifest: ArtifactManifest;
  readonly source: string;
}

/**
 * Read artifact bytes back.
 *
 * Exists so the packer can be tested against a reader rather than against a
 * golden blob — a golden blob agrees with whatever produced it, including a
 * bug. The Swift unpacker is the one that matters in production; this one
 * keeps the format honest on this side of the wire.
 */
export const unpack = (bytes: Uint8Array): UnpackedArtifact => {
  const decoder = new TextDecoder("utf-8", { fatal: true });

  // Checked before anything is parsed, so something that is not a container
  // at all says so — rather than failing later with whatever the first
  // mis-parse happens to be, which is a worse thing to read in a log.
  const magic = encoder.encode(`${MAGIC}\n`);
  const startsWithMagic =
    bytes.length >= magic.length && magic.every((byte, index) => bytes[index] === byte);
  if (!startsWithMagic) throw new Error("artifact: not a SPIRALv1 container");

  let offset = 0;

  const readLine = (): string => {
    const newline = bytes.indexOf(0x0a, offset);
    if (newline === -1) throw new Error("artifact: truncated before a newline");
    const line = decoder.decode(bytes.subarray(offset, newline));
    offset = newline + 1;
    return line;
  };

  readLine();

  const readEntry = (): { name: string; body: string } => {
    const name = readLine();
    const count = Number(readLine());
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`artifact: ${name} has a byte count that is not a whole number`);
    }
    if (offset + count > bytes.length) {
      throw new Error(`artifact: ${name} claims ${count} bytes and the container is shorter`);
    }
    const body = decoder.decode(bytes.subarray(offset, offset + count));
    offset += count;
    return { name, body };
  };

  const first = readEntry();
  if (first.name !== "manifest.json") {
    throw new Error(`artifact: expected manifest.json first, found ${first.name}`);
  }

  const manifest = JSON.parse(first.body) as ArtifactManifest;
  const second = readEntry();
  if (second.name !== manifest.entry) {
    throw new Error(`artifact: manifest names ${manifest.entry}, container carries ${second.name}`);
  }

  // Trailing bytes mean the writer and this reader disagree about the format,
  // which is exactly the disagreement a digest cannot detect on its own.
  if (offset !== bytes.length) {
    throw new Error(`artifact: ${bytes.length - offset} bytes after the last entry`);
  }

  return { manifest, source: second.body };
};
