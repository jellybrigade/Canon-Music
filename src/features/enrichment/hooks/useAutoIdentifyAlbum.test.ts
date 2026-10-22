// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../clients/musicbrainz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../clients/musicbrainz")>()),
  searchReleaseGroups: vi.fn().mockResolvedValue([]),
  lookupRelease: vi.fn(),
  lookupReleaseGroup: vi.fn(),
}));

const taggedReleaseRead = vi.fn<() => Promise<{ mb_release_id: string | null }[]>>();
vi.mock("../../../db", () => ({ getDb: async () => ({ select: taggedReleaseRead }) }));

const autoIdentifySetting = vi.hoisted(() => ({ value: true, isLoaded: true }));
vi.mock("../../../hooks/useSetting", () => ({
  useBoolSetting: () => [autoIdentifySetting.value, async () => {}, autoIdentifySetting.isLoaded],
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { lookupRelease, lookupReleaseGroup, searchReleaseGroups } from "../../../clients/musicbrainz";
import { useAutoIdentifyAlbum } from "./useAutoIdentifyAlbum";

type Props = Parameters<typeof useAutoIdentifyAlbum>[0];

const ready: Props = {
  albumId: "srv:al-1",
  serverId: "srv",
  artist: "Some Artist",
  album: "Fresh Album",
  trackCount: 10,
  durationSeconds: 2400,
  year: 2026,
  confirmedArtistMbid: null,
  existingIdentity: null,
};

function renderAutoIdentify(initialProps: Props) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  return renderHook((props: Props) => useAutoIdentifyAlbum(props), { initialProps, wrapper });
}

beforeEach(() => {
  autoIdentifySetting.value = true;
  autoIdentifySetting.isLoaded = true;
  taggedReleaseRead.mockResolvedValue([{ mb_release_id: null }]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useAutoIdentifyAlbum", () => {
  it("waits for the album's tracks and the artist's known MBID before searching, then searches once", async () => {
    const { result, rerender } = renderAutoIdentify({
      ...ready,
      trackCount: 0,
      confirmedArtistMbid: undefined,
      existingIdentity: undefined,
    });

    rerender({ ...ready, trackCount: 0, confirmedArtistMbid: undefined });
    rerender({ ...ready, confirmedArtistMbid: undefined });
    rerender({ ...ready, trackCount: 0 });
    expect(searchReleaseGroups).not.toHaveBeenCalled();

    rerender(ready);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(searchReleaseGroups).toHaveBeenCalledTimes(1);
  });

  it("waits for the auto-identify setting to be read back before searching", async () => {
    autoIdentifySetting.isLoaded = false;
    const { result, rerender } = renderAutoIdentify(ready);
    expect(searchReleaseGroups).not.toHaveBeenCalled();

    autoIdentifySetting.isLoaded = true;
    rerender(ready);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(searchReleaseGroups).toHaveBeenCalledTimes(1);
  });

  it("never searches with auto-identify turned off", () => {
    autoIdentifySetting.value = false;
    renderAutoIdentify(ready);

    expect(searchReleaseGroups).not.toHaveBeenCalled();
  });

  it("retries an automatic lookup that failed long ago", async () => {
    const { result } = renderAutoIdentify({
      ...ready,
      existingIdentity: { mb_release_group_id: null, confirmed_at: null, looked_up_at: 0 },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(searchReleaseGroups).toHaveBeenCalledTimes(1);
  });

  it("leaves a fresh failed lookup alone", () => {
    renderAutoIdentify({
      ...ready,
      existingIdentity: { mb_release_group_id: null, confirmed_at: null, looked_up_at: Math.floor(Date.now() / 1000) },
    });

    expect(searchReleaseGroups).not.toHaveBeenCalled();
  });

  it("takes the release the files are tagged with, read when the lookup runs, over a search", async () => {
    taggedReleaseRead.mockResolvedValue([{ mb_release_id: "tagged-release" }]);
    vi.mocked(lookupRelease).mockResolvedValue({
      id: "tagged-release",
      releaseGroupId: "tagged-group",
      title: "Fresh Album",
      date: null,
      country: null,
      label: null,
      catalogNumber: null,
      barcode: null,
      genres: [],
      tags: [],
      trackCount: 10,
    });
    vi.mocked(lookupReleaseGroup).mockResolvedValue({
      id: "tagged-group",
      title: "Fresh Album",
      firstReleaseDate: null,
      primaryType: "Album",
      artistName: "Some Artist",
      artistMbid: null,
      genres: [],
      tags: [],
      releases: [],
    });
    const { result } = renderAutoIdentify(ready);

    await waitFor(() => expect(result.current.data?.decision).toBe("auto_confirmed"));
    expect(taggedReleaseRead).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("server_id = ?"), [
      "srv:al-1",
      "srv",
    ]);
    expect(searchReleaseGroups).not.toHaveBeenCalled();
  });

  it("reports a failed read of the tagged release instead of searching by name", async () => {
    taggedReleaseRead.mockRejectedValue(new Error("database is locked"));
    const { result } = renderAutoIdentify(ready);

    await waitFor(() => expect(result.current.data?.decision).toBe("error"));
    expect(searchReleaseGroups).not.toHaveBeenCalled();
  });
});
