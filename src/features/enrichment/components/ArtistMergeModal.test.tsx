// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
const artistsRead = vi.fn();
vi.mock("../../../hooks/useArtists", () => ({ useArtists: () => artistsRead() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useArtistBrowseSessionStore } from "../../../store/artistBrowseSessionStore";
import { onInvoke, resetTauriMocks } from "../../../test/mocks/tauri";
import { ArtistMergeModal } from "./ArtistMergeModal";

function mount(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ArtistMergeModal aliasArtistName="Kanye West" onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

beforeEach(() => {
  resetTauriMocks();
  artistsRead.mockReturnValue({ data: [{ name: "Ye", album_count: 3 }], isLoading: false, error: null });
});
afterEach(cleanup);

describe("ArtistMergeModal", () => {
  it("stays open and says why when the merge fails", async () => {
    onInvoke("merge_artist", () => {
      throw new Error("database is locked");
    });
    const onClose = mount();

    fireEvent.click(screen.getByRole("button", { name: /Ye/ }));
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));

    await waitFor(() => expect(screen.getByText(/database is locked/)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says the artists could not be read instead of that none match", async () => {
    artistsRead.mockReturnValue({ data: undefined, isLoading: false, error: "database is locked" });
    mount();
    const tickBefore = useArtistBrowseSessionStore.getState().refreshTick;

    expect(screen.getByText("Couldn't load your artists")).toBeInTheDocument();
    expect(screen.queryByText("No artists match.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    // The artist refresh is debounced, so the new read lands after it settles.
    await waitFor(() => expect(useArtistBrowseSessionStore.getState().refreshTick).toBe(tickBefore + 1));
  });
});
