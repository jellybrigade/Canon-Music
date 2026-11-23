// @vitest-environment jsdom
vi.mock("../../clients/navidrome", () => ({
  authenticate: vi.fn(),
  authenticateWithApiKey: vi.fn(),
}));

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticate, authenticateWithApiKey } from "../../clients/navidrome";
import { type ConnectionFields, useConnectionTest } from "./useConnectionTest";

const PRIMARY = "https://music.example.com";
const ALTERNATE = "http://192.168.1.5:4533";
const CREDENTIAL = { type: "md5", token: "t", salt: "s" } as const;
const FIELDS: ConnectionFields = {
  url: PRIMARY,
  username: "alice",
  password: "pw",
  apiKey: "",
  authMethod: "password",
};

function answer(byUrl: Record<string, Error | null>) {
  vi.mocked(authenticate).mockImplementation(async (url) => {
    const failure = byUrl[url];
    if (failure) throw failure;
    return CREDENTIAL;
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useConnectionTest", () => {
  it("reports an unreachable alternate beside a working primary, which still counts as tested", async () => {
    answer({ [PRIMARY]: null, [ALTERNATE]: new Error("Load failed") });
    const { result } = renderHook(() => useConnectionTest());

    await act(() => result.current.run(FIELDS, ALTERNATE));

    expect(result.current.state).toBe("ok");
    expect(result.current.isTested(FIELDS)).toBe(true);
    expect(result.current.testedCredential).toEqual(CREDENTIAL);
    expect(result.current.alternateFor(ALTERNATE)).toEqual({ url: ALTERNATE, state: "error", error: "Load failed" });
  });

  it("keeps a failed primary failed even when the alternate answers", async () => {
    answer({ [PRIMARY]: new Error("Server returned 404"), [ALTERNATE]: null });
    const { result } = renderHook(() => useConnectionTest());

    await act(() => result.current.run(FIELDS, ALTERNATE));

    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe("Server returned 404");
    expect(result.current.isTested(FIELDS)).toBe(false);
    expect(result.current.alternateFor(ALTERNATE)).toEqual({ url: ALTERNATE, state: "ok" });
  });

  it("gives the primary's verdict without waiting for an alternate that hasn't answered", async () => {
    vi.mocked(authenticate).mockImplementation((url) =>
      url === ALTERNATE ? new Promise(() => {}) : Promise.resolve(CREDENTIAL),
    );
    const { result } = renderHook(() => useConnectionTest());

    act(() => {
      void result.current.run(FIELDS, ALTERNATE);
    });
    await act(async () => {});

    expect(result.current.state).toBe("ok");
    expect(result.current.isTested(FIELDS)).toBe(true);
    expect(result.current.alternateFor(ALTERNATE)).toEqual({ url: ALTERNATE, state: "testing" });
  });

  it("tests the alternate with the same auth method as the primary", async () => {
    vi.mocked(authenticateWithApiKey).mockResolvedValue({ type: "apikey", apiKey: "k" });
    const { result } = renderHook(() => useConnectionTest());

    await act(() => result.current.run({ ...FIELDS, authMethod: "apikey", apiKey: "k" }, ALTERNATE));

    expect(vi.mocked(authenticateWithApiKey).mock.calls).toEqual([
      [PRIMARY, "alice", "k"],
      [ALTERNATE, "alice", "k"],
    ]);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("pings only the primary when no alternate is set", async () => {
    answer({});
    const { result } = renderHook(() => useConnectionTest());

    await act(() => result.current.run(FIELDS, "   "));

    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(result.current.alternateFor("")).toBeNull();
  });

  it("drops the alternate's result once its address is edited, leaving the primary tested", async () => {
    answer({ [ALTERNATE]: new Error("Load failed") });
    const { result } = renderHook(() => useConnectionTest());

    await act(() => result.current.run(FIELDS, ALTERNATE));

    expect(result.current.alternateFor(`${ALTERNATE}0`)).toBeNull();
    expect(result.current.alternateFor(` ${ALTERNATE} `)).not.toBeNull();
    expect(result.current.isTested(FIELDS)).toBe(true);
  });

  it("ignores a test that finishes after the fields were edited", async () => {
    let finish: (credential: typeof CREDENTIAL) => void = () => {};
    vi.mocked(authenticate).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useConnectionTest());

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.run(FIELDS, "");
    });
    act(() => result.current.reset());
    await act(async () => {
      finish(CREDENTIAL);
      await pending;
    });

    expect(result.current.state).toBe("idle");
    expect(result.current.testedCredential).toBeNull();
  });
});
