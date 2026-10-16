/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 § 5.75. Games, as the SDK knows them: seats, and a leaderboard.

Every game in a chat asks the same two questions — who plays which side, and
whom to tell — and every post answered them by hand, in its own keys, and
got the telling wrong. The catalogue's own chess told nobody on the first
move, because the other seat was still empty, and told the loser «your
move» on the last one (§ 5.74). So the answers live here once, and a
generated game gets them right by using them.

Seats are shared state (`seats.<seat>`, claimed with `setIfAbsent`, so two
people tapping at once end with one of them, on every phone). A best score is
OWNED state (`by.<user>.best`): only its owner can write it, which is what
makes a record a record.
*/

import { Spiral, useRoomMembers, useSharedState } from "./index";
import { OWNED_NAMESPACE, type SpiralValue } from "./operations";
import { summary, type SpiralLine, type SpiralSummary } from "./summary";
import type { SpiralMember } from "./context";

const isObject = (value: unknown): value is Readonly<Record<string, SpiralValue>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A member's name as a post shows it: the display name, else the id's localpart. */
const nameOf = (members: readonly SpiralMember[] | undefined, id: string): string =>
  members?.find((m) => m.userId === id)?.displayName ?? id.replace(/^@/, "").split(":")[0] ?? id;

// MARK: - Seats

export interface SpiralSeats<S extends string> {
  /** Who sits where. A free seat is absent. */
  readonly who: Readonly<Partial<Record<S, string>>>;
  /** The viewer's seat — the first, when they took two to play themselves. */
  readonly mine: S | undefined;
  /** Every seat taken. */
  readonly full: boolean;
  /** The name of whoever sits on `seat`, for a title. */
  readonly name: (seat: S) => string | undefined;
  /** Take a free seat. Nothing if it is taken; of two at once, one wins. */
  readonly sit: (seat: S, said?: SpiralSummary) => Promise<void>;
  /** Give up my seat — when a game ends, or to let someone else play. */
  readonly leave: (said?: SpiralSummary) => Promise<void>;
  /** Call a person to a free seat: they are pinged as challenged. */
  readonly invite: (seat: S, userId: string, line?: SpiralLine) => Promise<void>;
  /**
   * Whom to tell that `seat` is to move, ready to spread into a summary:
   * `summary({ line, ...seats.ping("O") })`.
   *
   * The person on the seat, as `turn`. A free seat: whoever was invited to
   * it, or — in a room of exactly two — the other one, as `challenge`; the
   * first move of a game in a private chat reaches the only possible
   * opponent. Nobody when the seat is the viewer's own.
   */
  readonly ping: (seat: S) => { readonly turn?: string; readonly challenge?: string };
}

/**
 * Seats for a game: `useSeats(["X", "O"])`, `useSeats(["w", "b"])`.
 *
 * Kept at `state.seats` (and `state.invited`), so a post's own keys stay its
 * own. A person may take two seats to play themselves; `mine` is the first.
 */
export const useSeats = <S extends string>(seats: readonly S[]): SpiralSeats<S> => {
  const [state] = useSharedState();
  const members = useRoomMembers();
  const me = Spiral.viewer;

  const taken = isObject(state["seats"]) ? state["seats"] : {};
  const invited = isObject(state["invited"]) ? state["invited"] : {};
  const who: Partial<Record<S, string>> = {};
  for (const seat of seats) {
    const id = taken[seat];
    if (typeof id === "string" && id.length > 0) who[seat] = id;
  }
  const mine = seats.find((seat) => who[seat] === me);

  const ping = (seat: S): { readonly turn?: string; readonly challenge?: string } => {
    const person = who[seat];
    if (person !== undefined) return person === me ? {} : { turn: person };
    const asked = invited[seat];
    if (typeof asked === "string" && asked.length > 0 && asked !== me) return { challenge: asked };
    const people = members ?? [];
    if (people.length === 2 && people.some((m) => m.userId === me)) {
      const other = people.find((m) => m.userId !== me)?.userId;
      if (other !== undefined && !Object.values(who).includes(other)) return { challenge: other };
    }
    return {};
  };

  return {
    who,
    mine,
    full: seats.every((seat) => who[seat] !== undefined),
    name: (seat) => (who[seat] === undefined ? undefined : nameOf(members, who[seat]!)),
    sit: (seat, said) => Spiral.apply({ setIfAbsent: { path: ["seats", seat], value: me } }, said),
    leave: (said) =>
      mine === undefined
        ? Promise.resolve()
        : Spiral.apply({ batch: { ops: seats.filter((s) => who[s] === me).map((s) => ({ del: { path: ["seats", s] } })) } }, said),
    invite: (seat, userId, line) =>
      Spiral.apply({ set: { path: ["invited", seat], value: userId } }, summary({ ...(line !== undefined ? { line } : {}), challenge: userId })),
    ping,
  };
};

