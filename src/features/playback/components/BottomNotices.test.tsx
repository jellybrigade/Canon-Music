// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("../../../db", () => ({
  getDb: vi.fn(() => Promise.resolve({ select: () => Promise.resolve([]), execute: () => Promise.resolve() })),
}));
vi.mock("../../../hooks/useSetting", () => ({
  useSetting: (_key: string, def: string) => [def, async () => {}, true],
}));
vi.mock("../../tags/hooks/useBackgroundNormalizer", () => ({ runEnrichment: vi.fn() }));

import { act, fireEvent, render } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAlbumTracksNoticeStore } from "../../../store/albumTracksNotice";
import { useTagsStore } from "../../tags/store/tags";
import { usePlayerStore } from "../store/player";
import type { CurrentTrack } from "../store/playerTypes";
import { BottomNotices } from "./BottomNotices";

const track: CurrentTrack = { id: "t", title: "Track", artist: null, duration: 100 };
const rows = () => Array.from(document.querySelectorAll(".bottom-notices > *"));
const reservedRows = () => document.documentElement.style.getPropertyValue("--bottom-notice-rows");

function showError(cause: "stale-track-id" | null = null) {
  act(() => usePlayerStore.setState({ error: { message: "The track never started", cause } }));
}

beforeEach(() => {
  usePlayerStore.setState({ currentTrack: track, error: null, elapsed: 0 });
  useTagsStore.setState({ pullProgress: null, enrichmentPending: null });
  useAlbumTracksNoticeStore.setState({ notice: null });
});

afterEach(() => {
  document.documentElement.style.removeProperty("--bottom-notice-rows");
});

describe("BottomNotices", () => {
  it("shows no rows and reserves no space while there is nothing to say", () => {
    render(<BottomNotices onOpenResync={() => {}} />);
    expect(rows()).toEqual([]);
    expect(reservedRows()).toBe("0");
  });

  it("shows a playback error with Retry and Skip", () => {
    render(<BottomNotices onOpenResync={() => {}} />);
    showError();
    const [row] = rows();
    expect(row?.getAttribute("role")).toBe("alert");
    expect(row?.textContent).toContain("The track never started");
    expect(row?.textContent).toContain("Retry");
    expect(row?.textContent).toContain("Skip");
    expect(row?.textContent).not.toContain("Resync library");
    expect(reservedRows()).toBe("1");
  });

  it("offers a resync only when the library's track ids went stale", () => {
    const onOpenResync = vi.fn();
    render(<BottomNotices onOpenResync={onOpenResync} />);
    showError("stale-track-id");
    const resync = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Resync library");
    if (!resync) throw new Error("resync button missing");
    fireEvent.click(resync);
    expect(onOpenResync).toHaveBeenCalledTimes(1);
  });

  it("hands Retry and Skip to the player", () => {
    const retryCurrent = vi.fn();
    const next = vi.fn(async () => {});
    usePlayerStore.setState({ retryCurrent, next, repeat: "repeat-all" });
    render(<BottomNotices onOpenResync={() => {}} />);
    showError();
    const button = (label: string) => {
      const found = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === label);
      if (!found) throw new Error(`${label} button missing`);
      return found;
    };
    fireEvent.click(button("Retry"));
    fireEvent.click(button("Skip"));
    expect(retryCurrent).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("shows no error row while no track is loaded", () => {
    usePlayerStore.setState({ currentTrack: null });
    render(<BottomNotices onOpenResync={() => {}} />);
    showError();
    expect(rows()).toEqual([]);
    expect(reservedRows()).toBe("0");
  });

  it("stacks metadata progress above the error and reserves both rows", () => {
    useTagsStore.setState({ pullProgress: { done: 12, total: 300 } });
    render(<BottomNotices onOpenResync={() => {}} />);
    showError();
    const [first, second] = rows();
    expect(rows()).toHaveLength(2);
    expect(first?.textContent).toContain("Fetching metadata");
    expect(second?.getAttribute("role")).toBe("alert");
    expect(reservedRows()).toBe("2");
  });

  it("keeps one info row, in the existing order of precedence", () => {
    useTagsStore.setState({ pullProgress: { done: 1, total: 2 }, enrichmentPending: 5 });
    render(<BottomNotices onOpenResync={() => {}} />);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain("Fetching metadata");

    act(() => useAlbumTracksNoticeStore.getState().report("Couldn't get the tracks for Blue Train"));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain("Blue Train");

    act(() => {
      useAlbumTracksNoticeStore.setState({ notice: null });
      useTagsStore.setState({ pullProgress: null });
    });
    expect(rows()[0]?.textContent).toContain("Metadata not fetched for 5 albums");
  });

  it("sits above the player bar only while a track is loaded", () => {
    useTagsStore.setState({ enrichmentPending: 5 });
    const { unmount } = render(<BottomNotices onOpenResync={() => {}} />);
    expect(document.querySelector(".bottom-notices--above-player")).not.toBeNull();
    unmount();
    usePlayerStore.setState({ currentTrack: null });
    render(<BottomNotices onOpenResync={() => {}} />);
    expect(document.querySelector(".bottom-notices")).not.toBeNull();
    expect(document.querySelector(".bottom-notices--above-player")).toBeNull();
  });

  it("releases its reserved space when it unmounts", () => {
    showError();
    const { unmount } = render(<BottomNotices onOpenResync={() => {}} />);
    expect(reservedRows()).toBe("1");
    unmount();
    expect(reservedRows()).toBe("0");
  });

  it("does not re-render on playback progress ticks", () => {
    showError();
    let commits = 0;
    render(
      <Profiler id="notices" onRender={() => commits++}>
        <BottomNotices onOpenResync={() => {}} />
      </Profiler>,
    );
    const afterMount = commits;
    for (let second = 1; second <= 5; second++) act(() => usePlayerStore.setState({ elapsed: second }));
    expect(commits).toBe(afterMount);
  });
});
