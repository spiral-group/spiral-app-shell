/*
Copyright 2026 the Spiral authors. AGPL-3.0-or-later.

Brief 0066 § 5.78. The phone's own corner of a post: `state.private.*`.

One small object per post per account, kept by the host on this phone and
sent nowhere — the move behind a seal (`useSealed`). Replaced whole on every
write, so writes go to the host one at a time and in order: two quick
changes that crossed on the way would leave the older one standing.
*/

import type { SpiralMethod } from "../../../shell/protocol";
import type { SpiralValue } from "./operations";

export type SpiralPrivate = Readonly<Record<string, SpiralValue>>;

const isObject = (value: unknown): value is SpiralPrivate =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export class PrivateStore {
  private value: SpiralPrivate | undefined;
  private loading: Promise<SpiralPrivate> | undefined;
  private writing: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly call: (method: SpiralMethod, args?: unknown) => Promise<unknown>) {}

  /** What this phone keeps for the post; undefined until the host has answered. */
  snapshot(): SpiralPrivate | undefined {
    return this.value;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    // The first reader is what asks the host. A post without the capability
    // simply keeps nothing here, and a seal says so when it is tried.
    this.load().catch(() => undefined);
    return () => {
      this.listeners.delete(listener);
      // Nobody reads it any more: the next reader asks the host again. A
      // frame is one post, so on a phone this is a post that went away; in
      // a harness that mounts many posts in one page it is what keeps one
      // post's secrets from being another's.
      if (this.listeners.size === 0) {
        this.value = undefined;
        this.loading = undefined;
      }
    };
  }

  load(): Promise<SpiralPrivate> {
    if (this.value !== undefined) return Promise.resolve(this.value);
    this.loading ??= this.call("state.private.read", null).then(
      (data) => {
        // An update that raced the read is newer than what the host had.
        this.value ??= isObject(data) && isObject(data["state"]) ? data["state"] : {};
        this.notify();
        return this.value;
      },
      (error: unknown) => {
        this.loading = undefined;
        throw error;
      },
    );
    return this.loading;
  }

  /** Change what this phone keeps; resolves when the host has it. */
  async update(change: (current: SpiralPrivate) => SpiralPrivate): Promise<void> {
    const loaded = await this.load();
    const next = change(this.value ?? loaded);
    this.value = next;
    this.notify();
    const write = this.writing.then(() => this.call("state.private.write", { state: next }));
    this.writing = write.catch(() => undefined);
    await write;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
