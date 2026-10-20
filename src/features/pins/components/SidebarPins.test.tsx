// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("../../../hooks/useAlbumDisplayName", () => ({ useAlbumDisplayName: () => (name: string) => name }));
vi.mock("../../../hooks/useCoverCache", () => ({ useAlbumCoverMap: () => new Map<string, string>() }));
vi.mock("../../../hooks/useArtistImageCache", () => ({
  useArtistImageMap: () => new Map<string, string>(),
  resolveArtistImageUrl: () => null,
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getDb } from "../../../db";
import type { ServerWithCredential } from "../../../hooks/useServer";
import { QK } from "../../../lib/queryKeys";
import { SRV } from "../../../test/navidromeFixtures";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { SidebarPins } from "./SidebarPins";

const SERVER: ServerWithCredential = {
  server: {
    id: SRV,
    type: "navidrome",
    url: "https://a.example",
    alt_url: null,
    display_name: "A",
    username: "u",
    created_at: "2026-01-01",
  },
  credential: { type: "apikey", apiKey: "k" },
};

let db: FakeDatabase;
let queryClient: QueryClient;

beforeEach(async () => {
  db = await createMigratedTestDb();
  db.raw.exec(`
    INSERT INTO albums (id, server_id, server_type, name, artist) VALUES
      ('${SRV}:al-1', '${SRV}', 'navidrome', 'Kid A', 'Radiohead'),
      ('${SRV}:al-2', '${SRV}', 'navidrome', 'Amnesiac', 'Radiohead'),
      ('${SRV}:al-3', '${SRV}', 'navidrome', 'OK Computer', 'Radiohead');
    INSERT INTO artists (id, server_id, server_type, name, album_count) VALUES
      ('a1', '${SRV}', 'navidrome', 'Radiohead', 1);
  `);
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

function pinAlbum(id: string, pinnedAt: number) {
  db.raw.exec(
    `INSERT INTO pinned_albums (album_id, server_id, pinned_at) VALUES ('${SRV}:${id}', '${SRV}', ${pinnedAt})`,
  );
}
const pinArtist = (pinnedAt: number) =>
  db.raw.exec(
    `INSERT INTO pinned_artists (server_id, artist_name, pinned_at) VALUES ('${SRV}', 'Radiohead', ${pinnedAt})`,
  );

function renderPins(isExpanded = true) {
  const handlers = { onSelectAlbum: vi.fn(), onSelectArtist: vi.fn() };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SidebarPins serverWithCredential={SERVER} isExpanded={isExpanded} {...handlers} />
    </QueryClientProvider>,
  );
  return { ...view, handlers };
}

const rowTitles = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".sidebar-pin"), (row) => row.getAttribute("title"));

describe("SidebarPins", () => {
  it("renders nothing while nothing is pinned", async () => {
    const { container } = renderPins();
    await waitFor(() => expect(queryClient.getQueryState(QK.pins(SRV))?.status).toBe("success"));
    expect(container.querySelector(".sidebar-pins")).toBeNull();
  });

  it("shows the three newest album and artist pins", async () => {
    pinArtist(1);
    pinAlbum("al-1", 2);
    pinAlbum("al-2", 3);
    pinAlbum("al-3", 4);
    const { container } = renderPins();

    await waitFor(() => expect(container.querySelectorAll(".sidebar-pin")).toHaveLength(3));
    expect(rowTitles(container)).toEqual(["OK Computer · Album", "Amnesiac · Album", "Kid A · Album"]);
    expect(screen.getByText("Pinned")).toBeTruthy();
  });

  it("groups albums above artists with a rule between them", async () => {
    pinAlbum("al-1", 1);
    pinArtist(2);
    pinAlbum("al-2", 3);
    const { container } = renderPins();

    await waitFor(() => expect(container.querySelectorAll(".sidebar-pin")).toHaveLength(3));
    const order = Array.from(container.querySelectorAll(".sidebar-pin, .sidebar-pins__separator"), (el) =>
      el.classList.contains("sidebar-pins__separator") ? "|" : el.getAttribute("title"),
    );
    expect(order).toEqual(["Amnesiac · Album", "Kid A · Album", "|", "Radiohead · Artist"]);
  });

  it("draws no rule when only one kind is pinned", async () => {
    pinAlbum("al-1", 1);
    pinAlbum("al-2", 2);
    const { container } = renderPins();

    await waitFor(() => expect(container.querySelectorAll(".sidebar-pin")).toHaveLength(2));
    expect(container.querySelector(".sidebar-pins__separator")).toBeNull();
  });

  it("shows only thumbnails in the collapsed sidebar, names in the tooltip", async () => {
    pinAlbum("al-1", 1);
    const { container } = renderPins(false);

    await waitFor(() => expect(container.querySelectorAll(".sidebar-pin")).toHaveLength(1));
    expect(container.querySelector(".sidebar-pin__label")).toBeNull();
    expect(screen.queryByText("Pinned")).toBeNull();
    expect(rowTitles(container)).toEqual(["Kid A · Album"]);
  });

  it("opens an album or an artist", async () => {
    pinArtist(1);
    pinAlbum("al-1", 2);
    const { container, handlers } = renderPins();
    await waitFor(() => expect(container.querySelectorAll(".sidebar-pin")).toHaveLength(2));

    const [album, artist] = Array.from(container.querySelectorAll(".sidebar-pin"));
    fireEvent.click(album as Element);
    fireEvent.click(artist as Element);

    expect(handlers.onSelectAlbum.mock.calls.map(([a]) => a.id)).toEqual([`${SRV}:al-1`]);
    expect(handlers.onSelectArtist.mock.calls.map(([a]) => a.name)).toEqual(["Radiohead"]);
  });

  it("unpins from the right-click menu", async () => {
    pinAlbum("al-1", 1);
    const { container } = renderPins();
    await waitFor(() => expect(container.querySelectorAll(".sidebar-pin")).toHaveLength(1));

    fireEvent.contextMenu(container.querySelector(".sidebar-pin") as Element);
    fireEvent.click(screen.getByRole("button", { name: "Unpin" }));

    await waitFor(() => expect(container.querySelector(".sidebar-pins")).toBeNull());
    expect((db.raw.prepare("SELECT COUNT(*) AS c FROM pinned_albums").get() as { c: number }).c).toBe(0);
  });
});
