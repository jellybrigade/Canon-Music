// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("../../../hooks/useAlbumDisplayName", () => ({ useAlbumDisplayName: () => (name: string) => name }));
const { startRadio } = vi.hoisted(() => ({ startRadio: vi.fn(() => Promise.resolve()) }));
vi.mock("../../radio/hooks/useStartRadio", () => ({ useStartRadio: () => startRadio }));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { usePlayerStore } from "../store/player";
import type { CurrentTrack } from "../store/playerTypes";
import type { ServerWithCredential } from "../../../hooks/useServer";
import { UpNextList } from "./UpNextList";

const serverWithCredential = {
  server: { id: "srv-a", url: "http://a", username: "u" },
  credential: "c",
} as unknown as ServerWithCredential;

const withAlbum: CurrentTrack = {
  id: "srv-b:t1", title: "One", artist: "Artist B", duration: 60, album: "Album B", albumId: "srv-b:al1",
};
const bare: CurrentTrack = { id: "srv-a:t2", title: "Two", artist: null, duration: 60 };

function openMenu(title: string) {
  const row = Array.from(document.querySelectorAll(".now-playing-up-next-row"))
    .find((el) => el.textContent?.includes(title));
  if (!row) throw new Error(`no row ${title}`);
  fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
}

const menuLabels = () =>
  Array.from(document.querySelectorAll(".context-menu button")).map((el) => el.textContent);

function menuButton(label: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>(".context-menu button"))
    .find((el) => el.textContent === label);
  if (!button) throw new Error(`no menu item ${label}`);
  return button;
}

beforeEach(() => {
  startRadio.mockClear();
  usePlayerStore.setState({ queue: [withAlbum, bare], queueIndex: 0, isShuffled: false, shuffleOrder: [] });
});

afterEach(() => {
  cleanup();
});

describe("UpNextList context menu", () => {
  it("goes to the queued track's album with that track's server", () => {
    const onSelectAlbum = vi.fn();
    render(<UpNextList serverWithCredential={serverWithCredential} lovedTrackIds={new Set()} onSelectAlbum={onSelectAlbum} onSelectArtist={vi.fn()} />);
    openMenu("One");
    fireEvent.click(menuButton("Go to Album"));
    expect(onSelectAlbum).toHaveBeenCalledTimes(1);
    expect(onSelectAlbum).toHaveBeenCalledWith(expect.objectContaining({ id: "srv-b:al1", server_id: "srv-b", name: "Album B" }));
    expect(document.querySelector(".context-menu")).toBeNull();
  });

  it("goes to the queued track's artist", () => {
    const onSelectArtist = vi.fn();
    render(<UpNextList serverWithCredential={serverWithCredential} lovedTrackIds={new Set()} onSelectAlbum={vi.fn()} onSelectArtist={onSelectArtist} />);
    openMenu("One");
    fireEvent.click(menuButton("Go to Artist"));
    expect(onSelectArtist).toHaveBeenCalledTimes(1);
    expect(onSelectArtist).toHaveBeenCalledWith("Artist B");
  });

  it("offers neither item for a track with no album or artist", () => {
    render(<UpNextList serverWithCredential={serverWithCredential} lovedTrackIds={new Set()} onSelectAlbum={vi.fn()} onSelectArtist={vi.fn()} />);
    openMenu("Two");
    expect(menuLabels()).toContain("Remove");
    expect(menuLabels()).not.toContain("Go to Album");
    expect(menuLabels()).not.toContain("Go to Artist");
  });

  it("hides Go to Artist when no artist navigation is wired", () => {
    render(<UpNextList serverWithCredential={serverWithCredential} lovedTrackIds={new Set()} onSelectAlbum={vi.fn()} />);
    openMenu("One");
    expect(menuLabels()).toContain("Go to Album");
    expect(menuLabels()).not.toContain("Go to Artist");
  });

  it("starts radio through the replace-or-add choice, seeded from the queued track", async () => {
    const streamUrlFor = (t: CurrentTrack) => t.id;
    const playFromQueueIndex = vi.fn(() => Promise.resolve());
    const storeStartRadio = vi.fn();
    usePlayerStore.setState({ streamUrlFor, playFromQueueIndex, startRadio: storeStartRadio });
    render(<UpNextList serverWithCredential={serverWithCredential} lovedTrackIds={new Set()} onSelectAlbum={vi.fn()} />);
    openMenu("Two");
    const submenu = document.querySelector(".context-submenu");
    if (!submenu) throw new Error("no radio submenu");
    fireEvent.mouseEnter(submenu);
    fireEvent.click(menuButton("Curated"));
    await waitFor(() => expect(startRadio).toHaveBeenCalledTimes(1));
    expect(playFromQueueIndex).toHaveBeenCalledWith(1);
    expect(startRadio).toHaveBeenCalledWith({ tracks: [], seed: bare, streamUrlFor, mode: "curated" });
    expect(storeStartRadio).not.toHaveBeenCalled();
  });
});
