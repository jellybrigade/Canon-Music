// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../clients/musicbrainz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../clients/musicbrainz")>()),
  searchReleaseGroups: vi.fn().mockResolvedValue([]),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { searchReleaseGroups } from "../../../clients/musicbrainz";
import { useAutoIdentifyAlbum } from "./useAutoIdentifyAlbum";

type Props = Parameters<typeof useAutoIdentifyAlbum>[0];

const ready: Props = {
  albumId: "srv:al-1",
  artist: "Some Artist",
  album: "Fresh Album",
  trackCount: 10,
  durationSeconds: 2400,
  taggedReleaseMbid: null,
  year: 2026,
  confirmedArtistMbid: null,
  mbAutoIdentify: true,
  existingIdentity: null,
};

function renderAutoIdentify(initialProps: Props) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  return renderHook((props: Props) => useAutoIdentifyAlbum(props), { initialProps, wrapper });
}

afterEach(() => {
  vi.mocked(searchReleaseGroups).mockClear();
});

describe("useAutoIdentifyAlbum", () => {
  it("waits for the album's tracks, the artist's known MBID and the files' tagged release before searching, then searches once", async () => {
    const { result, rerender } = renderAutoIdentify({
      ...ready,
      trackCount: 0,
      confirmedArtistMbid: undefined,
      existingIdentity: undefined,
    });

    rerender({ ...ready, trackCount: 0, confirmedArtistMbid: undefined });
    rerender({ ...ready, confirmedArtistMbid: undefined });
    rerender({ ...ready, trackCount: 0 });
    rerender({ ...ready, taggedReleaseMbid: undefined });
    expect(searchReleaseGroups).not.toHaveBeenCalled();

    rerender(ready);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(searchReleaseGroups).toHaveBeenCalledTimes(1);
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
});
