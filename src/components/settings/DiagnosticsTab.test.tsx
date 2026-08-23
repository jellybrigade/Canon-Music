// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../test/mocks/tauri")).eventModule);
vi.mock("../../db", () => ({ getDb: vi.fn() }));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DiagnosticsTab } from "./DiagnosticsTab";
import { getDb } from "../../db";
import { createMigratedTestDb, type FakeDatabase } from "../../test/sqlite";

let db: FakeDatabase;

function seedQueuedScrobble(serverId: string) {
  db.raw
    .prepare(
      `INSERT INTO scrobble_queue (track_id, title, artist, timestamp) VALUES (?, 'Song', 'Artist', 0)`
    )
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
    </QueryClientProvider>
  );
}

function scrobbleCountText(): string | undefined {
  const heading = Array.from(document.querySelectorAll(".settings-section-title")).find(
    (h) => h.textContent === "Scrobble queue"
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
});

describe("DiagnosticsTab scrobble backlog", () => {
  it("reports the queue count from the plain server id while credentials are unavailable", async () => {
    seedQueuedScrobble("srv-a");
    renderTab("srv-a");
    await waitFor(() => expect(scrobbleCountText()).toBe("1"));
  });
});
