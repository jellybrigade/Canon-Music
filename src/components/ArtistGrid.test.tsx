// @vitest-environment jsdom
/**
 * Coverage for `src/components/ArtistGrid.tsx`'s own geometry.
 *
 * The grid measures its scroller once, in a layout effect with empty deps - but it renders
 * the error, skeleton and empty branches *instead of* that scroller, so on a cold start
 * there is nothing to measure when the effect runs and nothing re-runs it when the artists
 * arrive. The measured width is what decides the column count, so the whole page collapses
 * to a single 190px column and stays there (see known-issues, "An effect that bails on a ref
 * the first render did not fill never runs at all").
 */
vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../hooks/useArtistImageCache", () => ({
  useArtistImageMap: () => new Map<string, string>(),
}));
vi.mock("../hooks/useEnrichArtist", () => ({ useEnrichArtist: () => ({ data: null }) }));
vi.mock("../hooks/useSetting", () => ({
  useSetting: (_key: string, def: string) => [def, async () => {}, true],
  useBoolSetting: (_key: string, def: boolean) => [def, async () => {}, true],
}));

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArtistGrid } from "./ArtistGrid";
import { getDb } from "../db";
import { createMigratedTestDb } from "../test/sqlite";
import { resetTauriMocks } from "../test/mocks/tauri";
import type { ArtistRow } from "../types/library";
import type { ServerWithCredential } from "../hooks/useServer";

const SRV: ServerWithCredential = {
  server: {
    id: "srv-a",
    type: "navidrome",
    url: "https://music.example",
    alt_url: null,
    display_name: "Home",
    username: "marcel",
    created_at: "2026-01-01T00:00:00Z",
  } as ServerWithCredential["server"],
  credential: { type: "md5", token: "tok", salt: "salt" } as ServerWithCredential["credential"],
};

// The stubbed viewport and the column count ArtistGrid must derive from it. Restated rather
// than imported: if the card constants change, this literal has to be updated deliberately.
const WIDTH = 900;
const PADDING = 20;
const COL_GAP = 16;
const CARD_MIN = 190;
const EXPECTED_COLS = Math.floor((WIDTH - PADDING * 2 + COL_GAP) / (CARD_MIN + COL_GAP));

function artist(name: string): ArtistRow {
  return {
    name,
    album_count: 2,
    artwork_url: null,
    lastfm_image_url: null,
    wikidata_image_url: null,
    navidrome_image_url: null,
    enriched_at: Math.floor(Date.now() / 1000),
  };
}

let queryClient: QueryClient;

function renderGrid(props: { artists: ArtistRow[]; isLoading?: boolean }) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ArtistGrid
        artists={props.artists}
        serverWithCredential={SRV}
        onSelect={() => {}}
        isLoading={props.isLoading ?? false}
      />
    </QueryClientProvider>
  );
}

/** The column count the grid actually painted, read off the row's own grid template. */
function paintedCols(): number {
  const row = document.querySelector<HTMLElement>(".album-grid-scroller [style*='grid-template-columns']");
  const match = /repeat\((\d+),/.exec(row?.style.gridTemplateColumns ?? "");
  return match ? Number(match[1]) : 0;
}

beforeAll(() => {
  // jsdom lays nothing out and has no ResizeObserver, so both sides of the measurement
  // have to be stubbed: a fixed offsetWidth, and an observer that never fires (the point
  // is what the grid computes from its *first* measurement).
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => WIDTH });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => WIDTH });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 });
});

beforeEach(async () => {
  resetTauriMocks();
  vi.mocked(getDb).mockResolvedValue(
    (await createMigratedTestDb()) as unknown as Awaited<ReturnType<typeof getDb>>
  );
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe("ArtistGrid", () => {
  it("fills the window with columns when the artists arrive after the first paint", () => {
    const view = renderGrid({ artists: [], isLoading: true });
    expect(paintedCols()).toBe(0);

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ArtistGrid
          artists={Array.from({ length: 12 }, (_, i) => artist(`Artist ${i}`))}
          serverWithCredential={SRV}
          onSelect={() => {}}
        />
      </QueryClientProvider>
    );
    expect(paintedCols()).toBe(EXPECTED_COLS);
  });

  it("fills the window with columns when the artists are there from the first paint", () => {
    renderGrid({ artists: Array.from({ length: 12 }, (_, i) => artist(`Artist ${i}`)) });
    expect(paintedCols()).toBe(EXPECTED_COLS);
  });
});
