// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../hooks/useAlbumDisplayName", () => ({ useAlbumDisplayName: () => (name: string) => name }));
vi.mock("../../hooks/useCoverCache", () => ({ useAlbumCoverMap: () => new Map<string, string>() }));

import { fireEvent, render, screen } from "@testing-library/react";
import type { ServerWithCredential } from "../../hooks/useServer";
import type { AlbumRow } from "../../types/library";
import { AlbumCarousel } from "./AlbumCarousel";

const SERVER: ServerWithCredential = {
  server: {
    id: "a",
    type: "navidrome",
    url: "https://a.example",
    alt_url: null,
    display_name: "A",
    username: "u",
    created_at: "2026-01-01",
  },
  credential: { type: "apikey", apiKey: "k" },
};

const ITEMS: AlbumRow[] = [{ id: "al-1", server_id: "a", name: "One", artist: null, year: null, artwork_url: null }];

type Extra = Partial<Pick<Parameters<typeof AlbumCarousel>[0], "refresh" | "scrollToStartRequest">>;

function renderCarousel(extra: Extra = {}) {
  const props = {
    title: "Newly Added",
    items: ITEMS,
    serverWithCred: SERVER,
    onSelectAlbum: vi.fn(),
    playAlbum: vi.fn(),
    onCardContextMenu: vi.fn(),
  };
  const view = render(<AlbumCarousel {...props} {...extra} />);
  return { ...view, rerenderWith: (next: Extra) => view.rerender(<AlbumCarousel {...props} {...next} />) };
}

let scrollTo: ReturnType<typeof vi.fn<(optionsOrX?: ScrollToOptions | number, y?: number) => void>>;

// jsdom lays nothing out: no ResizeObserver, no element scrolling.
class StubResizeObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  scrollTo = vi.fn<(optionsOrX?: ScrollToOptions | number, y?: number) => void>();
  HTMLElement.prototype.scrollTo = scrollTo;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AlbumCarousel refresh button", () => {
  it("runs the refresh on click under its own label", () => {
    const onClick = vi.fn();
    renderCarousel({ refresh: { onClick, label: "Check for new albums" } });

    fireEvent.click(screen.getByRole("button", { name: "Check for new albums" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("spins and refuses clicks while busy", () => {
    const onClick = vi.fn();
    const { container } = renderCarousel({ refresh: { onClick, label: "Check for new albums", isBusy: true } });

    const button = screen.getByRole("button", { name: "Check for new albums" });
    fireEvent.click(button);

    expect(button).toHaveProperty("disabled", true);
    expect(container.querySelector(".home-section__refresh-btn .player-spin")).not.toBeNull();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows a failure note with the full reason on hover", () => {
    renderCarousel({
      refresh: { onClick: vi.fn(), label: "Check", note: "Sync incomplete", noteDetail: "playlists unchanged" },
    });

    expect(screen.getByText("Sync incomplete").getAttribute("title")).toBe("playlists unchanged");
  });

  it("shows no note when there is nothing to report", () => {
    const { container } = renderCarousel({ refresh: { onClick: vi.fn(), label: "Check", note: null } });

    expect(screen.getByRole("button", { name: "Check" })).not.toBeNull();
    expect(container.querySelector(".home-section__note")).toBeNull();
  });
});

describe("AlbumCarousel scroll to start", () => {
  it("leaves the scroll alone on mount", () => {
    renderCarousel({ scrollToStartRequest: 0 });

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls back to the start once per request", () => {
    const { rerenderWith } = renderCarousel({ scrollToStartRequest: 0 });

    rerenderWith({ scrollToStartRequest: 1 });
    rerenderWith({ scrollToStartRequest: 1 });

    expect(scrollTo.mock.calls).toEqual([[{ left: 0 }]]);
  });
});
