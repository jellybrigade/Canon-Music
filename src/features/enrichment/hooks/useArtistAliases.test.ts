// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { getDb } from "../../../db";
import { QK } from "../../../lib/queryKeys";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { useRemoveArtistAlias, useSetArtistAlias } from "./useArtistAliases";

let db: FakeDatabase;
let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

const aliasFoldedKeys = [
  QK.artistTopTracks("Kanye West", "s1"),
  QK.artistSeedTrack("Kanye West", "s1"),
  QK.artistGenres("Kanye West", "s1"),
  QK.artistAppearsOn("Kanye West", "s1"),
  QK.similarArtistAlbums(["Kanye West"], "s1"),
  QK.similarInLibrary(["kanye west"]),
];

function seedAliasFoldedReads() {
  for (const key of aliasFoldedKeys) queryClient.setQueryData(key, []);
}

function invalidatedKeys() {
  return aliasFoldedKeys.filter((key) => queryClient.getQueryState(key)?.isInvalidated);
}

beforeEach(async () => {
  vi.mocked(invoke).mockReset();
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
});

describe("artist alias mutations", () => {
  it("merges through the one transaction that keeps aliases one hop deep", async () => {
    const { result } = renderHook(() => useSetArtistAlias(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ aliasName: "Ye", canonicalName: "Kanye West" });
    });

    expect(vi.mocked(invoke).mock.calls).toEqual([["merge_artist", { aliasName: "Ye", canonicalName: "Kanye West" }]]);
  });

  it("refreshes every read that folds aliases into their artist after a merge", async () => {
    seedAliasFoldedReads();
    const { result } = renderHook(() => useSetArtistAlias(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ aliasName: "Ye", canonicalName: "Kanye West" });
    });

    expect(invalidatedKeys()).toEqual(aliasFoldedKeys);
  });

  it("refreshes every read that folds aliases into their artist after an unmerge", async () => {
    await db.execute("INSERT INTO artist_aliases (alias_name, canonical_name) VALUES (?, ?)", ["Ye", "Kanye West"]);
    seedAliasFoldedReads();
    const { result } = renderHook(() => useRemoveArtistAlias(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync("Ye");
    });

    expect(invalidatedKeys()).toEqual(aliasFoldedKeys);
  });
});
