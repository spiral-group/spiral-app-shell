/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

The builder exists so an app cannot express the one thing it is not allowed
to do. § 5.2: `ping` must be addressed and never room-wide — so there is no
argument for "ping everyone", and the level is derived from the audience
rather than asked for.
*/

import { describe, expect, it } from "vitest";

import { summary } from "./summary";

describe("notify level", () => {
  it("is none when the post has nothing to say", () => {
    expect(summary({})).toEqual({ notify: "none" });
  });

  it("is badge when there is a line but nobody named", () => {
    expect(summary({ line: "2 of 5 voted" })).toEqual({ line: "2 of 5 voted", notify: "badge" });
  });

  it("is ping only when someone is named", () => {
    expect(summary({ notify: ["@a:spiral.md"] })).toEqual({
      notify: "ping",
      notify_users: ["@a:spiral.md"],
    });
  });

  it("cannot be asked to ping the room", () => {
    // There is no input that produces `ping` with an empty audience: the
    // level follows the list, so the disallowed shape is unreachable rather
    // than rejected later.
    expect(summary({ notify: [] }).notify).toBe("none");
    expect(summary({ line: "done", notify: [] }).notify).toBe("badge");
  });
});

describe("fields", () => {
  it("drops a line that is only whitespace rather than showing a blank card", () => {
    expect(summary({ line: "   " })).toEqual({ notify: "none" });
  });

  it("writes the countdown as ISO-8601, which is what the host renders from", () => {
    const at = new Date("2026-09-14T12:00:00.000Z");
    expect(summary({ countdownTo: at }).countdown_to).toBe("2026-09-14T12:00:00.000Z");
  });

  it("names each user once", () => {
    // An app building this from a fold can easily list someone twice, and
    // twice in the list is twice on their lock screen.
    const said = summary({ notify: ["@a:spiral.md", "@a:spiral.md", "@b:spiral.md"] });
    expect(said.notify_users).toEqual(["@a:spiral.md", "@b:spiral.md"]);
  });

  it("omits what was not asked for instead of writing nulls into the event", () => {
    expect(Object.keys(summary({ line: "hi" })).sort()).toEqual(["line", "notify"]);
  });
});

describe("a line per language (§ 5.68)", () => {
  it("keeps every language, trimmed, and is a badge like any line", () => {
    expect(summary({ line: { uk: " Колесо обрало: Аня ", en: "The wheel picked Anya", ru: "  " } })).toEqual({
      line: { uk: "Колесо обрало: Аня", en: "The wheel picked Anya" },
      notify: "badge",
    });
    expect(summary({ line: { uk: "  " } })).toEqual({ notify: "none" });
  });

  // § 5.75 — why it pings: one kind per action, the strongest named.
  it("names a kind, and whom, from the field the app used", () => {
    expect(summary({ line: "e2–e4", turn: "@b:spiral.md" })).toEqual({
      line: "e2–e4",
      notify: "ping",
      notify_users: ["@b:spiral.md"],
      notify_kind: "turn",
    });
    expect(summary({ result: ["@b:spiral.md", null, ""], record: "@c:spiral.md" })).toMatchObject({
      notify_users: ["@b:spiral.md", "@c:spiral.md"],
      notify_kind: "result",
    });
  });

  it("pings nobody when the one named is missing — a free seat", () => {
    expect(summary({ line: "x", turn: undefined })).toEqual({ line: "x", notify: "badge" });
    expect(summary({ challenge: [] })).toEqual({ notify: "none" });
  });

  it("keeps the old notify, with no kind, which the client reads as «your move»", () => {
    expect(summary({ notify: ["@a:spiral.md"] })).toEqual({ notify: "ping", notify_users: ["@a:spiral.md"] });
  });
});

