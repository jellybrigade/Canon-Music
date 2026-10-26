// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("../../../hooks/useArtists", () => ({
  useArtists: () => ({ data: [{ name: "Ye", album_count: 3 }] }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => resetTauriMocks());
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
});
