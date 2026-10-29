// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../../test/mocks/tauri")).coreModule);
vi.mock("../../db", () => ({ getDb: vi.fn() }));
vi.mock("../../clients/boundedFetch", () => ({ boundedFetch: vi.fn(), boundedNativeFetch: vi.fn() }));
vi.mock("../../clients/coverArtArchive", () => ({ fetchCaaFrontCovers: vi.fn() }));
vi.mock("../../clients/fanart", () => ({ fetchFanartAlbumCovers: vi.fn(), getFanartApiKey: vi.fn() }));
vi.mock("../../clients/itunes", () => ({ fetchItunesAlbumCovers: vi.fn() }));
vi.mock("../../clients/musicbrainz", () => ({ lookupRelease: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { boundedFetch } from "../../clients/boundedFetch";
import { fetchCaaFrontCovers } from "../../clients/coverArtArchive";
import { getFanartApiKey } from "../../clients/fanart";
import { fetchItunesAlbumCovers } from "../../clients/itunes";
import { getDb } from "../../db";
import type { ServerWithCredential } from "../../hooks/useServer";
import { onInvoke, resetTauriMocks } from "../../test/mocks/tauri";
import { createMigratedTestDb, type FakeDatabase } from "../../test/sqlite";
import type { AlbumRow } from "../../types/library";
import { CoverPickerDialog } from "./CoverPickerDialog";

let db: FakeDatabase;
const album = {
  id: "srv:abc",
  server_id: "srv",
  name: "Album",
  artist: "Artist",
  artwork_url: "al-abc_ff",
} as AlbumRow;
const swc = {
  server: { id: "srv", url: "http://music.example", username: "alice" },
  credential: { type: "apikey", apiKey: "k" },
} as ServerWithCredential;

function renderDialog(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CoverPickerDialog album={album} serverWithCredential={swc} onClose={onClose} />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  resetTauriMocks();
  db.raw.exec(
    "INSERT INTO album_identity (album_id, mb_release_id, mb_release_group_id) VALUES ('srv:abc', 'rel-1', 'rg-1')",
  );
  vi.mocked(fetchCaaFrontCovers)
    .mockReset()
    .mockImplementation(async (kind) =>
      kind === "release"
        ? [
            {
              originalUrl: "https://caa/o.jpg",
              thumbUrl: "https://caa/250.jpg",
              fullUrl: "https://caa/1200.jpg",
              isApproved: true,
            },
          ]
        : [],
    );
  vi.mocked(getFanartApiKey).mockReset().mockResolvedValue(null);
  vi.mocked(fetchItunesAlbumCovers).mockReset().mockRejectedValue(new Error("iTunes returned 503"));
  vi.mocked(boundedFetch).mockReset().mockRejectedValue(new Error("offline"));
});

describe("CoverPickerDialog", () => {
  it("keeps the cover picked from the list and closes", async () => {
    onInvoke("save_album_cover_override", () => "image/jpeg");
    const onClose = vi.fn();
    renderDialog(onClose);

    fireEvent.click(await screen.findByRole("button", { name: /Cover Art Archive/ }));
    fireEvent.click(screen.getByRole("button", { name: "Use this cover" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenCalledWith("save_album_cover_override", {
      serverId: "srv",
      albumId: "srv:abc",
      revision: expect.any(Number),
      url: "https://caa/1200.jpg",
    });
    expect(db.raw.prepare("SELECT source, full_url FROM album_cover_overrides").all()).toEqual([
      { source: "caa-release", full_url: "https://caa/1200.jpg" },
    ]);
  });

  it("names a source that failed and one it skipped, beside the covers others found", async () => {
    renderDialog();

    expect(await screen.findByRole("button", { name: /Cover Art Archive/ })).toBeTruthy();
    expect(screen.getByText(/iTunes: couldn't search, iTunes returned 503/)).toBeTruthy();
    expect(screen.getByText(/fanart.tv: Add a fanart.tv key/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Use this cover" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("stays open and says why when the cover could not be kept", async () => {
    onInvoke("save_album_cover_override", () => {
      throw new Error("The host sent text/html, not an image");
    });
    const onClose = vi.fn();
    renderDialog(onClose);

    fireEvent.click(await screen.findByRole("button", { name: /Cover Art Archive/ }));
    fireEvent.click(screen.getByRole("button", { name: "Use this cover" }));

    expect((await screen.findByRole("alert")).textContent).toContain("not an image");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("goes back to the server's cover", async () => {
    db.raw.exec(
      "INSERT INTO album_cover_overrides (server_id, album_id, source, full_url, chosen_at) VALUES ('srv', 'srv:abc', 'caa-release', 'https://caa/1200.jpg', 1)",
    );
    const onClose = vi.fn();
    renderDialog(onClose);

    expect(await screen.findByText("In use")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use server cover" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenCalledWith("clear_album_cover_override", { serverId: "srv", albumId: "srv:abc" });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM album_cover_overrides").get()).toEqual({ n: 0 });
  });

  it("shows the current cover's size and the size of the one picked, measured from the images", async () => {
    renderDialog();
    loadPreview("Current", 1400, 1400);
    expect(previewCaption("Current")).toContain("1400 × 1400");

    fireEvent.click(await screen.findByRole("button", { name: /Cover Art Archive/ }));
    loadPreview("New", 1200, 1180);

    expect(previewCaption("New")).toContain("1200 × 1180");
    expect(previewCaption("Current")).toContain("1400 × 1400");
  });

  it("asks the server for the current cover unscaled, so its size is the real one", () => {
    renderDialog();
    expect(previewImage("Current").getAttribute("src")).toContain("size=0");
  });

  it("keeps the measured size with the cover it saves", async () => {
    onInvoke("save_album_cover_override", () => "image/jpeg");
    const onClose = vi.fn();
    renderDialog(onClose);

    fireEvent.click(await screen.findByRole("button", { name: /Cover Art Archive/ }));
    loadPreview("New", 1200, 1200);
    fireEvent.click(screen.getByRole("button", { name: "Use this cover" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(db.raw.prepare("SELECT width, height FROM album_cover_overrides").get()).toEqual({
      width: 1200,
      height: 1200,
    });
  });
});

function previewImage(label: string): HTMLImageElement {
  const figure = screen.getByText(label).closest("figure");
  const image = figure?.querySelector("img");
  if (!image) throw new Error(`no ${label} preview`);
  return image;
}

function previewCaption(label: string): string {
  return previewImage(label).closest("figure")?.textContent ?? "";
}

function loadPreview(label: string, width: number, height: number) {
  const image = previewImage(label);
  Object.defineProperty(image, "naturalWidth", { value: width, configurable: true });
  Object.defineProperty(image, "naturalHeight", { value: height, configurable: true });
  fireEvent.load(image);
}
