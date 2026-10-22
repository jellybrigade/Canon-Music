// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("../../sync/syncPrune", () => ({ purgeServerData: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../../db";
import type { ServerWithCredential } from "../../../hooks/useServer";
import type { Server as ServerRow } from "../../../types/server";
import type { SyncOptions } from "../../sync/sync";
import { ServerTab } from "./ServerTab";

const SERVER = {
  id: "srv",
  type: "navidrome",
  url: "http://music.local",
  display_name: "Music",
  username: "user",
} as unknown as ServerRow;

const WITH_CRED = { server: SERVER, credential: { type: "password" } } as unknown as ServerWithCredential;

let runSync: ReturnType<typeof vi.fn<(s: ServerWithCredential, options?: SyncOptions) => boolean>>;

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
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  runSync = vi.fn<(s: ServerWithCredential, options?: SyncOptions) => boolean>(() => true);
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

    expect(runSync).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Resync" })).toBeTruthy();
  });

  it("starts a forced sync once confirmed", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("button", { name: "Resync library" }));
    await user.click(screen.getByRole("button", { name: "Resync" }));

    // The flag, not the cleared watermark, is what forces the pass: a deployment that
    // restricts the scan status to admins gives the sync nothing to compare against.
    expect(runSync).toHaveBeenCalledTimes(1);
    expect(runSync).toHaveBeenCalledWith(WITH_CRED, { forceTrackPass: true });
    expect(screen.getByRole("button", { name: "Resync library" })).toBeTruthy();
  });

  it("backs out without touching anything", async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole("button", { name: "Resync library" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Resync library" })).toBeTruthy();
    expect(runSync).not.toHaveBeenCalled();
  });

  it("cannot be started while a sync is already running", () => {
    renderTab({ syncStatus: "syncing" });

    expect(screen.getByRole("button", { name: "Resync library" }).hasAttribute("disabled")).toBe(true);
  });

  it("is not offered without a credential to sync with", () => {
    renderTab({ withCredential: false });

    expect(screen.queryByRole("button", { name: "Resync library" })).toBeNull();
  });

  it("says a sync that began while confirming kept the resync from starting", async () => {
    const user = userEvent.setup();
    runSync.mockReturnValue(false);
    renderTab();

    await user.click(screen.getByRole("button", { name: "Resync library" }));
    await user.click(screen.getByRole("button", { name: "Resync" }));

    expect(screen.getByText(/a sync is already running/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resync" })).toBeTruthy();
  });
});
