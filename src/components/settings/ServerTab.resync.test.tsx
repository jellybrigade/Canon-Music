// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../test/mocks/tauri")).eventModule);
vi.mock("../../db", () => ({ getDb: vi.fn() }));
vi.mock("../../lib/sync", () => ({ clearSyncWatermark: vi.fn(), purgeServerData: vi.fn() }));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ServerTab } from "./ServerTab";
import { getDb } from "../../db";
import { clearSyncWatermark } from "../../lib/sync";
import type { ServerWithCredential } from "../../hooks/useServer";
import type { Server as ServerRow } from "../../types/server";

const SERVER = {
  id: "srv",
  type: "navidrome",
  url: "http://music.local",
  display_name: "Music",
  username: "user",
} as unknown as ServerRow;

const WITH_CRED = { server: SERVER, credential: { type: "password" } } as unknown as ServerWithCredential;

let runSync: ReturnType<typeof vi.fn<(s: ServerWithCredential) => boolean>>;

function renderTab(overrides: { syncStatus?: "idle" | "syncing"; withCredential?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ServerTab
        server={SERVER}
        serverWithCredential={overrides.withCredential === false ? undefined : WITH_CRED}
        onRemoveServer={() => {}}
        searchQuery=""
        syncStatus={overrides.syncStatus ?? "idle"}
        runSync={runSync}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  runSync = vi.fn<(s: ServerWithCredential) => boolean>(() => true);
  vi.mocked(clearSyncWatermark).mockReset();
  vi.mocked(clearSyncWatermark).mockResolvedValue(undefined);
  vi.mocked(getDb).mockResolvedValue({ execute: vi.fn(), select: vi.fn() } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ServerTab resync", () => {
  it("asks before spending a full pass, and does nothing until confirmed", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("button", { name: "Resync library" }));

    expect(clearSyncWatermark).not.toHaveBeenCalled();
    expect(runSync).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Resync" })).toBeTruthy();
  });

  it("forgets the watermark and starts a sync once confirmed", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("button", { name: "Resync library" }));
    await user.click(screen.getByRole("button", { name: "Resync" }));

    await waitFor(() => expect(runSync).toHaveBeenCalledWith(WITH_CRED));
    expect(clearSyncWatermark).toHaveBeenCalledTimes(1);
    // The watermark has to be gone before the sync reads it, or the pass it is asking for is
    // the one the skip would have made anyway.
    expect(vi.mocked(clearSyncWatermark).mock.invocationCallOrder[0]!).toBeLessThan(
      runSync.mock.invocationCallOrder[0]!
    );
  });

  it("backs out without touching anything", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("button", { name: "Resync library" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Resync library" })).toBeTruthy();
    expect(clearSyncWatermark).not.toHaveBeenCalled();
  });

  it("cannot be started while a sync is already running", () => {
    renderTab({ syncStatus: "syncing" });

    expect(screen.getByRole("button", { name: "Resync library" }).hasAttribute("disabled")).toBe(true);
  });

  it("is not offered without a credential to sync with", () => {
    renderTab({ withCredential: false });

    expect(screen.queryByRole("button", { name: "Resync library" })).toBeNull();
  });

  it("says why the resync failed rather than looking like it worked", async () => {
    const user = userEvent.setup();
    vi.mocked(clearSyncWatermark).mockRejectedValue(new Error("db locked"));
    renderTab();

    await user.click(screen.getByRole("button", { name: "Resync library" }));
    await user.click(screen.getByRole("button", { name: "Resync" }));

    await waitFor(() => expect(screen.getByText(/db locked/)).toBeTruthy());
    expect(runSync).not.toHaveBeenCalled();
  });
});
