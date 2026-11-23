// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../test/mocks/tauri")).eventModule);
vi.mock("../../db", () => ({ getDb: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getDb } from "../../db";
import type { ServerWithCredential } from "../../hooks/useServer";
import { useDismissibleNoticeStore } from "../../store/dismissibleNotice";
import { resetTauriMocks } from "../../test/mocks/tauri";
import { createMigratedTestDb } from "../../test/sqlite";
import { PlaylistDetail } from "./PlaylistDetail";
import { DEFAULT_SMART_FILTERS } from "./smartPlaylist";
import type { PlaylistRow } from "./usePlaylists";

const SWC: ServerWithCredential = {
  server: {
    id: "srv-a",
    type: "navidrome",
    url: "https://music.example",
    alt_url: null,
    display_name: "Home",
    username: "marcel",
    created_at: "2026-01-01T00:00:00Z",
  },
  credential: { type: "md5", token: "tok", salt: "salt" },
};

const SMART: PlaylistRow = {
  id: "srv-a:pl",
  server_id: "srv-a",
  name: "Mix",
  comment: null,
  track_count: 0,
  cover_art_url: null,
  custom_cover_data: null,
  is_smart: 1,
  rules_json: JSON.stringify({ ...DEFAULT_SMART_FILTERS, name: "Mix" }),
};

const refused = () => Promise.reject(new Error("server said no"));

function renderDetail(overrides: { onDelete?: () => Promise<void>; onRefreshSmart?: () => Promise<void> }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlaylistDetail
        playlist={SMART}
        serverWithCredential={SWC}
        onClose={() => {}}
        onDelete={overrides.onDelete ?? (async () => {})}
        onRename={async () => {}}
        onRefreshSmart={overrides.onRefreshSmart}
      />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  resetTauriMocks();
  const db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  useDismissibleNoticeStore.setState({ notice: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PlaylistDetail refused changes", () => {
  it("says why a smart playlist refresh failed", async () => {
    renderDetail({ onRefreshSmart: refused });
    fireEvent.click(screen.getByRole("button", { name: "Refresh smart playlist" }));
    await waitFor(() =>
      expect(useDismissibleNoticeStore.getState().notice?.message).toBe("Couldn't refresh Mix: server said no"),
    );
  });

  it("says why a delete failed", async () => {
    renderDetail({ onDelete: refused });
    fireEvent.click(screen.getByRole("button", { name: "Delete playlist" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() =>
      expect(useDismissibleNoticeStore.getState().notice?.message).toBe("Couldn't delete Mix: server said no"),
    );
  });

  it("reports nothing when the refresh succeeds", async () => {
    const onRefreshSmart = vi.fn(async () => {});
    renderDetail({ onRefreshSmart });
    fireEvent.click(screen.getByRole("button", { name: "Refresh smart playlist" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh smart playlist" })).toBeEnabled());
    expect(onRefreshSmart).toHaveBeenCalledTimes(1);
    expect(useDismissibleNoticeStore.getState().notice).toBeNull();
  });
});
