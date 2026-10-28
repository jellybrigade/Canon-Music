// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../../../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../../../test/mocks/tauri")).eventModule);
vi.mock("../../../db", () => ({ getDb: vi.fn() }));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../../db";
import type { ServerWithCredential } from "../../../hooks/useServer";
import { invoke, onInvoke, resetTauriMocks } from "../../../test/mocks/tauri";
import { createMigratedTestDb, type FakeDatabase } from "../../../test/sqlite";
import { usePlayerStore } from "./player";
import { waveformInFlight } from "./playerRuntime";
import {
  getMissingWaveformCount,
  startWaveformBackfill,
  stopWaveformBackfill,
  useWaveformBackfillStore,
} from "./waveformBackfill";

const swc = {
  server: { id: "srv", url: "http://music.test", username: "me" },
  credential: { type: "apikey", apiKey: "key" },
} as ServerWithCredential;

let db: FakeDatabase;

async function seedTracks(serverId: string, ids: string[]) {
  db.raw
    .prepare(
      "INSERT OR IGNORE INTO servers (id, type, url, display_name, username) VALUES (?, 'navidrome', 'http://x', 'X', 'u')",
    )
    .run(serverId);
  for (const id of ids) {
    db.raw
      .prepare("INSERT INTO tracks (id, server_id, server_type, title, duration) VALUES (?, ?, 'navidrome', ?, 120)")
      .run(id, serverId, id);
  }
}

function extractionCalls(): string[] {
  return invoke.mock.calls
    .filter((c) => c[0] === "audio_extract_waveform")
    .map((c) => (c[1] as { trackId: string }).trackId);
}

/** Holds every extraction open until the test settles it, like a slow download. */
function holdExtractions() {
  const pending = new Map<string, { resolve: () => void; reject: (e: unknown) => void }>();
  onInvoke("audio_extract_waveform", (args) => {
    const { trackId } = args as { trackId: string };
    return new Promise<void>((resolve, reject) => pending.set(trackId, { resolve, reject }));
  });
  onInvoke("audio_stop_waveform_batch", (args) => {
    const { keepTrackId } = args as { keepTrackId: string | null };
    for (const [id, extraction] of pending) if (id !== keepTrackId) extraction.reject("cancelled");
  });
  return pending;
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(async () => {
  resetTauriMocks();
  waveformInFlight.clear();
  db = await createMigratedTestDb();
  (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);
  usePlayerStore.setState({ currentTrack: null, isPlaying: false, playStartedAt: 0 });
});

afterEach(async () => {
  stopWaveformBackfill();
  await settle();
});

describe("waveform backfill", () => {
  it("extracts only this server's tracks that have no stored waveform", async () => {
    await seedTracks("srv", ["srv:a", "srv:b", "srv:c"]);
    await seedTracks("other", ["other:a"]);
    db.raw.prepare("INSERT INTO waveform_cache (track_id, peaks_json, created_at) VALUES ('srv:b', '[]', 0)").run();

    await startWaveformBackfill(swc);

    expect(extractionCalls().sort()).toEqual(["srv:a", "srv:c"]);
    const url = new URL((invoke.mock.calls.find((c) => c[0] === "audio_extract_waveform")![1] as { url: string }).url);
    expect(url.searchParams.get("maxBitRate")).toBe("32");
    expect(url.searchParams.get("format")).toBe("mp3");
    expect(useWaveformBackfillStore.getState().progress).toBeNull();
  });

  it("counts the tracks still missing a waveform for one server", async () => {
    await seedTracks("srv", ["srv:a", "srv:b"]);
    await seedTracks("other", ["other:a"]);
    db.raw.prepare("INSERT INTO waveform_cache (track_id, peaks_json, created_at) VALUES ('srv:b', '[]', 0)").run();
    expect(await getMissingWaveformCount("srv")).toBe(1);
  });

  it("leaves a track already being extracted to that extraction", async () => {
    await seedTracks("srv", ["srv:a", "srv:b"]);
    waveformInFlight.add("srv:a");
    await startWaveformBackfill(swc);
    expect(extractionCalls()).toEqual(["srv:b"]);
  });

  it("runs two extractions at a time and reports progress", async () => {
    await seedTracks("srv", ["srv:a", "srv:b", "srv:c"]);
    const pending = holdExtractions();
    const run = startWaveformBackfill(swc);
    await settle();

    expect(extractionCalls()).toHaveLength(2);
    expect(useWaveformBackfillStore.getState().progress).toEqual({ done: 0, total: 3 });

    pending.get(extractionCalls()[0]!)!.resolve();
    await settle();
    expect(extractionCalls()).toHaveLength(3);
    expect(useWaveformBackfillStore.getState().progress).toEqual({ done: 1, total: 3 });

    for (const { resolve } of pending.values()) resolve();
    await run;
    expect(useWaveformBackfillStore.getState().progress).toBeNull();
  });

  it("stops when a track starts playing, cancelling every extraction but the playing track's", async () => {
    await seedTracks("srv", ["srv:a", "srv:b", "srv:c"]);
    const pending = holdExtractions();
    const run = startWaveformBackfill(swc);
    await settle();
    const [first, second] = extractionCalls();

    usePlayerStore.setState({
      currentTrack: { id: first!, title: "A", artist: null, duration: 120 },
      playStartedAt: 1,
    });
    expect(useWaveformBackfillStore.getState().progress).toBeNull();
    const extractCall = invoke.mock.calls.find((c) => c[0] === "audio_extract_waveform");
    const stopCall = invoke.mock.calls.find((c) => c[0] === "audio_stop_waveform_batch");
    const batch = (extractCall?.[1] as { batch: string } | undefined)?.batch;
    expect(stopCall?.[1]).toEqual({ batch, keepTrackId: first });

    await settle();
    expect(waveformInFlight.has(first!)).toBe(true);
    expect(waveformInFlight.has(second!)).toBe(false);

    pending.get(first!)!.resolve();
    await run;
    expect(extractionCalls()).toHaveLength(2);
  });

  it("stops when paused playback resumes", async () => {
    await seedTracks("srv", ["srv:a", "srv:b", "srv:c"]);
    holdExtractions();
    const run = startWaveformBackfill(swc);
    await settle();

    usePlayerStore.setState({ isPlaying: true });
    expect(useWaveformBackfillStore.getState().progress).toBeNull();
    await run;
    expect(extractionCalls()).toHaveLength(2);
  });

  it("can be started again while a stopped run is still winding down", async () => {
    await seedTracks("srv", ["srv:a", "srv:b", "srv:c"]);
    const firstPending = holdExtractions();
    const first = startWaveformBackfill(swc);
    await settle();
    // Cancels nothing, so the first run's extractions outlive its stop.
    onInvoke("audio_stop_waveform_batch", () => {});
    stopWaveformBackfill();

    await seedTracks("srv", ["srv:d"]);
    const secondPending = holdExtractions();
    const second = startWaveformBackfill(swc);
    await settle();
    expect(extractionCalls()).toEqual([...firstPending.keys(), "srv:c", "srv:d"]);

    for (const { resolve } of firstPending.values()) resolve();
    await first;
    expect(useWaveformBackfillStore.getState().progress).toEqual({ done: 2, total: 4 });

    for (const { resolve } of secondPending.values()) resolve();
    await second;
    expect(useWaveformBackfillStore.getState().progress).toBeNull();
  });
});
