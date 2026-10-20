import { describe, expect, it } from "vitest";
import { pickTopResult } from "./searchScore";
import type { SearchAlbum, SearchArtist, SearchResults, SearchTrack } from "./useSearch";

const artist = (name: string): SearchArtist => ({
  name,
  album_count: 1,
  lastfm_image_url: null,
  wikidata_image_url: null,
  navidrome_image_url: null,
});

const album = (name: string, artistName: string | null = null): SearchAlbum => ({
  id: `al-${name}`,
  server_id: "srv-a",
  name,
  artist: artistName,
  artwork_url: null,
});

const track = (title: string, artistName: string | null = null): SearchTrack => ({
  id: `tr-${title}`,
  server_id: "srv-a",
  title,
  artist: artistName,
  album_id: "al-1",
  album_name: null,
  artwork_url: null,
  duration: null,
  replay_gain_track_gain: null,
  replay_gain_track_peak: null,
  replay_gain_album_gain: null,
  replay_gain_album_peak: null,
});

const results = (partial: Partial<SearchResults>): SearchResults => ({
  albums: [],
  tracks: [],
  artists: [],
  ...partial,
});

describe("pickTopResult", () => {
  it("picks the best match across kinds, not the first kind", () => {
    const top = pickTopResult(
      results({
        artists: [artist("Bjork Tribute Band")],
        albums: [album("Homogenic", "Björk")],
        tracks: [track("Bjork")],
      }),
      "bjork",
    );
    expect(top).toEqual({ kind: "track", track: track("Bjork") });
  });

  it("prefers the artist, then the album, on a tie", () => {
    expect(pickTopResult(results({ artists: [artist("Abba")], albums: [album("Abba")] }), "abba")?.kind).toBe("artist");
    expect(pickTopResult(results({ albums: [album("Abba")], tracks: [track("Abba")] }), "abba")?.kind).toBe("album");
  });

  it("weighs an album's artist below its own name, as the section ranking does", () => {
    const top = pickTopResult(results({ albums: [album("Gold", "Abba")], tracks: [track("Abba Medley")] }), "abba");
    expect(top?.kind).toBe("track");
  });

  it("reads the query the way the index did, so stray quotes and doubled spaces still match", () => {
    expect(pickTopResult(results({ artists: [artist("Sigur Ros")] }), ' "sigur   ros" ')?.kind).toBe("artist");
  });

  it("has no top result when nothing scores", () => {
    expect(pickTopResult(results({}), "abba")).toBeNull();
    expect(pickTopResult(results({ albums: [album("Gold")] }), "abba")).toBeNull();
  });
});
