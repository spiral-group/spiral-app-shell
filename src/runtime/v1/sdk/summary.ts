/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 / ADR-0007 § 5.2. What a post says when nothing is running.

`summary` rides along with an action and is the only thing a client can show
without executing the app: the timeline card, a notification, a snapshot in a
search result. An app that never writes one still works — it simply has
nothing to say anywhere its own code is not running.

Answers design OPEN #8 — typed builder, not raw. Raw would mean every app
reinventing `notify_users`, and the one field with a rule worth enforcing
(`ping` must be addressed) would be enforced nowhere.
*/

/** How loudly a change should be announced. The app suggests; the client decides. */
export type SpiralNotify = "none" | "badge" | "ping";

/**
 * Why an app pings, which is what the push says first (§ 5.74): «Your move»,
 * «You are challenged», «Your record was beaten», «Game over» — or, for a
 * `mention`, the line alone.
 */
export type SpiralPingKind = "turn" | "challenge" | "record" | "result" | "mention";

/** Whom — one id, a list, or nothing; empty and missing ids are dropped. */
export type SpiralAddressees = string | readonly (string | null | undefined)[] | null | undefined;

/**
 * One line, or one per language — `{ uk, ru, en }` — and each reader's
 * phone shows its own (§ 5.68). A post's words follow whoever looks at it;
 * the line it writes to the card is its words too.
 */
export type SpiralLine = string | Readonly<Record<string, string>>;

/** The wire shape, `snake_case` because that is what the event carries. */
export interface SpiralSummary {
  readonly line?: SpiralLine;
  readonly countdown_to?: string;
  readonly notify?: SpiralNotify;
  readonly notify_users?: readonly string[];
  readonly notify_kind?: SpiralPingKind;
}

export interface SpiralSummaryInput {
  /**
   * One line for a card or a push, or one per language (`{ uk, ru, en }`)
   * so each reader sees their own. Keep it short; it is shown unexpanded.
   */
  readonly line?: SpiralLine;
  /** When something expires. The host renders the countdown, so it stays live. */
  readonly countdownTo?: Date;
  /**
   * Whom to ping, as «your move» — how posts wrote it before kinds. Naming
   * anyone implies `ping`; naming nobody implies `badge` when there is a
   * line, and `none` otherwise.
   */
  readonly notify?: readonly string[];
  /** It is their move now. */
  readonly turn?: SpiralAddressees;
  /** They are called to play: a seat waiting for them, a duel. */
  readonly challenge?: SpiralAddressees;
  /** Their best was just beaten. */
  readonly record?: SpiralAddressees;
  /** The game is over; the line says how. */
  readonly result?: SpiralAddressees;
  /** Anything else addressed to them — a task, a pick. The push is the line. */
  readonly mention?: SpiralAddressees;
}

/** The strongest first: one action says one thing, and whoever is named hears it. */
const KINDS: readonly SpiralPingKind[] = ["result", "record", "challenge", "turn", "mention"];

const addressees = (value: SpiralAddressees): string[] =>
  (typeof value === "string" ? [value] : (value ?? [])).filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );

/**
 * Build a `summary` for an action.
 *
 * The notify level is derived rather than asked for, because the rule it has
 * to obey is about the audience, not the loudness: § 5.2 says `ping` must be
 * addressed and never room-wide. Deriving it means an app cannot express the
 * thing it is not allowed to do — there is no argument for "ping everyone".
 */
export const summary = (input: SpiralSummaryInput): SpiralSummary => {
  const line = trimLine(input.line);
  // Deduplicated, because a list that names someone twice would push them
  // twice, and an app that builds it from a fold can easily do that.
  const kind = KINDS.find((k) => addressees(input[k]).length > 0);
  const named = [...KINDS.flatMap((k) => addressees(input[k])), ...addressees(input.notify)];
  const users = [...new Set(named)];

  const notify: SpiralNotify = users.length > 0 ? "ping" : line !== undefined ? "badge" : "none";

  return {
    ...(line ? { line } : {}),
    ...(input.countdownTo ? { countdown_to: input.countdownTo.toISOString() } : {}),
    notify,
    ...(users.length > 0 ? { notify_users: users } : {}),
    ...(users.length > 0 && kind ? { notify_kind: kind } : {}),
  };
};

/** Trimmed, and absent when there is nothing left — in every language. */
const trimLine = (line: SpiralLine | undefined): SpiralLine | undefined => {
  if (line === undefined) return undefined;
  if (typeof line === "string") return line.trim() || undefined;
  const kept = Object.entries(line)
    .map(([language, text]) => [language, text.trim()] as const)
    .filter(([, text]) => text.length > 0);
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
};
