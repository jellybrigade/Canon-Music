// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../../../clients/musicbrainz", () => ({
  searchArtists: vi.fn(),
  lookupArtist: vi.fn().mockResolvedValue(null),
  searchReleaseGroups: vi.fn().mockResolvedValue([]),
  lookupReleaseGroup: vi.fn().mockResolvedValue(null),
  lookupRelease: vi.fn().mockResolvedValue(null),
  combineGenres: vi.fn().mockReturnValue([]),
}));

import { render, waitFor, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDb } from "../../../db";
import { searchArtists, type MbArtistCandidate } from "../../../clients/musicbrainz";
import { __resetSettingCache } from "../../../hooks/useSetting";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { ArtistIdentifyDialog } from "./IdentifyDialog";

let db: FakeDatabase;
let queryClient: QueryClient;

function candidate(id: string, score: number): MbArtistCandidate {
  return { id, name: id, disambiguation: null, country: null, score };
}

function renderDialog() {
  render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ArtistIdentifyDialog, { artistName: "slowdive", onClose: () => {} }),
    ),
  );
}

function selectedTitles(): string[] {
  return Array.from(document.querySelectorAll(".identify-candidate--selected .identify-candidate-title"))
    .map((el) => el.textContent ?? "");
}

function candidateCount(): number {
  return document.querySelectorAll(".identify-candidate").length;
}

beforeEach(async () => {
  __resetSettingCache();
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("ArtistIdentifyDialog auto-select", () => {
  it("selects a match that clears the minimum score with no close rival", async () => {
    vi.mocked(searchArtists).mockResolvedValue([candidate("strong", 100), candidate("weak", 60)]);

    renderDialog();

    await waitFor(() => expect(selectedTitles()).toEqual(["strong"]));
  });

  it("selects nothing when a rival scores within 5 of the top", async () => {
    vi.mocked(searchArtists).mockResolvedValue([candidate("strong", 100), candidate("rival", 96)]);

    renderDialog();

    await waitFor(() => expect(candidateCount()).toBe(2));
    await waitFor(() => expect(selectedTitles()).toEqual([]));
  });

  it("selects nothing for an artist the user already identified", async () => {
    db.raw
      .prepare("INSERT INTO artist_identity (artist_name, mb_artist_id, confirmed_at) VALUES ('slowdive', 'other', 1)")
      .run();
    vi.mocked(searchArtists).mockResolvedValue([candidate("strong", 100)]);

    renderDialog();

    await waitFor(() => expect(candidateCount()).toBe(1));
    await waitFor(() => expect(selectedTitles()).toEqual([]));
  });

  it("selects for an artist enriched in the background but never identified", async () => {
    db.raw.prepare("INSERT INTO artist_identity (artist_name, bio) VALUES ('slowdive', 'bio')").run();
    vi.mocked(searchArtists).mockResolvedValue([candidate("strong", 100)]);

    renderDialog();

    await waitFor(() => expect(selectedTitles()).toEqual(["strong"]));
  });
});
