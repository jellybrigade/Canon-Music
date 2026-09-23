// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("../../sync/syncTracks", () => ({ repairAlbumTrackIds: vi.fn() }));

import { emitTauriEvent, listenerCount, resetTauriMocks } from "../../../test/mocks/tauri";
import { repairAlbumTrackIds } from "../../sync/syncTracks";
import { usePlayerStore } from "../store/player";
import { type CurrentTrack } from "../store/playerTypes";
import { useTrackIdRepair } from "./useTrackIdRepair";
import type { ServerWithCredential } from "../../../hooks/useServer";

const SERVER = {
  server: { id: "srv", url: "http://h", username: "u", type: "navidrome" },
  credential: { token: "t", salt: "s" },
} as unknown as ServerWithCredential;

const STREAM_URL = "http://h/rest/stream?id=a";

function track(id: string): CurrentTrack {
  return { id, title: "T", artist: "A", duration: 100, albumId: "srv:al-1" };
}

/** A track playing, its stream URL the one Rust will report the error against. */
function seedPlaying(overrides: Partial<CurrentTrack> = {}): void {
  const current = { ...track("srv:t1"), ...overrides };
  usePlayerStore.setState({ currentTrack: current, streamUrl: STREAM_URL, queue: [current], queueIndex: 0 });
}

async function emitError(payload: Record<string, unknown>): Promise<void> {
  await act(async () => {
    emitTauriEvent("audio-error", { url: STREAM_URL, message: "gone", ...payload });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

let retryCurrent: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetTauriMocks();
  vi.mocked(repairAlbumTrackIds).mockReset();
  vi.mocked(repairAlbumTrackIds).mockResolvedValue([]);
  retryCurrent = vi.fn();
  usePlayerStore.setState({ retryCurrent } as never);
  seedPlaying();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useTrackIdRepair", () => {
  it("re-resolves the album and replays when the server no longer knows the track id", async () => {
    vi.mocked(repairAlbumTrackIds).mockResolvedValue([{ oldId: "srv:t1", newId: "srv:t1-new" }]);
    renderHook(() => useTrackIdRepair(SERVER));

    await emitError({ subsonicCode: 70 });

    expect(repairAlbumTrackIds).toHaveBeenCalledWith(SERVER.server, SERVER.credential, "srv:al-1");
    expect(usePlayerStore.getState().currentTrack?.id).toBe("srv:t1-new");
    expect(retryCurrent).toHaveBeenCalledTimes(1);
  });

  it("leaves playback alone when the album came back with the same ids", async () => {
    renderHook(() => useTrackIdRepair(SERVER));

    await emitError({ subsonicCode: 70 });

    expect(repairAlbumTrackIds).toHaveBeenCalledTimes(1);
    expect(retryCurrent).not.toHaveBeenCalled();
  });

  it("ignores every other failure, which re-resolving cannot fix", async () => {
    renderHook(() => useTrackIdRepair(SERVER));

    await emitError({ subsonicCode: 40 });
    await emitError({});

    expect(repairAlbumTrackIds).not.toHaveBeenCalled();
  });

  it("ignores an error against a stream the user has already moved on from", async () => {
    renderHook(() => useTrackIdRepair(SERVER));

    await act(async () => {
      emitTauriEvent("audio-error", { url: "http://h/rest/stream?id=old", subsonicCode: 70 });
      await Promise.resolve();
    });

    expect(repairAlbumTrackIds).not.toHaveBeenCalled();
  });

  it("repairs an album once, so a repair that does not help cannot loop", async () => {
    renderHook(() => useTrackIdRepair(SERVER));

    await emitError({ subsonicCode: 70 });
    await emitError({ subsonicCode: 70 });

    expect(repairAlbumTrackIds).toHaveBeenCalledTimes(1);
  });

  it("still repairs a second album", async () => {
    renderHook(() => useTrackIdRepair(SERVER));

    await emitError({ subsonicCode: 70 });
    seedPlaying({ albumId: "srv:al-2" });
    await emitError({ subsonicCode: 70 });

    expect(repairAlbumTrackIds).toHaveBeenCalledTimes(2);
  });

  it("does nothing for a track with no album to re-resolve", async () => {
    seedPlaying({ albumId: null });
    renderHook(() => useTrackIdRepair(SERVER));

    await emitError({ subsonicCode: 70 });

    expect(repairAlbumTrackIds).not.toHaveBeenCalled();
  });

  it("does nothing without a credential to fetch with", async () => {
    renderHook(() => useTrackIdRepair(undefined));

    await emitError({ subsonicCode: 70 });

    expect(repairAlbumTrackIds).not.toHaveBeenCalled();
  });

  it("keeps playing the error it could not repair, rather than throwing", async () => {
    vi.mocked(repairAlbumTrackIds).mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderHook(() => useTrackIdRepair(SERVER));

    await emitError({ subsonicCode: 70 });

    expect(retryCurrent).not.toHaveBeenCalled();
  });

  it("arms exactly one listener and tears it down on unmount", async () => {
    const { rerender, unmount } = renderHook(() => useTrackIdRepair(SERVER));
    await act(async () => {
      await Promise.resolve();
    });
    rerender();
    await act(async () => {
      await Promise.resolve();
    });

    expect(listenerCount("audio-error")).toBe(1);

    unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(listenerCount("audio-error")).toBe(0);
  });
});
