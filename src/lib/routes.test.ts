import { describe, expect, it } from "vitest";
import { ROUTES, albumPath, artistPath, playlistPath } from "./routes";

// React Router decodes a `:param` segment with decodeURIComponent, so the round trip a route
// actually performs is encodeURIComponent -> decodeURIComponent. Ids and artist names carry
// slashes, hashes and question marks often enough that an unencoded path silently addresses a
// different route.
const AWKWARD = [
  "AC/DC",
  "Sigur Rós",
  "P!nk",
  "Panic! At The Disco?",
  "#1 Record",
  "a b",
  "100%",
  "album&more",
  "срв:al1",
];

describe("path builders", () => {
  it.each(AWKWARD)("albumPath round-trips %s", (id) => {
    const path = albumPath(id);
    expect(decodeURIComponent(path.slice("/album/".length))).toBe(id);
  });

  it.each(AWKWARD)("artistPath round-trips %s", (name) => {
    const path = artistPath(name);
    expect(decodeURIComponent(path.slice("/artist/".length))).toBe(name);
  });

  it.each(AWKWARD)("playlistPath round-trips %s", (id) => {
    const path = playlistPath(id);
    expect(decodeURIComponent(path.slice("/playlist/".length))).toBe(id);
  });

  it("encodes a slash so it cannot become an extra path segment", () => {
    expect(albumPath("AC/DC")).toBe("/album/AC%2FDC");
    expect(albumPath("AC/DC").split("/")).toHaveLength(3);
  });

  it("encodes # and ? so they cannot become a fragment or a query", () => {
    expect(artistPath("#1?x")).toBe("/artist/%231%3Fx");
  });

  it("builds paths matching the declared route patterns", () => {
    expect(ROUTES.ALBUM.replace(":albumId", encodeURIComponent("srv:a1"))).toBe(albumPath("srv:a1"));
    expect(ROUTES.ARTIST.replace(":artistName", encodeURIComponent("Ye"))).toBe(artistPath("Ye"));
    expect(ROUTES.PLAYLIST.replace(":playlistId", encodeURIComponent("p1"))).toBe(playlistPath("p1"));
  });

  it("keeps every route unique", () => {
    const values = Object.values(ROUTES);
    expect(new Set(values).size).toBe(values.length);
  });
});
