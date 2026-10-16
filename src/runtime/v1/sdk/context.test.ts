/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

The host is ours, so these are not about defending against it. They are about
what happens when its shape changes under us: the frame's console reaches
nothing, so a field quietly becoming undefined would surface as a blank name
in a card nobody can inspect.
*/

import { describe, expect, it } from "vitest";

import { handshakeLanguage, parseContext, parseMembers } from "./context";

describe("context", () => {
  it("reads the three facts an app is given, and the viewer's language beside them", () => {
    (globalThis as { __spiralInit?: unknown }).__spiralInit = { viewerId: "@a:spiral.md", language: "uk" };
    expect(parseContext({ userId: "@a:spiral.md", roomId: "!r:spiral.md", postId: "$p" })).toEqual({
      userId: "@a:spiral.md",
      roomId: "!r:spiral.md",
      postId: "$p",
      language: "uk",
    });
  });

  it("throws rather than hand back a half-read context", () => {
    // An app that got `postId: undefined` would write its state somewhere
    // nobody is reading, and nothing would look wrong until two people
    // disagreed.
    expect(() => parseContext({ userId: "@a:spiral.md", roomId: "!r:spiral.md" })).toThrow();
    expect(() => parseContext(null)).toThrow();
    expect(() => parseContext({ userId: "", roomId: "!r", postId: "$p" })).toThrow();
  });
});

describe("members", () => {
  it("falls back to the user id when someone has no display name", () => {
    const members = parseMembers({ members: [{ userId: "@a:spiral.md" }] });
    expect(members).toEqual([{ userId: "@a:spiral.md", displayName: "@a:spiral.md" }]);
  });

  it("keeps an avatar when there is one", () => {
    const members = parseMembers({
      members: [{ userId: "@a:spiral.md", displayName: "A", avatarUrl: "mxc://x/y" }],
    });
    expect(members[0]?.avatarUrl).toBe("mxc://x/y");
  });

  it("skips an entry with no user id instead of failing the whole roster", () => {
    // One malformed member must not cost an app the other nine.
    const members = parseMembers({ members: [{ displayName: "?" }, { userId: "@a:spiral.md" }] });
    expect(members).toHaveLength(1);
  });

  it("comes in the same order on every phone, whatever order the host gave", () => {
    // Two phones in one DM, each listing its own user first: a wheel drawn
    // from those lists pointed at a different person on each (§ 5.79).
    const here = parseMembers({ members: [{ userId: "@emmm:spiral.md" }, { userId: "@emm2:spiral.md" }] });
    const there = parseMembers({ members: [{ userId: "@emm2:spiral.md" }, { userId: "@emmm:spiral.md" }] });
    expect(here.map((m) => m.userId)).toEqual(["@emm2:spiral.md", "@emmm:spiral.md"]);
    expect(there).toEqual(here);
    // Code units, not the phone's collation: "Z" sorts before "a" everywhere.
    expect(parseMembers({ members: [{ userId: "@a:h" }, { userId: "@Z:h" }] }).map((m) => m.userId)).toEqual(["@Z:h", "@a:h"]);
  });

  it("throws when the roster itself is not a list", () => {
    expect(() => parseMembers({ members: {} })).toThrow();
    expect(() => parseMembers({})).toThrow();
  });
});

describe("the viewer's language (§ 5.60)", () => {
  const set = (init: unknown): void => {
    (globalThis as { __spiralInit?: unknown }).__spiralInit = init;
  };

  it("comes from the handshake, as a primary subtag", () => {
    set({ viewerId: "@a:h", language: "RU" });
    expect(handshakeLanguage()).toBe("ru");
  });

  it("falls back to the frame's own language when the host does not send one", () => {
    set({ viewerId: "@a:h" });
    const nav = typeof navigator === "undefined" ? "en" : (navigator.language || "en").split("-")[0]!.toLowerCase();
    expect(handshakeLanguage()).toBe(nav);
  });

  it("is in the context a read returns", () => {
    set({ viewerId: "@a:h", language: "uk" });
    expect(parseContext({ userId: "@a:h", roomId: "!r:h", postId: "$p" }).language).toBe("uk");
  });
});
