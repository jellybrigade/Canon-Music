// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { AlbumTracksNotice } from "./AlbumTracksNotice";
import { useAlbumTracksNoticeStore } from "../store/albumTracksNotice";

beforeEach(() => {
  useAlbumTracksNoticeStore.setState({ notice: null });
});

describe("AlbumTracksNotice", () => {
  it("renders nothing while there is nothing to report", () => {
    const { container } = render(<AlbumTracksNotice abovePlayer={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows why an album click played nothing", () => {
    const { container } = render(<AlbumTracksNotice abovePlayer={false} />);
    act(() => useAlbumTracksNoticeStore.getState().report("Couldn't get the tracks for Blue Train: offline"));
    expect(container.querySelector(".normalizing-bar")?.textContent).toContain("Couldn't get the tracks for Blue Train: offline");
  });

  it("goes away when dismissed", () => {
    useAlbumTracksNoticeStore.getState().report("The server lists no tracks for Blue Train");
    const { container } = render(<AlbumTracksNotice abovePlayer={false} />);
    const dismiss = container.querySelector<HTMLButtonElement>(".normalizing-bar__dismiss");
    if (!dismiss) throw new Error("dismiss button missing");
    fireEvent.click(dismiss);
    expect(container.firstChild).toBeNull();
  });

  it("sits above the player bar while a track is loaded", () => {
    useAlbumTracksNoticeStore.getState().report("x");
    const { container } = render(<AlbumTracksNotice abovePlayer />);
    expect(container.querySelector(".normalizing-bar--above-player")).not.toBeNull();
  });
});
