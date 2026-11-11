// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { getDb } from "../../../db";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { useSimilarInLibrary } from "./useSimilarInLibrary";

let db: FakeDatabase;
let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

async function seedArtist(id: string, serverId: string, name: string) {
  await db.execute(
    "INSERT INTO artists (id, server_id, server_type, name, album_count) VALUES (?, ?, 'navidrome', ?, 1)",
    [id, serverId, name],
  );
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
});

describe("useSimilarInLibrary", () => {
  it("counts an artist as in the library only on the server being viewed", async () => {
    await seedArtist("a1", "s1", "Mine");
    await seedArtist("a2", "s2", "Theirs");

    const { result } = renderHook(() => useSimilarInLibrary(["mine", "Theirs"], "s1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect([...result.current.data]).toEqual(["mine"]);
  });

  it("counts an alias only when the artist it was merged into is on that server", async () => {
    await seedArtist("a1", "s1", "Kanye West");
    await seedArtist("a2", "s2", "Prince");
    await db.execute("INSERT INTO artist_aliases (alias_name, canonical_name) VALUES ('Ye', 'Kanye West')");
    await db.execute("INSERT INTO artist_aliases (alias_name, canonical_name) VALUES ('TAFKAP', 'Prince')");

    const { result } = renderHook(() => useSimilarInLibrary(["Ye", "TAFKAP"], "s1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect([...result.current.data]).toEqual(["Ye"]);
  });
});
