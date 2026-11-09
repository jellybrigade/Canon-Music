// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../db", () => ({
  getDb: () => Promise.resolve({ select: () => Promise.resolve([]), execute: () => Promise.resolve() }),
}));
vi.mock("../../../hooks/useAlbums", () => ({
  useAlbums: () => ({ data: undefined, isLoading: false, error: "database is locked" }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useAlbumBrowseSessionStore } from "../../../store/albumBrowseSessionStore";
import { TitleCleanupTab } from "./TitleCleanupTab";

afterEach(cleanup);

describe("TitleCleanupTab", () => {
  it("says the albums could not be read instead of showing zero matches, and reads again on retry", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TitleCleanupTab />
      </QueryClientProvider>,
    );
    const tickBefore = useAlbumBrowseSessionStore.getState().refreshTick;

    expect(screen.getByText("Couldn't read your albums, so no rule shows its matches")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(useAlbumBrowseSessionStore.getState().refreshTick).toBe(tickBefore + 1);
  });
});
