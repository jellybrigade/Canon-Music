// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("../../sync/syncWatermark", () => ({ clearSyncWatermark: vi.fn() }));
vi.mock("../../sync/syncPrune", () => ({ purgeServerData: vi.fn() }));
vi.mock("../../../clients/navidrome", () => ({
  authenticate: vi.fn(),
  authenticateWithApiKey: vi.fn(),
  fetchAndStoreOpenSubsonicExtensions: vi.fn(),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticate } from "../../../clients/navidrome";
import { getDb } from "../../../db";
import type { ServerWithCredential } from "../../../hooks/useServer";
import { onInvoke, resetTauriMocks } from "../../../test/mocks/tauri";
import type { Server as ServerRow } from "../../../types/server";
import { ServerTab } from "./ServerTab";

const SERVER = {
  id: "srv",
  type: "navidrome",
  url: "https://music.example.com",
  alt_url: "http://192.168.1.5:4533",
  display_name: "Music",
  username: "user",
} as unknown as ServerRow;

const WITH_CRED = { server: SERVER, credential: { type: "password" } } as unknown as ServerWithCredential;
const ALTERNATE_FAILED = "Alternate URL didn't answer: Load failed";

async function openEditAndTest() {
  const user = userEvent.setup();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ServerTab
        server={SERVER}
        serverWithCredential={WITH_CRED}
        onRemoveServer={() => {}}
        searchQuery=""
        syncStatus="idle"
        runSync={() => true}
      />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.type(screen.getByPlaceholderText("Enter password to re-test"), "pw");
  await user.click(screen.getByRole("button", { name: "Test connection" }));
  await waitFor(() => expect(screen.getByText("Connection successful.")).toBeTruthy());
  return user;
}

beforeEach(() => {
  resetTauriMocks();
  onInvoke("set_credential", () => undefined);
  vi.mocked(getDb).mockResolvedValue({ execute: vi.fn(), select: vi.fn() } as never);
  vi.mocked(authenticate).mockImplementation(async (url) => {
    if (url === SERVER.alt_url) throw new Error("Load failed");
    return { type: "md5", token: "t", salt: "s" };
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ServerTab alternate URL test", () => {
  it("says the alternate didn't answer and still lets a working primary be saved", async () => {
    await openEditAndTest();

    expect(screen.getByText(ALTERNATE_FAILED)).toBeTruthy();
    expect(vi.mocked(authenticate).mock.calls.map(([url]) => url)).toEqual([SERVER.url, SERVER.alt_url]);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("drops the alternate's result once the alternate is edited", async () => {
    const user = await openEditAndTest();

    await user.type(screen.getByPlaceholderText("e.g. https://music.yourserver.com"), "0");

    expect(screen.queryByText(ALTERNATE_FAILED)).toBeNull();
    expect(screen.getByText("Connection successful.")).toBeTruthy();
  });
});
