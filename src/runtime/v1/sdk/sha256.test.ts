/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.
*/
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { sha256 } from "./sha256";

describe("sha256", () => {
  it("gives the published vectors", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))
      .toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("agrees with node's own on every length round a block boundary, and in Cyrillic", () => {
    for (let n = 0; n < 200; n += 1) {
      const text = "ж".repeat(n % 7) + "x".repeat(n);
      expect(sha256(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
    }
  });
});
