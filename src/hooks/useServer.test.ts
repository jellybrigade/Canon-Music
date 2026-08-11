// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);
vi.mock("../db", () => ({ getDb: vi.fn() }));

import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDb } from "../db";
import { onInvoke, resetTauriMocks } from "../test/mocks/tauri";
import { useServerWithCredential } from "./useServer";
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
