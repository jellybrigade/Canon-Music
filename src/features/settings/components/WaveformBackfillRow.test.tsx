// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("../../../db", () => ({ getDb: vi.fn() }));
vi.mock("../../playback/store/waveformBackfill", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../playback/store/waveformBackfill")>()),
  startWaveformBackfill: vi.fn(() => Promise.resolve()),
  stopWaveformBackfill: vi.fn(),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../../db";
import type { ServerWithCredential } from "../../../hooks/useServer";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import {
  startWaveformBackfill,
  stopWaveformBackfill,
  useWaveformBackfillStore,
} from "../../playback/store/waveformBackfill";
import { WaveformBackfillRow } from "./WaveformBackfillRow";

const swc = {
  server: { id: "srv", url: "http://music.test", username: "me" },
  credential: { type: "apikey", apiKey: "key" },
} as ServerWithCredential;

let db: FakeDatabase;

function seedTracks(ids: string[]) {
  db.raw
    .prepare("INSERT INTO servers (id, type, url, display_name, username) VALUES ('srv', 'navidrome', 'x', 'X', 'u')")
    .run();
  for (const id of ids) {
    db.raw
      .prepare("INSERT INTO tracks (id, server_id, server_type, title) VALUES (?, 'srv', 'navidrome', ?)")
      .run(id, id);
  }
}

function renderRow() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WaveformBackfillRow serverWithCredential={swc} />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
  useWaveformBackfillStore.setState({ progress: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WaveformBackfillRow", () => {
  it("counts the tracks without a waveform and starts extracting them", async () => {
    seedTracks(["srv:a", "srv:b"]);
    renderRow();
    expect(await screen.findByText("2 tracks without a waveform")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Extract all" }));
    expect(startWaveformBackfill).toHaveBeenCalledWith(swc);
  });

  it("says so when the tracks to extract could not be read, until the next try", async () => {
    seedTracks(["srv:a"]);
    vi.mocked(startWaveformBackfill).mockRejectedValueOnce(new Error("database is locked"));
    renderRow();
    await screen.findByText("1 track without a waveform");
    fireEvent.click(screen.getByRole("button", { name: "Extract all" }));
    expect(await screen.findByText("Couldn't start extracting: database is locked")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Extract all" }));
    await act(async () => {});
    expect(screen.queryByText(/Couldn't start extracting/)).toBeNull();
  });

  it("offers Stop while extracting", async () => {
    seedTracks(["srv:a"]);
    renderRow();
    act(() => useWaveformBackfillStore.setState({ progress: { done: 1, total: 4 } }));
    expect(screen.getByText("Extracting… 1 / 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(stopWaveformBackfill).toHaveBeenCalledTimes(1);
  });

  it("has nothing to start once every track has a waveform", async () => {
    renderRow();
    expect(await screen.findByText("Every track has a waveform")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Extract all" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
