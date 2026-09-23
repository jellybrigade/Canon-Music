import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedTestDb, type FakeDatabase } from "../test/sqlite";
import { CRED, server, SRV, OTHER } from "../test/navidromeFixtures";

const holder: { db: FakeDatabase | null } = { db: null };
vi.mock("../db", () => ({ getDb: async () => holder.db }));
vi.mock("../features/sync/syncTracks", () => ({ syncAlbumTracks: vi.fn() }));

import { syncAlbumTracks } from "../features/sync/syncTracks";
import { fetchAlbumTracks, loadAlbumTracks, loadAlbumTracksForPlay, resetAlbumTrackFetches, shouldFetchMissingTracks } from "./albumTracks";
import { useAlbumTracksNoticeStore } from "../store/albumTracksNotice";

const mSync = vi.mocked(syncAlbumTracks);
const ALBUM = `${SRV}:al-1`;

function db(): FakeDatabase {
  if (!holder.db) throw new Error("test db not initialized");
  return holder.db;
}

function seedAlbum(serverId: string, albumId: string, trackIds: string[]): void {
  db().raw.exec(
    `INSERT INTO albums (id, server_id, server_type, name) VALUES ('${albumId}', '${serverId}', 'navidrome', 'A');` +
      trackIds
        .map(
          (id, i) =>
            `INSERT INTO tracks (id, server_id, server_type, title, album_id, disc_number, track_number)` +
            ` VALUES ('${id}', '${serverId}', 'navidrome', 'T${i}', '${albumId}', 1, ${i + 1});`
        )
        .join("")
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetAlbumTrackFetches();
  useAlbumTracksNoticeStore.setState({ notice: null });
  holder.db = await createMigratedTestDb();
});

describe("loadAlbumTracks", () => {
  it("returns the mirrored tracks in disc and track order", async () => {
    seedAlbum(SRV, ALBUM, [`${SRV}:tr-2`, `${SRV}:tr-1`]);
    const tracks = await loadAlbumTracks(server(), CRED, ALBUM);
    expect(tracks.map((t: { id: string }) => t.id)).toEqual([`${SRV}:tr-2`, `${SRV}:tr-1`]);
  });

  it("does not go to the server when the album is already mirrored", async () => {
    seedAlbum(SRV, ALBUM, [`${SRV}:tr-1`]);
    await loadAlbumTracks(server(), CRED, ALBUM);
    expect(mSync).toHaveBeenCalledTimes(0);
  });

  it("fetches the album's tracks when the mirror holds none, then returns them", async () => {
    seedAlbum(SRV, ALBUM, []);
    mSync.mockImplementation(async () => {
      seedAlbum(SRV, "tmp", []);
      db().raw.exec(
        `INSERT INTO tracks (id, server_id, server_type, title, album_id, disc_number, track_number)
         VALUES ('${SRV}:tr-1', '${SRV}', 'navidrome', 'T', '${ALBUM}', 1, 1)`
      );
    });
    const tracks = await loadAlbumTracks(server(), CRED, ALBUM);
    expect(mSync).toHaveBeenCalledTimes(1);
    expect(tracks.map((t: { id: string }) => t.id)).toEqual([`${SRV}:tr-1`]);
  });

  it("gives up after one fetch when the server really has no tracks for the album", async () => {
    seedAlbum(SRV, ALBUM, []);
    mSync.mockResolvedValue(undefined);
    expect(await loadAlbumTracks(server(), CRED, ALBUM)).toEqual([]);
    expect(mSync).toHaveBeenCalledTimes(1);
  });

  it("does not fetch again on later clicks once the server reported the album empty", async () => {
    seedAlbum(SRV, ALBUM, []);
    mSync.mockResolvedValue(undefined);
    await loadAlbumTracks(server(), CRED, ALBUM);
    await loadAlbumTracks(server(), CRED, ALBUM);
    await loadAlbumTracks(server(), CRED, ALBUM);
    expect(mSync).toHaveBeenCalledTimes(1);
  });

  it("fetches again after the album page explicitly re-checks an empty album", async () => {
    seedAlbum(SRV, ALBUM, []);
    mSync.mockResolvedValue(undefined);
    await loadAlbumTracks(server(), CRED, ALBUM);
    await fetchAlbumTracks(server(), CRED, ALBUM);
    expect(mSync).toHaveBeenCalledTimes(2);
  });

  it("shares one fetch between a play click and the album page repairing the same album", async () => {
    seedAlbum(SRV, ALBUM, []);
    mSync.mockResolvedValue(undefined);
    await Promise.all([
      loadAlbumTracks(server(), CRED, ALBUM),
      fetchAlbumTracks(server(), CRED, ALBUM),
    ]);
    expect(mSync).toHaveBeenCalledTimes(1);
  });

  it("fetches once for two callers racing on the same album", async () => {
    seedAlbum(SRV, ALBUM, []);
    mSync.mockResolvedValue(undefined);
    await Promise.all([
      loadAlbumTracks(server(), CRED, ALBUM),
      loadAlbumTracks(server(), CRED, ALBUM),
    ]);
    expect(mSync).toHaveBeenCalledTimes(1);
  });

  it("lets the next caller retry after a failed fetch", async () => {
    seedAlbum(SRV, ALBUM, []);
    mSync.mockRejectedValueOnce(new Error("offline"));
    await expect(loadAlbumTracks(server(), CRED, ALBUM)).rejects.toThrow("offline");
    mSync.mockResolvedValue(undefined);
    expect(await loadAlbumTracks(server(), CRED, ALBUM)).toEqual([]);
    expect(mSync).toHaveBeenCalledTimes(2);
  });

  it("ignores another server's rows carrying the same album id", async () => {
    db().raw.exec(
      `INSERT INTO albums (id, server_id, server_type, name) VALUES ('${ALBUM}', '${OTHER}', 'navidrome', 'A');
       INSERT INTO tracks (id, server_id, server_type, title, album_id, disc_number, track_number)
       VALUES ('${OTHER}:tr-1', '${OTHER}', 'navidrome', 'T', '${ALBUM}', 1, 1)`
    );
    mSync.mockResolvedValue(undefined);
    expect(await loadAlbumTracks(server(), CRED, ALBUM)).toEqual([]);
  });
});

