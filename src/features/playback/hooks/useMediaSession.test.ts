// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);

import { initCoverServer, replaceCoverRevisions, setCoverRevision } from "../../../clients/navidromeUrls";
import type { ServerWithCredential } from "../../../hooks/useServer";
import { usePlayerStore } from "../store/player";
import type { CurrentTrack } from "../store/playerTypes";
import { useMediaSession } from "./useMediaSession";

const track: CurrentTrack = { id: "srv-a:t1", title: "Track", artist: "Artist", duration: 200, album: "Album" };

type Handler = (details: MediaSessionActionDetails) => void;

const realSeek = usePlayerStore.getState().seek;
let handlers: Map<MediaSessionAction, Handler>;
let session: { metadata: unknown; playbackState: MediaSessionPlaybackState };

beforeEach(() => {
  handlers = new Map();
  session = { metadata: null, playbackState: "none" };
  vi.stubGlobal(
    "MediaMetadata",
    class {
      artwork: MediaImage[] | undefined;
      constructor(init: MediaMetadataInit) {
        this.artwork = init.artwork;
      }
    },
  );
  Object.defineProperty(navigator, "mediaSession", {
    configurable: true,
    value: {
      get metadata() {
        return session.metadata;
      },
      set metadata(value) {
        session.metadata = value;
      },
      get playbackState() {
        return session.playbackState;
      },
      set playbackState(value) {
        session.playbackState = value;
      },
      setPositionState: vi.fn(),
      setActionHandler: (action: MediaSessionAction, handler: Handler | null) => {
        if (handler) handlers.set(action, handler);
        else handlers.delete(action);
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  replaceCoverRevisions(null, new Map());
  usePlayerStore.setState({ currentTrack: null, isPlaying: false, elapsed: 0, seek: realSeek });
});

describe("useMediaSession", () => {
  it("tells the OS nothing is loaded once the queue is cleared, not that it is paused", () => {
    usePlayerStore.setState({ currentTrack: track, isPlaying: true });
    renderHook(() => useMediaSession(null));
    expect(session.playbackState).toBe("playing");

    act(() => usePlayerStore.setState({ currentTrack: null, isPlaying: false }));

    expect(session.playbackState).toBe("none");
  });

  it("keeps an OS scrubber position inside the track", () => {
    const seek = vi.fn().mockResolvedValue(undefined);
    usePlayerStore.setState({ currentTrack: track, seek });
    renderHook(() => useMediaSession(null));

    handlers.get("seekto")?.({ action: "seekto", seekTime: 250 });
    handlers.get("seekto")?.({ action: "seekto", seekTime: -5 });

    expect(seek.mock.calls).toEqual([[200], [0]]);
  });

  it("hands the OS a cover chosen while the track plays", () => {
    initCoverServer();
    const serverWithCred: ServerWithCredential = {
      server: {
        id: "srv-a",
        type: "navidrome",
        url: "http://nd",
        alt_url: null,
        display_name: "Home",
        username: "u",
        created_at: "",
      },
      credential: { type: "apikey", apiKey: "k" },
    };
    usePlayerStore.setState({ currentTrack: { ...track, artworkRef: "al-abc_ff" } });
    renderHook(() => useMediaSession(serverWithCred));
    const artworkSrc = () => (session.metadata as { artwork?: MediaImage[] } | null)?.artwork?.[0]?.src;
    expect(artworkSrc()).not.toContain("v=");

    act(() => setCoverRevision("srv-a", "abc", 1700));

    expect(artworkSrc()).toContain("v=1700");
  });
});
