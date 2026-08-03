import { describe, expect, it } from "vitest";
import { QK } from "./query-keys";

/** Every factory in QK, called with placeholder arguments derived from its arity. */
function callAll(): Array<{ name: string; key: readonly unknown[] }> {
  return Object.entries(QK).map(([name, factory]) => {
    const args = Array.from({ length: factory.length }, (_, i) => `arg${i}`);
    return { name, key: (factory as (...a: unknown[]) => readonly unknown[])(...args) };
  });
}

describe("QK", () => {
  it("returns a stable key for the same arguments", () => {
    expect(QK.albums("+name", ["rock"])).toEqual(QK.albums("+name", ["rock"]));
    expect(QK.search("srv", "kid a")).toEqual(QK.search("srv", "kid a"));
  });

  it("distinguishes different arguments", () => {
    expect(QK.artistTopTracks("Ye")).not.toEqual(QK.artistTopTracks("Yes"));
    expect(QK.search("srv-1", "q")).not.toEqual(QK.search("srv-2", "q"));
  });

  it("never produces two identical keys from two different factories", () => {
    const seen = new Map<string, string>();
    for (const { name, key } of callAll()) {
      const serialized = JSON.stringify(key);
      const previous = seen.get(serialized);
      expect(previous, `${name} collides with ${previous}`).toBeUndefined();
      seen.set(serialized, name);
    }
  });

  it("starts every key with a non-empty string segment", () => {
    for (const { name, key } of callAll()) {
      expect(typeof key[0], name).toBe("string");
      expect((key[0] as string).length, name).toBeGreaterThan(0);
    }
  });

  it("keeps partial keys as prefixes of the specific keys they invalidate", () => {
    // React Query invalidates by prefix, so a partial key that is not a real prefix silently
    // invalidates nothing.
    expect(QK.albums("+name", null).slice(0, 1)).toEqual([...QK.albumsAll()]);
    expect(QK.albumsListeningStats().slice(0, 1)).toEqual([...QK.albumsAll()]);
    expect(QK.albumIdentity("al-1").slice(0, 1)).toEqual([...QK.albumIdentityAll()]);
    expect(QK.trackTagsAlbum("al-1").slice(0, 1)).toEqual([...QK.trackTagsAll()]);
    expect(QK.normalizedTags("al-1").slice(0, 1)).toEqual([...QK.normalizedTagsAll()]);
    expect(QK.lyricsTrack("t-1").slice(0, 1)).toEqual(["lyrics"]);
    expect(QK.settingsMbAutoIdentify().slice(0, 1)).toEqual([...QK.settingsAll()]);
  });

  it("keeps the single-row artist probe out of the artist top-tracks list key", () => {
    // Writing a one-element result under the full list's key starves the artist page.
    expect(QK.artistSeedTrack("Ye")[0]).not.toBe(QK.artistTopTracks("Ye")[0]);
  });

  it("treats an undefined argument as its own key, not as the argument's absence", () => {
    expect(QK.serverCredential(undefined)).toEqual(["server-credential", undefined]);
    expect(QK.serverCredential(undefined)).not.toEqual(QK.serverCredential("srv"));
  });
});
