// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("../../hooks/useAlbumDisplayName", () => ({ useAlbumDisplayName: () => (name: string) => name }));
vi.mock("../../hooks/useCoverCache", () => ({ useAlbumCoverMap: () => new Map<string, string>() }));
vi.mock("../../hooks/useAlbumAccent", () => ({ useAlbumAccent: () => null }));

import { fireEvent, render, screen } from "@testing-library/react";
import type { ServerWithCredential } from "../../hooks/useServer";
import type { AlbumRow } from "../../types/library";
import { Spotlight } from "./Spotlight";

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

const ALBUM: AlbumRow = { id: "a:al-1", server_id: "a", name: "Blue", artist: "Joni", year: 1971, artwork_url: null };

function renderSpotlight(primary: boolean) {
  const props = {
    pick: { kicker: "Rediscover", album: ALBUM },
    serverWithCred: SERVER,
    onSelectAlbum: vi.fn(),
    onSelectArtist: vi.fn(),
    playAlbum: vi.fn(),
    onAddToQueue: vi.fn(),
    onCardContextMenu: vi.fn(),
    primary,
  };
  render(<Spotlight {...props} />);
  return props;
}

describe("Spotlight", () => {
  it("opens the album from a secondary pick's title, where narrow windows hide the icon buttons", () => {
    const props = renderSpotlight(false);

    fireEvent.click(screen.getByRole("button", { name: "Blue" }));

    expect(props.onSelectAlbum).toHaveBeenCalledTimes(1);
    expect(props.onSelectAlbum).toHaveBeenCalledWith(ALBUM);
    expect(props.playAlbum).not.toHaveBeenCalled();
  });

  it("keeps the primary pick's buttons named when their labels collapse to icons", () => {
    const props = renderSpotlight(true);

    fireEvent.click(screen.getByRole("button", { name: "Add to Queue" }));
    fireEvent.click(screen.getByRole("button", { name: "Open album" }));

    expect(props.onAddToQueue).toHaveBeenCalledWith(ALBUM);
    expect(props.onSelectAlbum).toHaveBeenCalledWith(ALBUM);
  });
});
