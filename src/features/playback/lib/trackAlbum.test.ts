import { describe, it, expect } from "vitest";
import { albumRowOfTrack } from "./trackAlbum";

describe("albumRowOfTrack", () => {
  it("takes the server from the track's own id, not the selected server", () => {
    const row = albumRowOfTrack({
      id: "srv-b:t1", title: "T", artist: "A", duration: 1,
      album: "Alb", albumId: "srv-b:al1", artworkRef: "srv-b:al1",
    });
    expect(row).toEqual({
      id: "srv-b:al1", server_id: "srv-b", name: "Alb", artist: "A", year: null, artwork_url: "srv-b:al1",
    });
  });

  it("returns null for a track with no album id", () => {
    expect(albumRowOfTrack({ id: "srv:t1", title: "T", artist: null, duration: null, album: "Alb" })).toBeNull();
  });

  it("fills an absent album name and artwork with empty values", () => {
    expect(albumRowOfTrack({ id: "srv:t1", title: "T", artist: null, duration: null, albumId: "srv:al1" }))
      .toEqual({ id: "srv:al1", server_id: "srv", name: "", artist: null, year: null, artwork_url: null });
  });
});
