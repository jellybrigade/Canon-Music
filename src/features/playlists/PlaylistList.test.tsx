// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ServerWithCredential } from "../../hooks/useServer";
import { PlaylistList } from "./PlaylistList";
import type { PlaylistRow } from "./usePlaylists";

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

let width = 900;
const ROW_GAP = 16;
// Taller than any estimate the grid could make, as when a long name wraps onto a second line.
const MEASURED_ROW_HEIGHT = 400;

function playlist(index: number): PlaylistRow {
  return {
    id: `srv-a:pl-${index}`,
    server_id: "srv-a",
    name: `Playlist ${index}`,
    comment: null,
    track_count: 10,
    cover_art_url: null,
    custom_cover_data: null,
    is_smart: 0,
    rules_json: null,
  };
}

function gridHeight(): number {
  const grid = document.querySelector<HTMLElement>(".playlist-list [style*='position: relative']");
  return grid ? Number.parseFloat(grid.style.height) : Number.NaN;
}

function rowOffsets(): number[] {
  return [...document.querySelectorAll<HTMLElement>(".playlist-list [style*='grid-template-columns']")].map((row) => {
    const match = /translateY\((-?[\d.]+)px\)/.exec(row.style.transform);
    return match ? Number(match[1]) : Number.NaN;
  });
}

let resizeWindow: (nextWidth: number) => void = () => {};

beforeAll(() => {
  // jsdom lays nothing out: a row's height is whatever the page reports, so stub it taller
  // than the card arithmetic would guess and check the next row starts below it.
  class StubResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {
      observers.add(this);
    }
    fire() {
      this.callback([], this as unknown as ResizeObserver);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      observers.delete(this);
    }
  }
  const observers = new Set<StubResizeObserver>();
  resizeWindow = (nextWidth) => {
    width = nextWidth;
    act(() => {
      for (const observer of observers) observer.fire();
    });
  };
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => width });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 2000 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-index") ? MEASURED_ROW_HEIGHT : 2000;
    },
  });
});

afterEach(() => {
  cleanup();
  width = 900;
});

function renderList(count = 12) {
  render(
    <PlaylistList
      playlists={Array.from({ length: count }, (_, i) => playlist(i))}
      serverWithCredential={SRV}
      onSelect={() => {}}
      onCreatePlaylist={async () => {}}
      onCreateSmartPlaylist={async () => {}}
    />,
  );
}

describe("PlaylistList", () => {
  it("starts each row of cards below the full height of the row above", async () => {
    renderList();
    await waitFor(() => expect(rowOffsets()[1]).toBe(MEASURED_ROW_HEIGHT + ROW_GAP));
    expect(rowOffsets()[2]).toBe(2 * (MEASURED_ROW_HEIGHT + ROW_GAP));
  });

  it("keeps rows below their measured height through small window resizes", async () => {
    renderList();
    await waitFor(() => expect(rowOffsets()[1]).toBe(MEASURED_ROW_HEIGHT + ROW_GAP));
    // Same column count each step, so no row's height changes and none reports a new size.
    for (const step of [895, 890, 885, 880]) {
      resizeWindow(step);
      expect(rowOffsets()[1]).toBe(MEASURED_ROW_HEIGHT + ROW_GAP);
    }
  });

  it("keeps rows below their measured height when the column count changes", async () => {
    renderList();
    await waitFor(() => expect(rowOffsets()[1]).toBe(MEASURED_ROW_HEIGHT + ROW_GAP));
    resizeWindow(600);
    await waitFor(() => expect(rowOffsets()[1]).toBe(MEASURED_ROW_HEIGHT + ROW_GAP));
    expect(rowOffsets()[2]).toBe(2 * (MEASURED_ROW_HEIGHT + ROW_GAP));
  });

  it("re-estimates every row not on screen when cards grow without the column count changing", async () => {
    renderList(200);
    await waitFor(() => expect(rowOffsets()[1]).toBe(MEASURED_ROW_HEIGHT + ROW_GAP));
    // 900px and 1000px both fit five columns; cards grow from 161px to 181px wide, and their
    // square art with them, so a row's estimate grows from 224px to 244px.
    resizeWindow(1000);
    const totalRows = 40;
    const mountedRows = rowOffsets().length;
    await waitFor(() =>
      expect(gridHeight()).toBe(
        mountedRows * MEASURED_ROW_HEIGHT + (totalRows - mountedRows) * 244 + (totalRows - 1) * ROW_GAP,
      ),
    );
    expect(rowOffsets()[1]).toBe(MEASURED_ROW_HEIGHT + ROW_GAP);
  });
});
