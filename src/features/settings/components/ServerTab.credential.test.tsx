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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ServerTab } from "./ServerTab";
import { getDb } from "../../../db";
import { authenticate } from "../../../clients/navidrome";
import { onInvoke, resetTauriMocks } from "../../../test/mocks/tauri";
import {
  isCredentialRejected,
  noteEnvelope,
  resetCredentialRejections,
} from "../../../lib/credentialRejections";
import type { ServerWithCredential } from "../../../hooks/useServer";
import type { Server as ServerRow } from "../../../types/server";

const SERVER = {
  id: "srv",
  type: "navidrome",
  url: "http://music.local",
  display_name: "Music",
  username: "user",
} as unknown as ServerRow;

const WITH_CRED = { server: SERVER, credential: { type: "password" } } as unknown as ServerWithCredential;

const REFUSED = /refused the saved password/;

function refuse() {
  noteEnvelope(SERVER.url, { status: "failed", error: { code: 40 } });
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ServerTab
        server={SERVER}
        serverWithCredential={WITH_CRED}
        onRemoveServer={() => {}}
        searchQuery=""
        syncStatus="idle"
        runSync={() => true}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  resetTauriMocks();
  onInvoke("set_credential", () => undefined);
  vi.mocked(getDb).mockResolvedValue({ execute: vi.fn(), select: vi.fn() } as never);
});

afterEach(() => {
  cleanup();
  resetCredentialRejections();
  vi.restoreAllMocks();
});

describe("ServerTab refused credential", () => {
  it("reads as connected while the server accepts the saved credential", () => {
    renderTab();

    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.queryByText(REFUSED)).toBeNull();
  });

  it("says the server refused the saved password and offers to reconnect", () => {
    refuse();
    renderTab();

    expect(screen.getByText(REFUSED)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("updates an open card when a request is refused", () => {
    renderTab();

    act(() => refuse());

    expect(screen.getByText(REFUSED)).toBeTruthy();
  });

  it("clears once a working password is saved", async () => {
    const user = userEvent.setup();
    vi.mocked(authenticate).mockResolvedValue({ type: "md5", token: "t", salt: "s" } as never);
    refuse();
    renderTab();

    await user.click(screen.getByRole("button", { name: "Reconnect" }));
    await user.type(screen.getByPlaceholderText("Enter password to re-test"), "new-password");
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(screen.getByText("Connection successful.")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy());
    expect(isCredentialRejected(SERVER.url)).toBe(false);
    expect(screen.queryByText(REFUSED)).toBeNull();
  });
});
