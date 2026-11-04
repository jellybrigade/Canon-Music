import { describe, expect, it } from "vitest";
import { parseItunesCollection } from "./itunesAlbums";

// From the live lookup of PISS (artist 6796357519, 2026-11-04).
const PISS_ALBUM = {
  wrapperType: "collection",
  collectionType: "Album",
  artistId: 6796357519,
  artistName: "PISS",
  collectionName: "you made me / skin on linen",
  trackCount: 15,
  releaseDate: "2026-10-30T07:00:00Z",
};

describe("parseItunesCollection", () => {
  it("reads an album with its release day", () => {
    expect(parseItunesCollection(PISS_ALBUM)).toEqual({
      title: "you made me / skin on linen",
      recordType: "album",
      trackCount: 15,
      artistName: "PISS",
      releaseDate: "2026-10-30",
    });
  });

  it("takes the kind from the title's suffix, then drops it", () => {
    const single = { ...PISS_ALBUM, collectionName: "time loop at hot slit - Single", trackCount: 1 };
    expect(parseItunesCollection(single)).toMatchObject({ title: "time loop at hot slit", recordType: "single" });
    const ep = { ...PISS_ALBUM, collectionName: "Go Home - EP", trackCount: 5 };
    expect(parseItunesCollection(ep)).toMatchObject({ title: "Go Home", recordType: "ep" });
  });

  it("keeps the day iTunes names in winter too, never shifted to local time", () => {
    const winter = { ...PISS_ALBUM, releaseDate: "2021-01-29T08:00:00Z" };
    expect(parseItunesCollection(winter)).toMatchObject({ releaseDate: "2021-01-29" });
  });

  it("skips the artist entry and anything malformed", () => {
    expect(parseItunesCollection({ wrapperType: "artist", artistId: 1, artistName: "PISS" })).toBeNull();
    expect(parseItunesCollection({ ...PISS_ALBUM, trackCount: "15" })).toBeNull();
    expect(parseItunesCollection({ ...PISS_ALBUM, releaseDate: "soon" })).toBeNull();
    expect(parseItunesCollection({ ...PISS_ALBUM, collectionName: undefined })).toBeNull();
    expect(parseItunesCollection(null)).toBeNull();
  });
});