describe("loadAlbumTracksForPlay", () => {
  const album = { id: ALBUM, name: "Blue Train" };

  it("tells the user why nothing played when the fetch fails, instead of rejecting", async () => {
    seedAlbum(SRV, ALBUM, []);
    mSync.mockRejectedValueOnce(new Error("offline"));
    expect(await loadAlbumTracksForPlay(server(), CRED, album)).toEqual([]);
    expect(useAlbumTracksNoticeStore.getState().notice).toEqual({
      message: "Couldn't get the tracks for Blue Train: offline",
    });
  });

  it("tells the user the server lists no tracks for the album", async () => {
    seedAlbum(SRV, ALBUM, []);
    mSync.mockResolvedValue(undefined);
    expect(await loadAlbumTracksForPlay(server(), CRED, album)).toEqual([]);
    expect(useAlbumTracksNoticeStore.getState().notice).toEqual({
      message: "The server lists no tracks for Blue Train",
    });
  });

  it("says nothing when the album has tracks", async () => {
    seedAlbum(SRV, ALBUM, [`${SRV}:tr-1`]);
    expect(await loadAlbumTracksForPlay(server(), CRED, album)).toHaveLength(1);
    expect(useAlbumTracksNoticeStore.getState().notice).toBeNull();
  });
});

describe("shouldFetchMissingTracks", () => {
  const base = { isLoading: false, error: null, tracks: [] as { length: number }[], albumId: "al-1", attemptedAlbumId: null };

  it("fetches for an album whose track list came back empty", () => {
    expect(shouldFetchMissingTracks(base)).toBe(true);
  });

  it("waits while the read is still in flight", () => {
    expect(shouldFetchMissingTracks({ ...base, isLoading: true })).toBe(false);
  });

  it("does not fetch when the tracks are not known yet", () => {
    expect(shouldFetchMissingTracks({ ...base, tracks: undefined })).toBe(false);
  });

  it("leaves a failed read to its own retry button", () => {
    expect(shouldFetchMissingTracks({ ...base, error: "db closed" })).toBe(false);
  });

  it("does not fetch an album that already has tracks", () => {
    expect(shouldFetchMissingTracks({ ...base, tracks: [{ length: 1 }] })).toBe(false);
  });

  it("fetches only once for the same album", () => {
    expect(shouldFetchMissingTracks({ ...base, attemptedAlbumId: "al-1" })).toBe(false);
  });

  it("fetches again after the user walks to a different album", () => {
    expect(shouldFetchMissingTracks({ ...base, attemptedAlbumId: "al-0" })).toBe(true);
  });
});
