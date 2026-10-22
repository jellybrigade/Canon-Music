// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("../../../db", () => ({ getDb: vi.fn() }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../../db";
import { invoke, onInvoke, resetTauriMocks } from "../../../test/mocks/tauri";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { usePlayerStore } from "../../playback/store/player";
import { DiagnosticsTab } from "./DiagnosticsTab";

let db: FakeDatabase;

function seedQueuedScrobble(serverId: string) {
  db.raw
    .prepare(`INSERT INTO scrobble_queue (track_id, title, artist, timestamp) VALUES (?, 'Song', 'Artist', 0)`)
    .run(`${serverId}:t1`);
}

function renderTab(serverId: string | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DiagnosticsTab
        syncStatus="idle"
        syncError=""
        lastSyncedAt={null}
        searchQuery=""
        serverWithCredential={undefined}
        serverId={serverId}
      />
    </QueryClientProvider>,
  );
}

function scrobbleCountText(): string | undefined {
  const heading = Array.from(document.querySelectorAll(".settings-section-title")).find(
    (h) => h.textContent === "Scrobble queue",
  );
  return heading?.closest("section")?.querySelector(".settings-diag-value")?.textContent ?? undefined;
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetTauriMocks();
});

describe("DiagnosticsTab scrobble backlog", () => {
  it("reports the queue count from the plain server id while credentials are unavailable", async () => {
    seedQueuedScrobble("srv-a");
    renderTab("srv-a");
    await waitFor(() => expect(scrobbleCountText()).toBe("1"));
  });
});

describe("DiagnosticsTab settings export", () => {
  it("writes the preferences through the save dialog and says where they went", async () => {
    db.raw.prepare("INSERT INTO settings (key, value) VALUES ('player.gapless', 'false')").run();
    onInvoke("save_settings_backup", () => "/home/me/canon-settings.json");
    renderTab("srv-a");

    fireEvent.click(screen.getByRole("button", { name: "Export settings" }));

    await screen.findByText("Saved to /home/me/canon-settings.json");
    const exportCalls = invoke.mock.calls.filter(([cmd]) => cmd === "save_settings_backup");
    expect(exportCalls).toHaveLength(1);
    const args = exportCalls[0]?.[1] as { contents: string; fileName: string };
    expect(JSON.parse(args.contents)).toEqual({ "player.gapless": "false" });
    expect(args.fileName).toMatch(/^canon-settings-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it("reports a failed write", async () => {
    onInvoke("save_settings_backup", () => {
      throw new Error("Could not write /readonly/x.json: Permission denied");
    });
    renderTab("srv-a");

    fireEvent.click(screen.getByRole("button", { name: "Export settings" }));

    await screen.findByText("Export failed: Could not write /readonly/x.json: Permission denied");
  });

  it("says nothing when the dialog is cancelled", async () => {
    onInvoke("save_settings_backup", () => null);
    renderTab("srv-a");

    fireEvent.click(screen.getByRole("button", { name: "Export settings" }));

    await waitFor(() => expect(invoke.mock.calls.filter(([cmd]) => cmd === "save_settings_backup")).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Export settings" })).toBeTruthy();
    expect(screen.queryByText(/Saved to|Export failed/)).toBeNull();
  });
});

describe("DiagnosticsTab settings import", () => {
  // The window reloads right after, so handing settings to live playback first only disturbs it.
  it("writes the file and reloads without reapplying settings to playback", async () => {
    const reload = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", { value: { ...originalLocation, reload }, configurable: true });
    const loadSettings = vi.spyOn(usePlayerStore.getState(), "loadSettings");
    renderTab("srv-a");

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("no import input");
    fireEvent.change(input, {
      target: { files: [new File([JSON.stringify({ "player.gapless": "false" })], "backup.json")] },
    });

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(loadSettings).not.toHaveBeenCalled();
    const row = db.raw.prepare("SELECT value FROM settings WHERE key = 'player.gapless'").get() as { value: string };
    expect(row.value).toBe("false");
    Object.defineProperty(window, "location", { value: originalLocation, configurable: true });
  });
});
