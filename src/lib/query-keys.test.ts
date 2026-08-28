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
    expect(QK.artistTopTracks("Ye", "srv")).not.toEqual(QK.artistTopTracks("Yes", "srv"));
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
    expect(QK.artistSeedTrack("Ye", "srv")[0]).not.toBe(QK.artistTopTracks("Ye", "srv")[0]);
  });

  // known-issues.md, the name-keyed wrong-owner class: these queries read a mirrored table by an
  // artist name, which carries no server prefix, so a key that omits the server serves one server's
  // rows to the other after a switch - with covers and stream URLs built for the wrong host.
  it("separates the artist-name reads of the mirror by server", () => {
    expect(QK.artistTopTracks("Ye", "srv-1")).not.toEqual(QK.artistTopTracks("Ye", "srv-2"));
    expect(QK.artistSeedTrack("Ye", "srv-1")).not.toEqual(QK.artistSeedTrack("Ye", "srv-2"));
    expect(QK.artistGenres("Ye", "srv-1")).not.toEqual(QK.artistGenres("Ye", "srv-2"));
    expect(QK.artistAppearsOn("Ye", "srv-1")).not.toEqual(QK.artistAppearsOn("Ye", "srv-2"));
    expect(QK.similarArtistAlbums(["Ye"], "srv-1")).not.toEqual(QK.similarArtistAlbums(["Ye"], "srv-2"));
    expect(QK.nowPlayingAlbums("Ye", "srv-1")).not.toEqual(QK.nowPlayingAlbums("Ye", "srv-2"));
    expect(QK.nowPlayingTopTracks("Ye", "srv-1")).not.toEqual(QK.nowPlayingTopTracks("Ye", "srv-2"));
    expect(QK.suggestedTracks("Ye", "t-1", "srv-1")).not.toEqual(QK.suggestedTracks("Ye", "t-1", "srv-2"));
  });

  it("treats an undefined argument as its own key, not as the argument's absence", () => {
    expect(QK.serverCredential(undefined)).toEqual(["server-credential", undefined]);
    expect(QK.serverCredential(undefined)).not.toEqual(QK.serverCredential("srv"));
  });
});
