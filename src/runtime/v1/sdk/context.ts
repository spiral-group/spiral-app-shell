/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007 § 5.4. The two read-only capabilities: who is looking,
and who else is here.

Both answer questions about the POST, not about the room's conversation.
`members.basic.read` is display names and avatars — the things needed to draw
a name next to a vote. It is not a directory, it carries no presence, and
there is deliberately no way from here to anything anyone has said: the app
has no route to messages at all (§ 4.8), which is what makes rendering a post
without asking anyone's permission defensible.

Shapes are checked rather than trusted. The host is ours, but a shape that
changed under us would otherwise surface as a blank name in a card nobody can
inspect — the frame's console reaches nothing.
*/

import type { SharedState } from "./state";

/** Who is looking at this post, and where. */
export interface SpiralContext {
  /** The viewer's Matrix user ID. */
  readonly userId: string;
  /** The room the post is in. */
  readonly roomId: string;
  /** The post's event ID. Also the state's identity. */
  readonly postId: string;
  /**
   * The language the viewer's app is shown in, as a primary subtag — "uk",
   * "ru", "en". A post is read by a whole room, each in their own language;
   * a post's own words (buttons, labels) can follow this, while what the
   * author wrote stays as written (§ 5.60).
   */
  readonly language: string;
}

/**
 * The viewer's language: from the handshake, else the frame's own
 * `navigator.language`, else English. Read afresh each time, not kept — the
 * handshake global is fixed for a mount, and a harness that installs one
 * host per process can then still vary it.
 */
export const handshakeLanguage = (): string => {
  const init = (globalThis as { __spiralInit?: { language?: unknown } }).__spiralInit;
  if (typeof init?.language === "string" && init.language.length > 0) return init.language.toLowerCase();
  const nav = typeof navigator === "undefined" ? "" : (navigator.language ?? "");
  return (nav.split("-")[0] || "en").toLowerCase();
};

/** One room member, as much as an app is allowed to know. */
export interface SpiralMember {
  readonly userId: string;
  /** Display name, or the user ID when they have not set one. */
  readonly displayName: string;
  /** The messenger's own small thumbnail as a `data:` URL, or undefined (§ 5.64). */
  readonly avatarUrl?: string;
}

/**
 * The one order every phone agrees on: by user ID, compared as code units.
 * Not `localeCompare` — two phones in two languages must agree.
 */
const byUserId = (a: SpiralMember, b: SpiralMember): number => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export const parseContext = (value: unknown): SpiralContext => {
  if (!isObject(value)) throw new Error("app.context.read: not an object");

  const userId = asString(value["userId"]);
  const roomId = asString(value["roomId"]);
  const postId = asString(value["postId"]);
  if (userId === undefined || roomId === undefined || postId === undefined) {
    throw new Error("app.context.read: missing userId, roomId or postId");
  }

  return { userId, roomId, postId, language: handshakeLanguage() };
};

/**
 * The roster, in the same order on every phone.
 *
 * Each host hands over its own order, and two phones in one room disagree —
 * the viewer's own phone may well list them first. Anything that goes by
 * position — a wheel's slices, whose turn comes next — then shows a different
 * person on each phone (§ 5.79), so the order is fixed here, once, for every
 * post and every host.
 */
export const parseMembers = (value: unknown): readonly SpiralMember[] => {
  if (!isObject(value)) throw new Error("members.basic.read: not an object");

  const members = value["members"];
  if (!Array.isArray(members)) throw new Error("members.basic.read: members is not a list");

  return members.flatMap((entry): SpiralMember[] => {
    if (!isObject(entry)) return [];
    const userId = asString(entry["userId"]);
    if (userId === undefined) return [];

    // A member with no display name is normal, not an error: falling back to
    // the user ID is what every Matrix client does, and it keeps the app from
    // having to decide what to draw.
    const displayName = asString(entry["displayName"]) ?? userId;
    const avatarUrl = asString(entry["avatarUrl"]);

    return [avatarUrl === undefined ? { userId, displayName } : { userId, displayName, avatarUrl }];
  }).sort(byUserId);
};

/**
 * Context never changes for a mounted app — the post and the room are fixed,
 * and the viewer cannot become someone else without a remount — so it is
 * fetched once and kept.
 */
export class HostFacts {
  private context: Promise<SpiralContext> | undefined;

  constructor(private readonly shared: SharedState) {}

  readContext(): Promise<SpiralContext> {
    this.context ??= this.shared.call("app.context.read").then(parseContext);
    return this.context;
  }

  /**
   * Not cached: someone can join or leave while a post is on screen, and a
   * poll showing "3 of 5" against a stale roster is wrong in a way nobody
   * would think to check.
   */
  readMembers(): Promise<readonly SpiralMember[]> {
    return this.shared.call("members.basic.read").then(parseMembers);
  }

  /** The host's clock, in ms since the epoch. See `Spiral.time`. */
  readTime(): Promise<number> {
    return this.shared.call("time.read").then((value) => {
      if (!isObject(value) || typeof value["now"] !== "number") {
        throw new Error("time.read: no now");
      }
      return value["now"];
    });
  }
}
