// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackRow } from "../../types/library";
import { AlbumTrackList } from "./AlbumTrackList";

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockClear();
  // jsdom does not implement scrollIntoView at all.
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
});

afterEach(cleanup);

function track(id: string, title: string): TrackRow {
  return {
    id,
    title,
    artist: null,
    album_artist: null,
    album_id: "a1",
    genre: null,
    track_number: null,
    disc_number: null,
    year: null,
    duration: null,
    file_path: null,
    play_count: null,
    bit_rate: null,
    suffix: null,
    file_size: null,
    replay_gain_track_gain: null,
    replay_gain_track_peak: null,
    replay_gain_album_gain: null,
    replay_gain_album_peak: null,
  };
}

const TRACKS = [track("t1", "Airbag"), track("t2", "Paranoid Android"), track("t3", "Subterranean")];

function list(props: Partial<React.ComponentProps<typeof AlbumTrackList>>) {
  return (
    <AlbumTrackList
      tracks={TRACKS}
      isLoading={false}
      tracksError={null}
      missingTracks={{ isFetching: false, error: null, retry: () => {} }}
      trackTagGenresMap={new Map()}
      genreMappings={new Map()}
      currentTrackId={null}
      isPlaying={false}
      lovedTrackIds={new Set()}
      onToggleLove={() => {}}
      onPlayTrack={() => {}}
      onContextMenu={() => {}}
      highlightTrackId={null}
      {...props}
    />
  );
}

const highlightedTitles = () =>
  Array.from(document.querySelectorAll(".tracklist-row--highlighted .track-title"), (cell) => cell.textContent);

describe("AlbumTrackList pointing at one track", () => {
  it("marks only the named track and scrolls it into view", () => {
    render(list({ highlightTrackId: "t2" }));
    expect(highlightedTitles()).toEqual(["Paranoid Android"]);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(document.querySelector(".tracklist-row--highlighted"));
  });

  it("scrolls once, not again on every re-render while the user reads on", () => {
    const { rerender } = render(list({ highlightTrackId: "t2" }));
    rerender(list({ highlightTrackId: "t2", currentTrackId: "t1", isPlaying: true }));
    rerender(list({ highlightTrackId: "t2", lovedTrackIds: new Set(["t3"]) }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("scrolls to the track once the rows arrive after the skeleton", () => {
    const { rerender } = render(list({ highlightTrackId: "t3", isLoading: true, tracks: undefined }));
    expect(scrollIntoView).not.toHaveBeenCalled();
    rerender(list({ highlightTrackId: "t3" }));
    expect(highlightedTitles()).toEqual(["Subterranean"]);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("marks and scrolls nothing without a named track", () => {
    render(list({}));
    expect(highlightedTitles()).toEqual([]);
    expect(document.querySelectorAll(".tracklist-row")).toHaveLength(3);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
