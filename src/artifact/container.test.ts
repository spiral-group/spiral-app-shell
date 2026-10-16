/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

The format exists so that three implementations agree on one digest forever.
These tests are therefore about BYTES, not about round-tripping: a packer and
an unpacker written together will agree with each other even when both are
wrong, so the layout is asserted directly and only then read back.
*/

import { describe, expect, it } from "vitest";

import { MAGIC, pack, unpack, type ArtifactManifest } from "./container";

const manifest: ArtifactManifest = {
  app_id: "counter",
  runtime: "1",
  entry: "app.jsx",
  aspect: "4:3",
  state_channel: "matrix",
  capabilities: ["state.shared.read", "state.shared.write"],
  limits: { max_state_bytes: 16384 },
};

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe("the bytes", () => {
  it("starts with the magic and a newline", () => {
    expect(text(pack(manifest, "x")).startsWith(`${MAGIC}\n`)).toBe(true);
  });

  it("writes the manifest first, then the entry the manifest names", () => {
    const packed = text(pack(manifest, "SOURCE"));
    expect(packed.indexOf("manifest.json")).toBeLessThan(packed.indexOf("app.jsx"));
  });

  it("counts UTF-8 BYTES, not string length", () => {
    // The difference appears the moment an app contains a non-ASCII
    // character, which for us is the common case rather than the exotic one.
    // Nine Cyrillic letters at two bytes each, a space and a question mark:
    // 11 characters, 20 bytes. Written out because the first version of this
    // test asserted 21 from a count done in someone's head, and the packer
    // was right.
    const source = "Куди їдемо?";
    expect(source.length).toBe(11);
    expect(new TextEncoder().encode(source).length).toBe(20);
    expect(text(pack(manifest, source))).toContain("app.jsx\n20\n");
  });
});

describe("the digest is a function of the contents alone", () => {
  const bytesOf = (m: ArtifactManifest, source: string) => text(pack(m, source));

  it("does not depend on the caller's key order", () => {
    // `JSON.stringify` preserves insertion order, so a manifest built with
    // its fields in a different order would otherwise pack differently and
    // hash differently — the same app, two identities.
    const reordered = {
      limits: { max_state_bytes: 16384 },
      capabilities: ["state.shared.read", "state.shared.write"],
      state_channel: "matrix",
      aspect: "4:3",
      entry: "app.jsx",
      runtime: "1",
      app_id: "counter",
    } as ArtifactManifest;

    expect(bytesOf(reordered, "x")).toBe(bytesOf(manifest, "x"));
  });

  it("changes when the source changes by one character", () => {
    expect(bytesOf(manifest, "a")).not.toBe(bytesOf(manifest, "b"));
  });

  it("is stable across repeated packs", () => {
    expect(bytesOf(manifest, "x")).toBe(bytesOf(manifest, "x"));
  });
});

describe("reading back", () => {
  it("returns what went in", () => {
    const source = "export default function App() { return null; }";
    const read = unpack(pack(manifest, source));
    expect(read.source).toBe(source);
    expect(read.manifest).toEqual(manifest);
  });

  it("survives a source containing the format's own syntax", () => {
    // A generated app can contain anything, including something that looks
    // like an entry header. Byte counts are what makes that safe — a parser
    // that scanned for names would be fooled by this.
    const source = `const trap = "app.jsx\\n999\\n";\nexport default () => trap;`;
    expect(unpack(pack(manifest, source)).source).toBe(source);
  });

  it("refuses a container that is not one", () => {
    expect(() => unpack(new TextEncoder().encode("PK\u0003\u0004"))).toThrow(/SPIRALv1/);
  });

  it("refuses a byte count longer than the container", () => {
    const lying = new TextEncoder().encode(`${MAGIC}\nmanifest.json\n999\n{}`);
    expect(() => unpack(lying)).toThrow(/shorter/);
  });

  it("refuses trailing bytes after the last entry", () => {
    // A digest cannot catch a writer that appends: both sides would agree on
    // the hash and disagree about the contents.
    const packed = pack(manifest, "x");
    const extra = new Uint8Array(packed.length + 1);
    extra.set(packed);
    expect(() => unpack(extra)).toThrow(/after the last entry/);
  });

  it("refuses a container whose entry is not the one the manifest names", () => {
    const wrong = new TextEncoder().encode(
      `${MAGIC}\nmanifest.json\n${JSON.stringify(manifest).length}\n${JSON.stringify(manifest)}other.jsx\n1\nx`,
    );
    expect(() => unpack(wrong)).toThrow(/manifest names app\.jsx/);
  });
});
