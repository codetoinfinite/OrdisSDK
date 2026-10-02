import { describe, expect, it, vi } from "vitest";
import { createTtlCache } from "../memo-util";

describe("createTtlCache", () => {
  it("serves the cached value until the TTL has passed", async () => {
    let time = 0;
    const cache = createTtlCache<number>(1000, () => time);
    const load = vi.fn(async () => time);

    expect(await cache.get("k", load)).toBe(0);
    time = 999;
    expect(await cache.get("k", load)).toBe(0);
    expect(load).toHaveBeenCalledTimes(1);
    time = 1000;
    expect(await cache.get("k", load)).toBe(1000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one load between concurrent callers of the same key", async () => {
    const cache = createTtlCache<string>(1000);
    const load = vi.fn(async () => "value");
    const other = vi.fn(async () => "other");

    const results = await Promise.all([
      cache.get("a", load),
      cache.get("a", load),
      cache.get("b", other),
    ]);
    expect(results).toEqual(["value", "value", "other"]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("drops a failed load so the next call retries", async () => {
    const cache = createTtlCache<string>(1000);
    const load = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok");

    await expect(cache.get("k", load)).rejects.toThrow("boom");
    expect(await cache.get("k", load)).toBe("ok");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("forgets everything on clear()", async () => {
    const cache = createTtlCache<number>(1000);
    const load = vi.fn(async () => 1);

    await cache.get("k", load);
    cache.clear();
    await cache.get("k", load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
