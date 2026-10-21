// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../../../clients/musicbrainz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../clients/musicbrainz")>()),
  searchReleaseGroups: vi.fn(),
  lookupReleaseGroup: vi.fn(),
  lookupRelease: vi.fn(),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import {
  lookupRelease,
  lookupReleaseGroup,
  type MbReleaseDetail,
  type MbReleaseGroupDetail,
  searchReleaseGroups,
} from "../../../clients/musicbrainz";
import { getDb } from "../../../db";
import { __resetSettingCache } from "../../../hooks/useSetting";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import type { TrackRow } from "../../../types/library";
import { AlbumIdentifyDialog } from "./IdentifyDialog";

let db: FakeDatabase;
let queryClient: QueryClient;

const groupDetail = (id: string): MbReleaseGroupDetail => ({
  id,
  title: "Fresh Album",
  firstReleaseDate: null,
  primaryType: "Album",
  artistName: "Some Artist",
  artistMbid: null,
  genres: [],
  tags: [],
  releases: [],
});

const releaseDetail = (id: string, releaseGroupId: string): MbReleaseDetail => ({
  id,
  releaseGroupId,
  title: "Fresh Album",
  date: null,
  country: null,
  label: null,
  catalogNumber: null,
  barcode: null,
  genres: [],
  tags: [],
  trackCount: 1,
});

function renderDialog() {
  render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(AlbumIdentifyDialog, {
        albumId: "srv:al-1",
        serverId: "srv",
        artist: "Some Artist",
        album: "Fresh Album",
        onClose: () => {},
      }),
    ),
  );
}

beforeEach(async () => {
  __resetSettingCache();
  db = await createMigratedTestDb();
  await db.execute(
    "INSERT INTO servers (id, type, url, display_name, username, created_at) VALUES ('srv', 'navidrome', 'https://srv', 'Srv', 'u', '2026-01-01')",
  );
  await db.execute(
    "INSERT INTO albums (id, server_id, server_type, name, artist) VALUES ('srv:al-1', 'srv', 'navidrome', 'Fresh Album', 'Some Artist')",
  );
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(searchReleaseGroups).mockResolvedValue([
    {
      id: "album",
      title: "Fresh Album",
      firstReleaseDate: null,
      primaryType: "Album",
      secondaryTypes: [],
      artistName: "Some Artist",
      artistMbid: null,
      score: 100,
    },
  ]);
  vi.mocked(lookupReleaseGroup).mockImplementation(async (id) => groupDetail(id));
  vi.mocked(lookupRelease).mockImplementation(async (id) => releaseDetail(id, "tagged-group"));
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("AlbumIdentifyDialog Look up", () => {
  it("waits for the album's tracks before looking up, then looks up once", async () => {
    let resolveTracks: (rows: TrackRow[]) => void = () => {};
    vi.mocked(invoke).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTracks = resolve;
        }),
    );
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Look up" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Looking up…" })).toBeTruthy());
    expect(lookupReleaseGroup).not.toHaveBeenCalled();

    await act(async () => resolveTracks([]));
    await waitFor(() => expect(lookupReleaseGroup).toHaveBeenCalledExactlyOnceWith("album"));
  });

  it("takes the release the files are tagged with over a search", async () => {
    await db.execute("UPDATE albums SET mb_release_id = 'tagged-release' WHERE id = 'srv:al-1'");
    vi.mocked(invoke).mockResolvedValue([]);
    renderDialog();
    await waitFor(() => expect(searchReleaseGroups).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Look up" }));

    await waitFor(() => expect(lookupReleaseGroup).toHaveBeenCalledExactlyOnceWith("tagged-group"));
    expect(lookupRelease).toHaveBeenCalledExactlyOnceWith("tagged-release");
    expect(searchReleaseGroups).toHaveBeenCalledTimes(1);
  });
});
