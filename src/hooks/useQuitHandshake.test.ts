// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("@tauri-apps/api/event", async () => (await import("../test/mocks/tauri")).eventModule);

import { act, renderHook, waitFor } from "@testing-library/react";
import { onQuit } from "../lib/quitFlush";
import { emitTauriEvent, invoke, listenerCount, onInvoke, resetTauriMocks } from "../test/mocks/tauri";
import { useQuitHandshake } from "./useQuitHandshake";

function invokedCommands(): string[] {
  return invoke.mock.calls.map(([cmd]) => cmd);
}

beforeEach(() => {
  resetTauriMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useQuitHandshake", () => {
  it("tells Rust it is listening only once the listener is armed", async () => {
    renderHook(() => useQuitHandshake());

    await waitFor(() => expect(invokedCommands()).toEqual(["quit_listener_ready"]));
    expect(listenerCount("quit-requested")).toBe(1);
  });

  it("confirms the quit only after every flush finished", async () => {
    const order: string[] = [];
    let finishFlush: () => void = () => {};
    const unregister = onQuit(
      () =>
        new Promise<void>((resolve) => {
          finishFlush = () => {
            order.push("flushed");
            resolve();
          };
        }),
    );
    for (const cmd of ["quit_listener_ready", "quit_ready"]) onInvoke(cmd, () => order.push(cmd));
    renderHook(() => useQuitHandshake());
    await waitFor(() => expect(order).toEqual(["quit_listener_ready"]));

    await act(async () => {
      emitTauriEvent("quit-requested", null);
      await Promise.resolve();
    });
    expect(order).toEqual(["quit_listener_ready"]);
    await act(async () => {
      finishFlush();
    });

    await waitFor(() => expect(order).toEqual(["quit_listener_ready", "flushed", "quit_ready"]));
    unregister();
  });

  it("removes its listener on unmount", async () => {
    const { unmount } = renderHook(() => useQuitHandshake());
    await waitFor(() => expect(listenerCount("quit-requested")).toBe(1));

    unmount();

    await waitFor(() => expect(listenerCount("quit-requested")).toBe(0));
  });

  it("tells Rust its listener is gone on unmount, so a quit doesn't wait for an answer that never comes", async () => {
    const { unmount } = renderHook(() => useQuitHandshake());
    await waitFor(() => expect(invokedCommands()).toEqual(["quit_listener_ready"]));

    unmount();

    await waitFor(() => expect(invokedCommands()).toEqual(["quit_listener_ready", "quit_listener_gone"]));
  });

  it("reports as many listeners gone as ready under StrictMode", async () => {
    renderHook(() => useQuitHandshake(), { reactStrictMode: true });
    await waitFor(() => expect(listenerCount("quit-requested")).toBe(1));
    await waitFor(() => expect(invokedCommands()).toContain("quit_listener_ready"));

    const count = (cmd: string) => invokedCommands().filter((c) => c === cmd).length;
    expect(count("quit_listener_ready") - count("quit_listener_gone")).toBe(1);
  });

  it("arms one listener under StrictMode", async () => {
    renderHook(() => useQuitHandshake(), { reactStrictMode: true });

    await waitFor(() => expect(listenerCount("quit-requested")).toBe(1));
  });
});
