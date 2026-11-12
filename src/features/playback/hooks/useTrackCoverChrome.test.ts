// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
const extractAccent = vi.hoisted(() => vi.fn<(url: string) => Promise<string | null>>());
vi.mock("../../../lib/artColor", () => ({ extractAccent }));

import { initCoverServer, replaceCoverRevisions, setCoverRevision } from "../../../clients/navidromeUrls";
import { usePlayerStore } from "../store/player";
import type { CurrentTrack } from "../store/playerTypes";
import { useTrackAccent } from "./useTrackAccent";
import { useTrackFavicon } from "./useTrackFavicon";

const storedUrl = "cover://localhost/cover/srv-a/al-abc_ff?size=64";
const track: CurrentTrack = { id: "srv-a:t1", title: "Track", artist: "Artist", duration: 200, coverArtUrl: storedUrl };

beforeEach(() => {
  initCoverServer();
  extractAccent.mockReset();
  extractAccent.mockImplementation(async () => "rgb(1, 2, 3)");
});

afterEach(() => {
  cleanup();
  replaceCoverRevisions(null, new Map());
  usePlayerStore.setState({ currentTrack: null });
  document.head.innerHTML = "";
});

describe("useTrackAccent", () => {
  it("takes its color from a cover chosen while the track plays, once per choice", async () => {
    usePlayerStore.setState({ currentTrack: track });
    renderHook(() => useTrackAccent());
    await act(async () => {});
    expect(extractAccent.mock.calls).toEqual([[storedUrl]]);

    await act(async () => setCoverRevision("srv-a", "other", 5));
    await act(async () => setCoverRevision("srv-a", "abc", 1700));

    expect(extractAccent.mock.calls).toEqual([[storedUrl], [`${storedUrl}&v=1700`]]);
  });
});

describe("useTrackFavicon", () => {
  it("shows a cover chosen while the track plays", () => {
    const link = document.createElement("link");
    link.rel = "icon";
    document.head.append(link);
    usePlayerStore.setState({ currentTrack: track });
    renderHook(() => useTrackFavicon());
    expect(link.getAttribute("href")).toBe(storedUrl);

    act(() => setCoverRevision("srv-a", "abc", 1700));

    expect(link.getAttribute("href")).toBe(`${storedUrl}&v=1700`);
  });
});
