import { describe, expect, it } from "vitest";
import type { PlaylistTrackRow } from "../../types/library";
import { activePlaylistSort, nextPlaylistSort, sortPlaylistTracks } from "./playlistSort";

function track(position: number, fields: Partial<PlaylistTrackRow>): PlaylistTrackRow {
  return {
    id: `t${position}`,
    title: "",
    artist: null,
    duration: null,
    genre: null,
    year: null,
    track_number: null,
    position,
    artwork_url: null,
    album_name: null,
    album_id: null,
    bit_rate: null,
    suffix: null,
    replay_gain_track_gain: null,
    replay_gain_track_peak: null,
    replay_gain_album_gain: null,
    replay_gain_album_peak: null,
    ...fields,
  };
}

describe("nextPlaylistSort", () => {
  it("goes ascending, then descending, then back to playlist order", () => {
    const first = nextPlaylistSort(null, "p1", "title");
    expect(first).toEqual({ playlistId: "p1", field: "title", direction: "asc" });
    const second = nextPlaylistSort(first, "p1", "title");
    expect(second).toEqual({ playlistId: "p1", field: "title", direction: "desc" });
    expect(nextPlaylistSort(second, "p1", "title")).toBeNull();
  });

  it("starts ascending on a different column", () => {
    const current = { playlistId: "p1", field: "title", direction: "desc" } as const;
    expect(nextPlaylistSort(current, "p1", "duration")).toEqual({
      playlistId: "p1",
      field: "duration",
      direction: "asc",
    });
  });

  it("starts ascending when the sort belonged to another playlist", () => {
    const current = { playlistId: "p1", field: "title", direction: "asc" } as const;
    expect(nextPlaylistSort(current, "p2", "title")).toEqual({ playlistId: "p2", field: "title", direction: "asc" });
  });
});

describe("activePlaylistSort", () => {
  it("ignores a sort chosen on another playlist", () => {
    expect(activePlaylistSort({ playlistId: "p1", field: "title", direction: "asc" }, "p2")).toBeNull();
  });
});

describe("sortPlaylistTracks", () => {
  const tracks = [
    track(0, { title: "b", duration: 300 }),
    track(1, { title: "a", duration: null }),
    track(2, { title: "c", duration: 100 }),
  ];

  it("keeps playlist order with no sort", () => {
    expect(sortPlaylistTracks(tracks, null)).toBe(tracks);
  });

  it("sorts by the chosen column", () => {
    const byTitle = sortPlaylistTracks(tracks, { playlistId: "p1", field: "title", direction: "asc" });
    expect(byTitle.map((t) => t.position)).toEqual([1, 0, 2]);
    const byDuration = sortPlaylistTracks(tracks, { playlistId: "p1", field: "duration", direction: "desc" });
    expect(byDuration.map((t) => t.position)).toEqual([0, 2, 1]);
  });
});
