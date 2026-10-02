/**
 * Promise cache with a fixed time to live. Concurrent callers for the same key share one load;
 * a failed load is dropped at once so the next call retries.
 */
export function createTtlCache<T>(ttlMs: number, now: () => number = Date.now) {
  const entries = new Map<string, { expires: number; value: Promise<T> }>();

  return {
    get(key: string, load: () => Promise<T>): Promise<T> {
      const hit = entries.get(key);
      if (hit && hit.expires > now()) return hit.value;

      const value = load();
      entries.set(key, { expires: now() + ttlMs, value });
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      return value;
    },
    clear() {
      entries.clear();
    },
  };
}
