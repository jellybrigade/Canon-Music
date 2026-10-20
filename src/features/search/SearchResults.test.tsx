// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../test/mocks/tauri")).eventModule);
vi.mock("../../db", () => ({ getDb: vi.fn(async () => db) }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerWithCredential } from "../../hooks/useServer";
import { createMigratedTestDb, type FakeDatabase } from "../../test/sqlite";
import { SearchResults } from "./SearchResults";

let db: FakeDatabase;

const serverWithCredential: ServerWithCredential = {
  server: {
    id: "srv-a",
    type: "navidrome",
    url: "https://example.test",
    alt_url: null,
    display_name: "Test",
    username: "u",
    created_at: "2026-01-01",
  },
  credential: { type: "md5", token: "t", salt: "s" },
};

function renderResults() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <SearchResults
        albums={[{ id: "srv-a:al-1", server_id: "srv-a", name: "Arrival", artist: "Abba", artwork_url: null }]}
        tracks={[]}
        artists={[]}
        serverWithCredential={serverWithCredential}
        onSelectAlbum={vi.fn()}
        onSelectArtist={vi.fn()}
        onPlayTrack={vi.fn()}
        onStartRadioFromAlbum={vi.fn()}
        onStartRadioFromArtist={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  // jsdom has no layout: the virtualizer needs a sized scroller to place any row.
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1200 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1200 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 900 });
});

beforeEach(async () => {
  db = await createMigratedTestDb();
});

afterEach(() => {
  cleanup();
});

describe("SearchResults", () => {
  it("shows its rows on the first commit, without waiting for an unrelated re-render", () => {
    // Asserted synchronously: the settings and image reads resolve later and re-render the
    // results, which used to be the only thing that ever bound the rows to their scroller.
    renderResults();

    expect(screen.queryByText("Arrival")).not.toBeNull();
  });
});
