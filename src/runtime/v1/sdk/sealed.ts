/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 § 5.78. Hidden moves: a hash in the room, the move on the phone.

Everything a post writes is in the room, readable by every member's phone —
so rock-paper-scissors played in the open is won by whoever moves second,
and a sea battle's fleet is on everyone's screen. A SEAL fixes that with
the oldest trick there is: the room gets `sha256(move | salt)`, the phone
keeps the move and the salt, and when the round is ready the phone opens
them; every phone checks the opening against the seal. Nobody learns a move
before it is opened, and nobody can open a different move than they sealed.

The seal is the viewer's own (`by.<viewer>.sealed.<key>`), so nobody else
can replace it; the move and salt are in the phone's own corner of the post
(`state.private.*`), which the host keeps for this account and this post
and never sends anywhere. A seal is final: re-sealing after an opponent
opened would be choosing with their move in view.
*/

import { useEffect, useRef, useSyncExternalStore } from "react";

import { privateStore, Spiral, useSharedState } from "./index";
import { OWNED_NAMESPACE, type SpiralOp, type SpiralValue } from "./operations";
import { sha256 } from "./sha256";
import type { SpiralSummary } from "./summary";

type SpiralObjectValue = Readonly<Record<string, SpiralValue>>;

const isObject = (value: unknown): value is SpiralObjectValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * One text for one value, whatever order its keys were written in — the
 * value that comes back from the room must hash to what was sealed.
 */
export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

/** 128 random bits: a move from a list of three is not guessable from its hash. */
const salt = (): string => {
  const bytes = new Uint8Array(16);
  const crypto = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

const checked = new Map<string, boolean>();
/** Whether `opening` is what `seal` promised. Remembered: a render checks every player. */
export const matches = (seal: string, value: SpiralValue, s: string): boolean => {
  const text = `${canonical(value)}|${s}`;
  const key = `${seal}|${text}`;
  let ok = checked.get(key);
  if (ok === undefined) {
    ok = sha256(text) === seal;
    if (checked.size > 500) checked.clear();
    checked.set(key, ok);
  }
  return ok;
};

export interface SpiralSealed<T extends SpiralValue> {
  /** The viewer's own sealed value — from THIS phone; undefined if not sealed here. */
  readonly mine: T | undefined;
  /** Who has sealed, in the order the room saw them. */
  readonly sealed: readonly string[];
  /** Who has opened, and what — each one checked against its seal. */
  readonly opened: Readonly<Record<string, T>>;
  /** Who opened something other than what they sealed. */
  readonly broken: readonly string[];
  /**
   * Seal a value: the room gets its hash, this phone keeps it. Final — a
   * second seal of the same key is refused. When `openWhen` is already true
   * with the viewer counted, it is opened in the same action.
   */
  readonly seal: (value: T, said?: SpiralSummary) => Promise<void>;
  /** Open the viewer's value to the room. Only the phone that sealed it can. */
  readonly open: (said?: SpiralSummary) => Promise<void>;
}

export interface SpiralSealedOptions {
  /**
   * Open the viewer's own value by itself as soon as this is true — for a
   * round of two, `(sealed) => sealed.length === 2`: the first player's
   * phone opens the moment the second has moved, with no tap. Without it the
   * post opens when it decides (`open()`), as a sea battle does at the end.
   */
  readonly openWhen?: (sealed: readonly string[]) => boolean;
  /** What that automatic opening writes to the card, if anything. */
  readonly said?: () => SpiralSummary | undefined;
}

const subscribe = (listener: () => void): (() => void) => privateStore().subscribe(listener);
const snapshot = (): SpiralObjectValue | undefined => privateStore().snapshot();

/**
 * A hidden move: `useSealed(`round-${n}`, { openWhen: (s) => s.length === 2 })`.
 *
 * `key` names one thing sealed once per player — a round, a fleet. A new
 * round is a new key.
 */
export const useSealed = <T extends SpiralValue>(key: string, options: SpiralSealedOptions = {}): SpiralSealed<T> => {
  const [state] = useSharedState();
  const secrets = useSyncExternalStore(subscribe, snapshot);
  const me = Spiral.viewer;

  const by = isObject(state[OWNED_NAMESPACE]) ? state[OWNED_NAMESPACE] : {};
  const sealed: string[] = [];
  const opened: Record<string, T> = {};
  const broken: string[] = [];
  const seals: Record<string, string> = {};
  for (const [user, own] of Object.entries(by)) {
    if (!isObject(own)) continue;
    const seal = isObject(own["sealed"]) ? own["sealed"][key] : undefined;
    if (typeof seal !== "string") continue;
    sealed.push(user);
    seals[user] = seal;
    const opening = isObject(own["opened"]) ? own["opened"][key] : undefined;
    if (!isObject(opening) || typeof opening["s"] !== "string" || opening["v"] === undefined) continue;
    if (matches(seal, opening["v"], opening["s"])) opened[user] = opening["v"] as T;
    else broken.push(user);
  }

  // The viewer's value, if THIS phone sealed it: a secret kept here that
  // does not open the viewer's seal belongs to some other seal.
  const secret = isObject(secrets?.["sealed"]) ? secrets["sealed"][key] : undefined;
  const kept = isObject(secret) && typeof secret["s"] === "string" && secret["v"] !== undefined ? secret : undefined;
  const mySeal = seals[me];
  const mine = kept !== undefined && (mySeal === undefined || matches(mySeal, kept["v"]!, kept["s"] as string))
    ? kept["v"] as T
    : undefined;

  const openOp = (value: SpiralValue, s: string): SpiralOp => ({ set: { path: Spiral.mine("opened", key), value: { v: value, s } } });

  const seal = async (value: T, said?: SpiralSummary): Promise<void> => {
    if (mySeal !== undefined) throw new Error(`«${key}» is already sealed — a seal is final`);
    const s = salt();
    // Kept on the phone BEFORE the room hears of it: a seal whose move was
    // lost could never be opened.
    await privateStore().update((current) => ({
      ...current,
      sealed: { ...(isObject(current["sealed"]) ? current["sealed"] : {}), [key]: { v: value, s } },
    }));
    const hash = sha256(`${canonical(value)}|${s}`);
    const others = sealed.filter((user) => user !== me);
    const openNow = options.openWhen?.([...others, me]) === true;
    const sealOp: SpiralOp = { set: { path: Spiral.mine("sealed", key), value: hash } };
    await Spiral.apply(openNow ? { batch: { ops: [sealOp, openOp(value, s)] } } : sealOp, said);
  };

  const open = async (said?: SpiralSummary): Promise<void> => {
    if (mySeal === undefined || kept === undefined || mine === undefined) {
      throw new Error(`«${key}» was not sealed on this phone`);
    }
    await Spiral.apply(openOp(kept["v"]!, kept["s"] as string), said);
  };

  // The automatic opening, on the phone that holds the value — once.
  const opening = useRef<string | undefined>(undefined);
  const ready = options.openWhen !== undefined && mine !== undefined && mySeal !== undefined
    && opened[me] === undefined && !broken.includes(me) && options.openWhen(sealed);
  useEffect(() => {
    if (!ready || opening.current === key) return;
    opening.current = key;
    open(options.said?.()).catch(() => {
      opening.current = undefined;
    });
  });

  return { mine, sealed, opened, broken, seal, open };
};
