/**
 * Process-local TTL cache for the long-lived `next dev` / local dashboard.
 * Not shared across workers; fine for solo-operator console.
 */

type Entry<T> = { at: number; value: T };

export function createTtlCache<T>(ttlMs: number) {
  let entry: Entry<T> | null = null;

  return {
    get(): T | undefined {
      if (!entry) return undefined;
      if (Date.now() - entry.at >= ttlMs) {
        entry = null;
        return undefined;
      }
      return entry.value;
    },
    set(value: T): T {
      entry = { at: Date.now(), value };
      return value;
    },
    clear() {
      entry = null;
    },
    async getOrSet(factory: () => Promise<T>): Promise<T> {
      const hit = this.get();
      if (hit !== undefined) return hit;
      return this.set(await factory());
    },
  };
}

/** Coalesce concurrent callers onto one in-flight promise. */
export function createSingleflight<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  let inflight: Promise<TResult> | null = null;
  return (...args: TArgs) => {
    if (inflight) return inflight;
    inflight = fn(...args).finally(() => {
      inflight = null;
    });
    return inflight;
  };
}
