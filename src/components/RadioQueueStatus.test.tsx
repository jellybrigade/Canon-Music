// @vitest-environment jsdom
vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);
vi.mock("../db", () => ({ getDb: vi.fn(() => Promise.resolve({ select: () => Promise.resolve([]), execute: () => Promise.resolve() })) }));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { usePlayerStore, type CurrentTrack } from "../store/player";
import { RadioQueueStatus } from "./RadioQueueStatus";

const seed: CurrentTrack = { id: "s", title: "Seed", artist: null, duration: 100 };
const status = () => document.querySelector(".radio-queue-status");

beforeEach(() => {
  usePlayerStore.setState({ radioActive: false, radioSeed: null, radioLabel: null, radioMode: "same-artist" });
});

afterEach(cleanup);

describe("RadioQueueStatus", () => {
  it("renders nothing while radio is off", () => {
    render(<RadioQueueStatus />);
    expect(status()).toBeNull();
  });

  it("names the running radio by its label, else its mode", () => {
    usePlayerStore.setState({ radioActive: true, radioSeed: seed, radioLabel: "Shoegaze" });
    const { rerender } = render(<RadioQueueStatus />);
    expect(status()!.textContent).toContain("Radio · Shoegaze");

    usePlayerStore.setState({ radioLabel: null });
    rerender(<RadioQueueStatus />);
    expect(status()!.textContent).toContain("Radio · Same Artist");
  });

  it("stops radio from its Stop button", () => {
    usePlayerStore.setState({ radioActive: true, radioSeed: seed });
    render(<RadioQueueStatus />);

    fireEvent.click(document.querySelector(".radio-queue-status-stop")!);

    expect(usePlayerStore.getState().radioActive).toBe(false);
    expect(status()).toBeNull();
  });
});
