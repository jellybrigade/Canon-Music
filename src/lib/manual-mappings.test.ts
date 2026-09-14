import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `getManualGenreMappings` holds module-level cache/inFlight/generation state,
 * so each test needs a fresh module instance via vi.resetModules() + vi.doMock("../db")
 * + dynamic import, same convention as canonicalize.test.ts's bustCanonTreeCache block.
 */

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function freshModule(select: ReturnType<typeof vi.fn>) {
  vi.resetModules();
  vi.doMock("../db", () => ({ getDb: async () => ({ select }) }));
  return import("./manual-mappings");
}

describe("getManualGenreMappings", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("queries tag_mappings on first call", async () => {
    const select = vi.fn(async () => [
      { raw_value: "Hip Hop", canonical_id: "hh" },
    ]);
    const { getManualGenreMappings } = await freshModule(select);

    const map = await getManualGenreMappings();

    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith(expect.stringContaining("tag_mappings"));
    expect(map.get(await import("./canonicalize").then((m) => m.canonicalKey("Hip Hop")))).toBe(
      "hh"
    );
  });

  it("resolves to an empty map, and caches it, when the table has no manual rows", async () => {
    const select = vi.fn(async () => []);
    const { getManualGenreMappings } = await freshModule(select);

    const map1 = await getManualGenreMappings();
    expect(map1.size).toBe(0);

    const map2 = await getManualGenreMappings();
    expect(select).toHaveBeenCalledTimes(1);
    expect(map2.size).toBe(0);
  });

  it("returns the same Map reference to every caller on a cache hit", async () => {
    const select = vi.fn(async () => [{ raw_value: "Rock", canonical_id: "rk" }]);
    const { getManualGenreMappings } = await freshModule(select);

    const map1 = await getManualGenreMappings();
    const map2 = await getManualGenreMappings();

    expect(select).toHaveBeenCalledTimes(1);
    expect(map2).toBe(map1);
  });

  it("de-dupes concurrent callers into a single db read while the first is in flight", async () => {
    const d = deferred<{ raw_value: string; canonical_id: string }[]>();
    const select = vi.fn(() => d.promise);
    const { getManualGenreMappings } = await freshModule(select);

    const p1 = getManualGenreMappings();
    const p2 = getManualGenreMappings();

    d.resolve([{ raw_value: "Jazz", canonical_id: "jz" }]);
    const [map1, map2] = await Promise.all([p1, p2]);

    expect(select).toHaveBeenCalledTimes(1);
    expect(map2).toBe(map1);
  });

  it("last row wins when two raw_values collapse to the same canonicalKey (SELECT has no ORDER BY)", async () => {
    const { canonicalKey } = await import("./canonicalize");
    const select = vi.fn(async () => [
      { raw_value: "R&B", canonical_id: "first" },
      { raw_value: "R and B", canonical_id: "second" },
    ]);
    // both raw_values collapse through the r&b alias table to the same canonicalKey
    expect(canonicalKey("R&B")).toBe(canonicalKey("R and B"));
    const { getManualGenreMappings } = await freshModule(select);

    const map = await getManualGenreMappings();

    expect(map.get(canonicalKey("R&B"))).toBe("second");
  });

  describe("invalidateManualMappings", () => {
    it("forces the next call to re-read from the db", async () => {
      const select = vi.fn(async () => []);
      const { getManualGenreMappings, invalidateManualMappings } = await freshModule(select);

      await getManualGenreMappings();
      await getManualGenreMappings();
      expect(select).toHaveBeenCalledTimes(1);

      invalidateManualMappings();
      await getManualGenreMappings();
      expect(select).toHaveBeenCalledTimes(2);
    });

    it("drops a stale in-flight read: does not cache it, and the next call re-queries", async () => {
      const d = deferred<{ raw_value: string; canonical_id: string }[]>();
      const select = vi.fn(() => d.promise);
      const { getManualGenreMappings, invalidateManualMappings } = await freshModule(select);

      const inFlightCall = getManualGenreMappings();
      // a write landed and invalidated while the read above was still pending
      invalidateManualMappings();
      d.resolve([{ raw_value: "Metal", canonical_id: "mt" }]);

      // the caller who started before invalidation still gets the (stale) result
      const staleMap = await inFlightCall;
      expect(staleMap.size).toBe(1);

      // but it must not have been cached over the invalidation
      const select2 = vi.fn(async () => []);
      const nextCall = getManualGenreMappings();
      // still using the same module instance/select mock (not select2) -
      // assert a fresh db read happened, proving cache stayed empty
      await nextCall;
      expect(select).toHaveBeenCalledTimes(2);
      void select2;
    });
  });

  it("retries on the next call after a failed read, instead of staying poisoned", async () => {
    // A module-scoped promise memo assigned only on the success side keeps handing the
    // rejection to every later caller, so one failed read stops manual genre mappings
    // from applying for the life of the process, and reads as a mapping bug.
    const select = vi
      .fn<() => Promise<{ raw_value: string; canonical_id: string }[]>>()
      .mockRejectedValueOnce(new Error("db unreachable"))
      .mockResolvedValue([{ raw_value: "Rock", canonical_id: "rk" }]);
    const { getManualGenreMappings } = await freshModule(select);

    await expect(getManualGenreMappings()).rejects.toThrow("db unreachable");
    const map = await getManualGenreMappings();

    expect(select).toHaveBeenCalledTimes(2);
    expect(map.size).toBe(1);
  });

  it("still de-dupes concurrent callers of a read that ends up failing", async () => {
    const gate = deferred<{ raw_value: string; canonical_id: string }[]>();
    const select = vi.fn(() => gate.promise);
    const { getManualGenreMappings } = await freshModule(select);

    const first = getManualGenreMappings();
    const second = getManualGenreMappings();
    gate.reject(new Error("db unreachable"));

    await expect(first).rejects.toThrow("db unreachable");
    await expect(second).rejects.toThrow("db unreachable");
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("does not clear a newer read armed by an invalidation while the failing one was in flight", async () => {
    const failing = deferred<{ raw_value: string; canonical_id: string }[]>();
    const select = vi
      .fn<() => Promise<{ raw_value: string; canonical_id: string }[]>>()
      .mockImplementationOnce(() => failing.promise)
      .mockResolvedValue([{ raw_value: "Rock", canonical_id: "rk" }]);
    const { getManualGenreMappings, invalidateManualMappings } = await freshModule(select);

    const doomed = getManualGenreMappings();
    invalidateManualMappings();
    const fresh = getManualGenreMappings();
    failing.reject(new Error("db unreachable"));

    await expect(doomed).rejects.toThrow("db unreachable");
    await expect(fresh).resolves.toBeInstanceOf(Map);
    // The cache the second read wrote survives the first read's late failure.
    expect((await getManualGenreMappings()).size).toBe(1);
    expect(select).toHaveBeenCalledTimes(2);
  });
});
