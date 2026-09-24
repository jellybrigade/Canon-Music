// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { TrackContextMenu } from "./TrackContextMenu";
import type { PlaylistRow } from "../../features/playlists/usePlaylists";

afterEach(cleanup);

const playlist: PlaylistRow = {
  id: "pl-1",
  server_id: "srv",
  name: "Road Trip",
  comment: null,
  track_count: 0,
  cover_art_url: null,
  custom_cover_data: null,
  is_smart: 0,
  rules_json: null,
};

function Harness({ onAddToPlaylist }: { onAddToPlaylist: (pl: PlaylistRow) => void }) {
  const [open, setOpen] = useState(true);
  const noop = () => {};
  return (
    <>
      <button className="reopen" onClick={() => setOpen(true)}>reopen</button>
      {open && (
        <TrackContextMenu
          x={10}
          y={10}
          isLoved={false}
          overflowGenres={[]}
          playlists={[playlist]}
          onClose={() => setOpen(false)}
          onPlayNow={noop}
          onPlayNext={noop}
          onAddToQueue={noop}
          onStartRadio={noop}
          onToggleLove={noop}
          onShowTags={noop}
          onAddToPlaylist={onAddToPlaylist}
        />
      )}
    </>
  );
}

function menuButtons(): string[] {
  return [...document.querySelectorAll(".context-menu button")].map((b) => b.textContent ?? "");
}

function clickMenuButton(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>(".context-menu button")].find(
    (b) => b.textContent?.startsWith(label),
  );
  if (!button) throw new Error(`no menu button "${label}"`);
  fireEvent.click(button);
}

describe("TrackContextMenu", () => {
  it("opens on the main list again after a track was added to a playlist", () => {
    const onAddToPlaylist = vi.fn();
    const { container } = render(<Harness onAddToPlaylist={onAddToPlaylist} />);

    clickMenuButton("Add to Playlist");
    clickMenuButton("Road Trip");
    expect(onAddToPlaylist).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".context-menu")).toBeNull();

    fireEvent.click(container.querySelector(".reopen")!);
    expect(menuButtons()).toContain("Play Now");
    expect(menuButtons()).not.toContain("Road Trip");
  });
});
