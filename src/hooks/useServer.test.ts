// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));

import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDb } from "../db";
import { onInvoke, resetTauriMocks } from "../test/mocks/tauri";
import {
  SECRET_STORE_UNAVAILABLE,
  credentialReadError,
  credentialRetryDelay,
  shouldRetryCredentialRead,
  useServerWithCredential,
} from "./useServer";
import type { Server } from "../types/server";

const SERVER: Server = {
  id: "srv-1",
  type: "navidrome",
  url: "https://music.example",
  alt_url: null,
  display_name: "Home",
  username: "alice",
  created_at: "2026-01-01",
};

function makeClient(opts?: { retry?: boolean | number }) {
  return new QueryClient({ defaultOptions: { queries: { retry: opts?.retry ?? false } } });
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

function mockDbSelect(rows: Server[]) {
  const select = vi.fn().mockResolvedValue(rows);
  (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ select });
  return select;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTauriMocks();
});

describe("useServerWithCredential", () => {
  it("does not query while serverId is undefined", () => {
    mockDbSelect([SERVER]);
    const { result } = renderHook(() => useServerWithCredential(undefined), {
      wrapper: wrapperFor(makeClient()),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it("throws 'not found' when the server row is missing", async () => {
    mockDbSelect([]);
    const { result } = renderHook(() => useServerWithCredential(SERVER.id), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(new Error(`Server ${SERVER.id} not found`));
  });

  it("surfaces a missing keychain entry as a friendly message, not the raw keyring string", async () => {
    mockDbSelect([SERVER]);
    onInvoke("get_credential", () => {
      throw new Error("No matching entry found in secure storage");
    });
    const { result } = renderHook(() => useServerWithCredential(SERVER.id), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(
      new Error("Could not read the stored credential: No matching entry found in secure storage")
    );
  });

  it("does not retry a missing-keychain-entry failure even against an ambient retrying client", async () => {
    mockDbSelect([SERVER]);
    const attempt = vi.fn(() => {
      throw new Error("No matching entry found in secure storage");
    });
    onInvoke("get_credential", attempt);
    // Ambient client allows retries; the hook's own `retry: false` must still win.
    const { result } = renderHook(() => useServerWithCredential(SERVER.id), {
      wrapper: wrapperFor(makeClient({ retry: 3 })),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("retries a secret store that is not up yet, then resolves once it is", async () => {
    // Canon can autostart before gnome-keyring/kwallet is running. Nothing else invalidates this
    // key, so without a retry one such failure leaves the session with no credential for good:
    // no sync, and the backoff ladder in useLibrarySync never arms because no run ever starts.
    vi.useFakeTimers();
    try {
      mockDbSelect([SERVER]);
      let attempts = 0;
      onInvoke("get_credential", () => {
        attempts += 1;
        if (attempts < 3) throw new Error(`${SECRET_STORE_UNAVAILABLE}dbus connection refused`);
        return JSON.stringify({ type: "md5", token: "tok", salt: "slt" });
      });
      const { result } = renderHook(() => useServerWithCredential(SERVER.id), {
        wrapper: wrapperFor(makeClient()),
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(credentialRetryDelay(0) + credentialRetryDelay(1) + 10);
      });
      expect(attempts).toBe(3);
      expect(result.current.data?.credential).toEqual({ type: "md5", token: "tok", salt: "slt" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up on a store that never comes back, without leaking the marker into the message", async () => {
    vi.useFakeTimers();
    try {
      mockDbSelect([SERVER]);
      let attempts = 0;
      onInvoke("get_credential", () => {
        attempts += 1;
        throw new Error(`${SECRET_STORE_UNAVAILABLE}keyring is locked`);
      });
      const { result } = renderHook(() => useServerWithCredential(SERVER.id), {
        wrapper: wrapperFor(makeClient()),
      });
      const ladder = [0, 1, 2, 3, 4].reduce((sum, n) => sum + credentialRetryDelay(n), 0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ladder + 1000);
      });
      expect(attempts).toBe(6);
      // The ladder is spent, so nothing further is scheduled; real timers let waitFor settle the
      // last render without paying for another fake-time sweep.
      expect(result.current.isError).toBe(true);
      expect(result.current.error?.message).toBe(
        "Could not read the stored credential: keyring is locked"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops retrying an unreachable store rather than reading the keyring forever", () => {
    const transient = credentialReadError(`${SECRET_STORE_UNAVAILABLE}keyring is locked`);
    const permanent = credentialReadError("No matching entry found in secure storage");
    // React Query counts failures from zero, so the last retry is asked for at 4.
    expect(shouldRetryCredentialRead(0, transient)).toBe(true);
    expect(shouldRetryCredentialRead(4, transient)).toBe(true);
    expect(shouldRetryCredentialRead(5, transient)).toBe(false);
    expect(shouldRetryCredentialRead(0, permanent)).toBe(false);
    // Every attempt waits longer than the last, and the ladder as a whole outlasts a keyring
    // that comes up a few seconds into the login session.
    const delays = [0, 1, 2, 3, 4].map(credentialRetryDelay);
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000]);
  });

  it("throws a corrupt-credentials error on malformed JSON", async () => {
    mockDbSelect([SERVER]);
    onInvoke("get_credential", () => "{not json");
    const { result } = renderHook(() => useServerWithCredential(SERVER.id), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(
      new Error(`Corrupt credentials for server ${SERVER.id}. Re-enter in Settings.`)
    );
  });

  it("migrates a legacy token/salt credential with no type field to md5", async () => {
    mockDbSelect([SERVER]);
    onInvoke("get_credential", () => JSON.stringify({ token: "abc", salt: "xyz" }));
    const { result } = renderHook(() => useServerWithCredential(SERVER.id), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      server: SERVER,
      credential: { type: "md5", token: "abc", salt: "xyz" },
    });
  });

  it("resolves server and credential on a well-formed payload", async () => {
    mockDbSelect([SERVER]);
    const credential = { type: "apikey", apiKey: "secret" };
    onInvoke("get_credential", () => JSON.stringify(credential));
    const { result } = renderHook(() => useServerWithCredential(SERVER.id), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ server: SERVER, credential });
  });
});