// MARK: - Leaderboard

export interface SpiralScore {
  readonly userId: string;
  readonly name: string;
  readonly avatarUrl?: string;
  readonly best: number;
  readonly plays: number;
}

export interface SpiralLeaderboard {
  /** Everyone who has played, best first. */
  readonly entries: readonly SpiralScore[];
  /** First place, when anyone has played. */
  readonly leader: SpiralScore | undefined;
  /** The viewer's own, when they have played. */
  readonly mine: SpiralScore | undefined;
  /**
   * Record a finished game. A new best is kept in the viewer's own
   * namespace — nobody else can write it. Taking first place from someone
   * pings them as `record`, and the card says «emm2 — новий рекорд: 42» in
   * each reader's language.
   */
  readonly submit: (score: number, line?: SpiralLine) => Promise<void>;
}

const WORDS: Readonly<Record<string, {
  readonly record: (who: string, score: string) => string;
  readonly personal: (who: string, score: string) => string;
  readonly played: (who: string, score: string) => string;
}>> = {
  uk: {
    record: (w, s) => `${w} — новий рекорд: ${s}`,
    personal: (w, s) => `${w}: ${s} — особистий рекорд`,
    played: (w, s) => `${w}: ${s}`,
  },
  ru: {
    record: (w, s) => `${w} — новый рекорд: ${s}`,
    personal: (w, s) => `${w}: ${s} — личный рекорд`,
    played: (w, s) => `${w}: ${s}`,
  },
  en: {
    record: (w, s) => `${w} — new record: ${s}`,
    personal: (w, s) => `${w}: ${s} — personal best`,
    played: (w, s) => `${w}: ${s}`,
  },
};

/**
 * A chat's leaderboard for a game played alone — a runner, a stack, a quiz
 * against the clock. `better: "lower"` for times.
 *
 * `format` writes a score for the card, once per reader's language — a
 * time's unit is a word, and «новий рекорд: 243 ms» is not Ukrainian:
 * `format: (n, language) => `${n} ${language === "en" ? "ms" : "мс"}``.
 */
export const useLeaderboard = (
  options: { readonly better?: "higher" | "lower"; readonly format?: (score: number, language: string) => string } = {},
): SpiralLeaderboard => {
  const [state] = useSharedState();
  const members = useRoomMembers();
  const me = Spiral.viewer;
  const higher = (options.better ?? "higher") === "higher";
  const format = options.format ?? ((n: number): string => String(n));
  const beats = (a: number, b: number): boolean => (higher ? a > b : a < b);

  const by = isObject(state[OWNED_NAMESPACE]) ? state[OWNED_NAMESPACE] : {};
  const entries: SpiralScore[] = [];
  for (const [userId, own] of Object.entries(by)) {
    if (!isObject(own) || typeof own["best"] !== "number") continue;
    const member = members?.find((m) => m.userId === userId);
    entries.push({
      userId,
      name: nameOf(members, userId),
      ...(member?.avatarUrl !== undefined ? { avatarUrl: member.avatarUrl } : {}),
      best: own["best"],
      plays: typeof own["plays"] === "number" ? own["plays"] : 1,
    });
  }
  entries.sort((a, b) => (a.best === b.best ? a.name.localeCompare(b.name) : beats(a.best, b.best) ? -1 : 1));
  const leader = entries[0];
  const mine = entries.find((e) => e.userId === me);

  const submit = (score: number, line?: SpiralLine): Promise<void> => {
    const best = mine === undefined || beats(score, mine.best);
    const dethroned = best && leader !== undefined && leader.userId !== me && beats(score, leader.best) ? leader.userId : undefined;
    const who = nameOf(members, me);
    const said = line ?? Object.fromEntries(
      Object.entries(WORDS).map(([language, w]) => {
        const shown = format(score, language);
        return [language, dethroned !== undefined ? w.record(who, shown) : best ? w.personal(who, shown) : w.played(who, shown)];
      }),
    );
    return Spiral.apply(
      {
        batch: {
          ops: [
            { incr: { path: Spiral.mine("plays"), by: 1 } },
            ...(best ? [{ set: { path: Spiral.mine("best"), value: score } }] : []),
          ],
        },
      },
      summary({ line: said, record: dethroned }),
    );
  };

  return { entries, leader, mine, submit };
};
