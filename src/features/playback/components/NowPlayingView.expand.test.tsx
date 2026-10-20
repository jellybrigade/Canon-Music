// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("../../../hooks/useAlbumDisplayName", () => ({ useAlbumDisplayName: () => (name: string) => name }));
vi.mock("../../../hooks/useLoved", () => ({
  useLoved: () => ({ lovedTrackIds: new Set(), toggleTrackLove: vi.fn() }),
}));
vi.mock("../../../hooks/useSetting", () => ({ useBoolSetting: () => [false, vi.fn()] }));
vi.mock("../../../components/ArtBackdrop", () => ({ ArtBackdrop: () => null }));
vi.mock("../../../components/AlbumArt", () => ({ AlbumArt: () => <img alt="" /> }));
vi.mock("../hooks/useLyrics", () => ({
  useLyrics: () => ({
    plain: null,
    synced: null,
    loading: false,
    refresh: vi.fn(),
    offsetMs: 0,
    setOffsetMs: vi.fn(),
  }),
}));
vi.mock("../hooks/useNowPlayingArtist", () => ({
  useNowPlayingAlbums: () => ({ data: [], isPending: false }),
  useNowPlayingTopTracks: () => ({ data: [], isPending: false }),
  useSuggestedTracks: () => ({ data: [] }),
}));
vi.mock("./UpNextList", () => ({ UpNextList: () => <div data-panel="up-next" /> }));
vi.mock("./NowPlayingAbout", () => ({ NowPlayingAbout: () => <div data-panel="about" /> }));
vi.mock("./LyricsTabPanel", () => ({ LyricsTabPanel: () => <div data-panel="lyrics" /> }));
vi.mock("./NowPlayingControls", () => ({ NowPlayingControls: () => null }));
vi.mock("./NowPlayingProgress", () => ({ NowPlayingProgress: () => null }));

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerWithCredential } from "../../../hooks/useServer";
import { ContextMenu } from "../../../ui/ContextMenu";
import { __resetModalRegistry } from "../../../ui/useModalChrome";
import { usePlayerStore } from "../store/player";
import type { CurrentTrack } from "../store/playerTypes";
import { NowPlayingView } from "./NowPlayingView";

const serverWithCredential = {
  server: { id: "srv-a", url: "http://a", username: "u" },
  credential: "c",
} as unknown as ServerWithCredential;

const track: CurrentTrack = { id: "srv-a:t1", title: "One", artist: "Artist", duration: 60 };

function renderView() {
  return render(
    <NowPlayingView
      serverWithCredential={serverWithCredential}
      onSelectAlbum={vi.fn()}
      onStartRadio={vi.fn()}
      onOpenResync={vi.fn()}
    />,
  );
}

const view = () => document.querySelector(".now-playing-view");
const isExpanded = () => view()?.classList.contains("now-playing-view--expanded") ?? false;
const activePanel = () => document.querySelector("[data-panel]")?.getAttribute("data-panel");

function launcherButton(label: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>(".now-playing-launcher button")).find(
    (el) => el.textContent === label,
  );
  if (!button) throw new Error(`no launcher button ${label}`);
  return button;
}

beforeEach(() => {
  __resetModalRegistry();
  usePlayerStore.setState({ currentTrack: track, queue: [track], queueIndex: 0, isPlaying: false, error: null });
});

afterEach(() => {
  cleanup();
});

describe("NowPlayingView narrow expand", () => {
  it("starts collapsed with the three tab buttons", () => {
    renderView();
    expect(isExpanded()).toBe(false);
    expect(Array.from(document.querySelectorAll(".now-playing-launcher button")).map((b) => b.textContent)).toEqual([
      "Up Next",
      "About",
      "Lyrics",
    ]);
  });

  it("expands onto the tab that was clicked", () => {
    renderView();
    fireEvent.click(launcherButton("Lyrics"));
    expect(isExpanded()).toBe(true);
    expect(activePanel()).toBe("lyrics");
    expect(document.querySelector(".now-playing-tab-btn--active")?.textContent).toBe("Lyrics");
  });

  it("collapses from the small cover", () => {
    renderView();
    fireEvent.click(launcherButton("About"));
    const mini = document.querySelector<HTMLButtonElement>(".now-playing-mini");
    if (!mini) throw new Error("no mini cover");
    expect(mini.textContent).toContain("One");
    fireEvent.click(mini);
    expect(isExpanded()).toBe(false);
  });

  it("collapses from the close button", () => {
    renderView();
    fireEvent.click(launcherButton("About"));
    const close = document.querySelector<HTMLButtonElement>(".now-playing-collapse-btn");
    if (!close) throw new Error("no close button");
    fireEvent.click(close);
    expect(isExpanded()).toBe(false);
  });

  it("collapses on Escape, but not while typing", () => {
    renderView();
    fireEvent.click(launcherButton("Up Next"));
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(isExpanded()).toBe(true);
    input.remove();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(isExpanded()).toBe(false);
  });

  it("leaves Escape to a modal painted above", async () => {
    const { useModalChrome } = await import("../../../ui/useModalChrome");
    function FakeModal() {
      useModalChrome(() => {});
      return null;
    }
    const { rerender } = renderView();
    fireEvent.click(launcherButton("Up Next"));
    rerender(
      <>
        <NowPlayingView
          serverWithCredential={serverWithCredential}
          onSelectAlbum={vi.fn()}
          onStartRadio={vi.fn()}
          onOpenResync={vi.fn()}
        />
        <FakeModal />
      </>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(isExpanded()).toBe(true);
  });

  it("disarms its Escape listener once collapsed", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    renderView();
    const keydownAdds = () => add.mock.calls.filter(([type]) => type === "keydown").length;
    const keydownRemoves = () => remove.mock.calls.filter(([type]) => type === "keydown").length;
    expect(keydownAdds()).toBe(0);
    fireEvent.click(launcherButton("Up Next"));
    expect(keydownAdds()).toBe(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(keydownRemoves()).toBe(1);
    add.mockRestore();
    remove.mockRestore();
  });

  it("leaves Escape to a context menu open above", () => {
    const onCloseMenu = vi.fn();
    const { rerender } = renderView();
    fireEvent.click(launcherButton("About"));
    rerender(
      <>
        <NowPlayingView
          serverWithCredential={serverWithCredential}
          onSelectAlbum={vi.fn()}
          onStartRadio={vi.fn()}
          onOpenResync={vi.fn()}
        />
        <ContextMenu x={0} y={0} onClose={onCloseMenu}>
          <button type="button">Item</button>
        </ContextMenu>
      </>,
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onCloseMenu).toHaveBeenCalledTimes(1);
    expect(isExpanded()).toBe(true);
  });

  it("collapses when the window resizes, since the layout may no longer be narrow", () => {
    renderView();
    fireEvent.click(launcherButton("Lyrics"));
    fireEvent(window, new Event("resize"));
    expect(isExpanded()).toBe(false);
  });

  it("keeps play and pause in reach while a tab is expanded", () => {
    renderView();
    fireEvent.click(launcherButton("Lyrics"));
    expect(document.querySelector('.now-playing-mini-bar button[aria-label="Play"]')).not.toBeNull();
  });

  it("shows a playback error while a tab is expanded", () => {
    usePlayerStore.setState({ error: { message: "The track never started playing", cause: null } });
    renderView();
    fireEvent.click(launcherButton("Lyrics"));
    expect(document.querySelector(".now-playing-mini-bar [role='alert']")?.textContent).toContain(
      "The track never started playing",
    );
  });
});
