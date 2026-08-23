/**
 * Transport-layer coverage for `src/lib/navidrome.ts`: `apiPost`'s timeout / retry /
 * alt-URL behavior, the `SubsonicError` code channel, and `fetchAllAlbums`' refusal to
 * return a short list. `apiPost` is module-private, so every test drives it through a
 * real exported caller, which is also what pins the caller-specific error messages.
 *
 * The URL/credential builders (`getCoverArtUrl`, `getArtistImageUrl`, `getStreamUrl`,
 * the md5 salt/token vector) are a separate scope and are not covered here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);

import {
  SubsonicError,
  addTrackToNavidromePlaylist,
  fetchAlbumListByType,
  fetchAllAlbums,
  fetchStarred2,
  scrobbleTrack,
  setRating,
  starTrack,
  type NavidromeAlbum,
  type NavidromeCredential,
} from "./navidrome";

const BASE = "http://music.example";
const ALT = "http://192.168.1.5:4533";
const cred: NavidromeCredential = { type: "md5", token: "tok", salt: "slt" };

let fetchMock: ReturnType<typeof vi.fn>;

/** A 200 response carrying a Subsonic envelope. */
function ok(body: Record<string, unknown> = { status: "ok" }): Response {
  return new Response(JSON.stringify({ "subsonic-response": body }), { status: 200 });
}

function failed(error?: { code?: number; message?: string }): Response {
  return new Response(JSON.stringify({ "subsonic-response": { status: "failed", error } }), {
    status: 200,
  });
}

function httpStatus(status: number): Response {
  return new Response("{}", { status });
}

/** An album page of `n` synthetic albums, in the `getAlbumList2` envelope. */
function albumPage(n: number, startAt = 0): Response {
  const album: NavidromeAlbum[] = Array.from({ length: n }, (_, i) => ({
    id: `al-${startAt + i}`,
    name: `Album ${startAt + i}`,
    artist: "Artist",
    artistId: "ar-1",
  }));
  return ok({ status: "ok", albumList2: { album } });
}

/** Bodies of every fetch call so far, parsed. */
function bodies(): URLSearchParams[] {
  return fetchMock.mock.calls.map((c) => new URLSearchParams((c[1] as RequestInit).body as string));
}

/** Parsed body of the nth fetch call. */
function body(n = 0): URLSearchParams {
  return bodies()[n]!;
}

function urls(): string[] {
  return fetchMock.mock.calls.map((c) => c[0] as string);
}

/**
 * Run `promise` to settlement while draining the retry backoff timers. Real fetches are
 * already resolved by the mock, so a generous virtual advance costs nothing.
 */
async function settle<T>(promise: Promise<T>): Promise<T> {
  const raced = promise.then(
    (v) => ({ ok: true as const, v }),
    (e) => ({ ok: false as const, e })
  );
  await vi.advanceTimersByTimeAsync(60_000);
  const r = await raced;
  if (r.ok) return r.v;
  throw r.e;
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("apiPost request shape", () => {
  it("posts a form-encoded body to <base>/rest/<endpoint>", async () => {
    fetchMock.mockResolvedValue(ok({ status: "ok", starred2: {} }));

    await settle(fetchStarred2(BASE, "alice", cred));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urls()[0]).toBe("http://music.example/rest/getStarred2");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded"
    );
    expect(body().get("u")).toBe("alice");
    expect(body().get("t")).toBe("tok");
    expect(body().get("s")).toBe("slt");
    expect(body().get("v")).toBe("1.16.1");
    expect(body().get("c")).toBe("canon");
    expect(body().get("f")).toBe("json");
  });

  it.each([
    ["http://music.example/", "http://music.example/rest/getStarred2"],
    ["http://music.example///", "http://music.example/rest/getStarred2"],
    ["http://music.example/rest", "http://music.example/rest/getStarred2"],
    ["http://music.example/rest/", "http://music.example/rest/getStarred2"],
    ["http://music.example/music", "http://music.example/music/rest/getStarred2"],
  ])("normalizes base url %s", async (base, expected) => {
    fetchMock.mockResolvedValue(ok({ status: "ok", starred2: {} }));

    await settle(fetchStarred2(base, "alice", cred));

    expect(urls()[0]).toBe(expected);
  });

  it("aborts an attempt at exactly 12s and never before", async () => {
    let capturedSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      capturedSignal = init.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError"))
        );
      });
    });

    const promise = fetchStarred2(BASE, "alice", cred).catch((e: Error) => e);

    await vi.advanceTimersByTimeAsync(11_999);
    expect(capturedSignal!.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(capturedSignal!.aborted).toBe(true);

    const err = await settle(promise);
    expect((err as Error).message).toBe("getStarred2 failed after 3 attempts: timed out after 12000ms");
  });

  it("clears the timeout timer when the request resolves", async () => {
    fetchMock.mockResolvedValue(ok({ status: "ok", starred2: {} }));

    await settle(fetchStarred2(BASE, "alice", cred));

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("apiPost retry policy", () => {
  it("makes exactly 3 attempts on a repeatedly rejecting fetch", async () => {
    fetchMock.mockRejectedValue(new TypeError("Load failed"));

    await expect(settle(fetchStarred2(BASE, "alice", cred))).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("backs off 400ms then 800ms between attempts", async () => {
    fetchMock.mockRejectedValue(new TypeError("Load failed"));
    const promise = fetchStarred2(BASE, "alice", cred).catch(() => undefined);

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(399);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(799);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await settle(promise);
  });

  it("tries the alt url inside every attempt, not only the first", async () => {
    fetchMock.mockRejectedValue(new TypeError("Load failed"));

    await expect(settle(fetchStarred2(BASE, "alice", cred, ALT))).rejects.toThrow();

    expect(urls()).toEqual([
      "http://music.example/rest/getStarred2",
      "http://192.168.1.5:4533/rest/getStarred2",
      "http://music.example/rest/getStarred2",
      "http://192.168.1.5:4533/rest/getStarred2",
      "http://music.example/rest/getStarred2",
      "http://192.168.1.5:4533/rest/getStarred2",
    ]);
  });

  it("returns as soon as the alt url answers, without burning a backoff delay", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValue(ok({ status: "ok", starred2: {} }));

    const promise = fetchStarred2(BASE, "alice", cred, ALT);
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    await settle(promise);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([429, 502, 503, 504])("retries HTTP %i", async (status) => {
    fetchMock.mockResolvedValue(httpStatus(status));

    await expect(settle(fetchStarred2(BASE, "alice", cred))).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([400, 401, 404, 500])("hands HTTP %i straight back without retrying", async (status) => {
    fetchMock.mockResolvedValue(httpStatus(status));

    await expect(settle(fetchStarred2(BASE, "alice", cred))).rejects.toThrow(
      `getStarred2 returned ${status}`
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a retriable status to the caller once the attempts are spent", async () => {
    fetchMock.mockResolvedValue(httpStatus(503));

    // Not the "failed after 3 attempts" transport error: the last attempt's response is
    // returned, so the caller's own status check is what throws.
    await expect(settle(fetchStarred2(BASE, "alice", cred))).rejects.toThrow(
      "getStarred2 returned 503"
    );
  });
});

describe("apiPost error naming", () => {
  it("never surfaces a bare 'Load failed'", async () => {
    fetchMock.mockRejectedValue(new TypeError("Load failed"));

    const err = (await settle(
      fetchStarred2(BASE, "alice", cred).catch((e: Error) => e)
    )) as Error;

    expect(err.message).toBe("getStarred2 failed after 3 attempts: Load failed");
    expect(err.message).not.toBe("Load failed");
  });

  it("names the endpoint that burned the attempts", async () => {
    fetchMock.mockRejectedValue(new TypeError("Load failed"));

    const err = (await settle(
      fetchAlbumListByType(BASE, "alice", cred, "recent").catch((e: Error) => e)
    )) as Error;

    expect(err.message).toContain("getAlbumList2");
  });

  it("says '1 attempt' singular for a non-idempotent endpoint", async () => {
    fetchMock.mockRejectedValue(new TypeError("Load failed"));

    const err = (await settle(
      scrobbleTrack(BASE, "alice", cred, "tr-1", 1000).catch((e: Error) => e)
    )) as Error;

    expect(err.message).toBe("scrobble.view failed after 1 attempt: Load failed");
  });

  it("reports the last failure, not the first", async () => {
    fetchMock
      .mockResolvedValueOnce(httpStatus(503))
      .mockRejectedValue(new TypeError("connection reset"));

    const err = (await settle(
      fetchStarred2(BASE, "alice", cred).catch((e: Error) => e)
    )) as Error;

    expect(err.message).toBe("getStarred2 failed after 3 attempts: connection reset");
  });

  it("stringifies a non-Error rejection", async () => {
    fetchMock.mockRejectedValue("boom");

    const err = (await settle(
      fetchStarred2(BASE, "alice", cred).catch((e: Error) => e)
    )) as Error;

    expect(err.message).toBe("getStarred2 failed after 3 attempts: boom");
  });
});

describe("non-idempotent endpoints", () => {
  it("gives scrobble exactly one shot while star gets three", async () => {
    fetchMock.mockRejectedValue(new TypeError("Load failed"));

    await expect(settle(scrobbleTrack(BASE, "alice", cred, "tr-1", 1000))).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    await expect(settle(starTrack(BASE, "alice", cred, "tr-1"))).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not send a timed-out scrobble to the alt url", async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError"))
        );
      });
    });

    const promise = scrobbleTrack(BASE, "alice", cred, "tr-1", 1000).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(12_000);
    await settle(promise);

    // A timeout may have been applied server-side, so the alt route must never see it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urls()).toEqual(["http://music.example/rest/scrobble.view"]);
  });

  it("does not send an opaquely rejected scrobble to the alt url", async () => {
    // The dominant Linux failure is a resolver stall rejecting with TypeError("Load failed"),
    // not an AbortError, and fetch cannot say whether the request reached the server. Both
    // routes are the same Navidrome, so a write that reached either one is already applied.
    fetchMock.mockRejectedValue(new TypeError("Load failed"));

    await expect(settle(scrobbleTrack(BASE, "alice", cred, "tr-1", 1000, ALT))).rejects.toThrow();

    expect(urls()).toEqual(["http://music.example/rest/scrobble.view"]);
  });

  it("does not send an opaquely rejected playlist update to the alt url", async () => {
    fetchMock.mockRejectedValue(new TypeError("Load failed"));

    await expect(
      settle(addTrackToNavidromePlaylist(BASE, "alice", cred, "pl-1", "tr-1", ALT))
    ).rejects.toThrow();

    expect(urls()).toEqual(["http://music.example/rest/updatePlaylist"]);
  });

  it("still tries the alt url for an idempotent endpoint that rejects", async () => {
    fetchMock.mockRejectedValue(new TypeError("Load failed"));

    await expect(settle(starTrack(BASE, "alice", cred, "tr-1", ALT))).rejects.toThrow();

    expect(urls()).toContain("http://192.168.1.5:4533/rest/star.view");
  });

  it("does not retry a non-idempotent endpoint answering with a retriable status", async () => {
    fetchMock.mockResolvedValue(httpStatus(503));

    await expect(settle(scrobbleTrack(BASE, "alice", cred, "tr-1", 1000))).rejects.toThrow(
      "scrobble.view returned 503"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("matches the endpoint name with or without the .view suffix", async () => {
    fetchMock.mockRejectedValue(new TypeError("Load failed"));

    // scrobble.view (suffixed) and createPlaylist (bare) are both in the set.
    await expect(settle(scrobbleTrack(BASE, "alice", cred, "tr-1", 1000))).rejects.toThrow(
      "failed after 1 attempt"
    );
  });
});

describe("SubsonicError", () => {
  it("carries a code 70 from an HTTP 200 error envelope", async () => {
    fetchMock.mockResolvedValue(failed({ code: 70, message: "Song not found" }));

    const err = (await settle(
      scrobbleTrack(BASE, "alice", cred, "tr-1", 1000).catch((e: Error) => e)
    )) as SubsonicError;

    expect(err).toBeInstanceOf(SubsonicError);
    expect(err.name).toBe("SubsonicError");
    expect(err.code).toBe(70);
    expect(err.message).toBe("Song not found");
  });

  it.each([40, 41, 50])("distinguishes auth code %i from the droppable 70", async (code) => {
    fetchMock.mockResolvedValue(failed({ code, message: "nope" }));

    const err = (await settle(
      scrobbleTrack(BASE, "alice", cred, "tr-1", 1000).catch((e: Error) => e)
    )) as SubsonicError;

    expect(err.code).toBe(code);
    // Mirrors useScrobbleFlush's PERMANENT_SUBSONIC_CODES predicate.
    expect(new Set([70]).has(err.code as number)).toBe(false);
  });

  it("uses a null code and a suffix-free message when the envelope has no error object", async () => {
    fetchMock.mockResolvedValue(failed(undefined));

    const err = (await settle(
      starTrack(BASE, "alice", cred, "tr-1").catch((e: Error) => e)
    )) as SubsonicError;

    expect(err.code).toBeNull();
    expect(err.message).toBe("star.view failed");
  });

  it("builds a default message naming the code when the server sends no message", async () => {
    fetchMock.mockResolvedValue(failed({ code: 70 }));

    const err = (await settle(
      starTrack(BASE, "alice", cred, "tr-1").catch((e: Error) => e)
    )) as SubsonicError;

    expect(err.message).toBe("star.view failed with code 70");
  });

  it("keeps code 0 rather than collapsing it to null", async () => {
    fetchMock.mockResolvedValue(failed({ code: 0, message: "generic" }));

    const err = (await settle(
      starTrack(BASE, "alice", cred, "tr-1").catch((e: Error) => e)
    )) as SubsonicError;

    expect(err.code).toBe(0);
  });

  it("throws a plain Error, not a SubsonicError, for a non-200 response", async () => {
    fetchMock.mockResolvedValue(httpStatus(500));

    const err = (await settle(
      starTrack(BASE, "alice", cred, "tr-1").catch((e: Error) => e)
    )) as Error;

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SubsonicError);
    expect(err.message).toBe("star.view returned 500");
  });

  it("resolves without throwing on an ok envelope", async () => {
    fetchMock.mockResolvedValue(ok());

    await expect(settle(starTrack(BASE, "alice", cred, "tr-1"))).resolves.toBeUndefined();
  });

  it("sends each caller's own params", async () => {
    // A Response body can only be read once, so build a fresh one per call.
    fetchMock.mockImplementation(async () => ok());

    await settle(starTrack(BASE, "alice", cred, "tr-9"));
    expect(body().get("id")).toBe("tr-9");

    fetchMock.mockClear();
    await settle(setRating(BASE, "alice", cred, "tr-9", 0));
    expect(body().get("id")).toBe("tr-9");
    expect(body().get("rating")).toBe("0");

    fetchMock.mockClear();
    await settle(scrobbleTrack(BASE, "alice", cred, "tr-9", 1_700_000_000_000));
    expect(body().get("submission")).toBe("true");
    expect(body().get("time")).toBe("1700000000000");
  });
});

describe("fetchAllAlbums", () => {
  // Mirrors the PAGE_SIZE constant inside fetchAllAlbums. If that changes, the
  // "requests another page after an exactly-full one" test goes red, which is the point.
  const PAGE_SIZE = 500;
  // Mirrors MAX_ALBUMS inside fetchAllAlbums for the same reason.
  const MAX_ALBUMS = 500_000;

  it("returns an empty list from a single request for an empty library", async () => {
    fetchMock.mockResolvedValue(albumPage(0));

    await expect(settle(fetchAllAlbums(BASE, "alice", cred))).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["albumList2 missing", ok({ status: "ok" })],
    ["album missing", ok({ status: "ok", albumList2: {} })],
  ])("treats a %s envelope as an empty page", async (_label, res) => {
    fetchMock.mockResolvedValue(res);

    await expect(settle(fetchAllAlbums(BASE, "alice", cred))).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops after a short page", async () => {
    fetchMock.mockResolvedValue(albumPage(PAGE_SIZE - 1));

    const albums = await settle(fetchAllAlbums(BASE, "alice", cred));

    expect(albums).toHaveLength(PAGE_SIZE - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requests another page after an exactly-full one", async () => {
    fetchMock.mockResolvedValueOnce(albumPage(PAGE_SIZE)).mockResolvedValueOnce(albumPage(0));

    const albums = await settle(fetchAllAlbums(BASE, "alice", cred));

    expect(albums).toHaveLength(PAGE_SIZE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("walks the offset forward across pages", async () => {
    fetchMock
      .mockResolvedValueOnce(albumPage(PAGE_SIZE, 0))
      .mockResolvedValueOnce(albumPage(PAGE_SIZE, PAGE_SIZE))
      .mockResolvedValueOnce(albumPage(3, PAGE_SIZE * 2));

    const albums = await settle(fetchAllAlbums(BASE, "alice", cred));

    expect(albums).toHaveLength(PAGE_SIZE * 2 + 3);
    expect(bodies().map((b) => b.get("offset"))).toEqual([
      "0",
      String(PAGE_SIZE),
      String(PAGE_SIZE * 2),
    ]);
    expect(body().get("type")).toBe("alphabeticalByName");
    expect(body().get("size")).toBe(String(PAGE_SIZE));
  });

  it("throws rather than returning the pages it already has when a later page 500s", async () => {
    fetchMock.mockResolvedValueOnce(albumPage(PAGE_SIZE)).mockResolvedValue(httpStatus(500));

    await expect(settle(fetchAllAlbums(BASE, "alice", cred))).rejects.toThrow(
      "getAlbumList2 returned 500"
    );
  });

  it("throws when a later page answers 200 with an error envelope", async () => {
    fetchMock
      .mockResolvedValueOnce(albumPage(PAGE_SIZE))
      .mockResolvedValue(failed({ code: 0, message: "database locked" }));

    await expect(settle(fetchAllAlbums(BASE, "alice", cred))).rejects.toThrow("database locked");
  });

  it("throws a default message when a failed envelope carries no error object", async () => {
    fetchMock.mockResolvedValue(failed(undefined));

    await expect(settle(fetchAllAlbums(BASE, "alice", cred))).rejects.toThrow(
      "Failed to fetch albums"
    );
  });

  it("propagates the named transport error when a later page's fetch never lands", async () => {
    fetchMock
      .mockResolvedValueOnce(albumPage(PAGE_SIZE))
      .mockRejectedValue(new TypeError("Load failed"));

    await expect(settle(fetchAllAlbums(BASE, "alice", cred))).rejects.toThrow(
      "getAlbumList2 failed after 3 attempts: Load failed"
    );
  });

  it("throws instead of looping when the server ignores the offset and repeats a page", async () => {
    // A fresh Response per call: one instance's body can only be read once.
    fetchMock.mockImplementation(() => Promise.resolve(albumPage(PAGE_SIZE)));

    await expect(settle(fetchAllAlbums(BASE, "alice", cred))).rejects.toThrow(
      "getAlbumList2 ignored the offset"
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws once the walk passes the album ceiling instead of growing without bound", async () => {
    // Every page is full, and only its first id differs - which is all the repeated-page
    // guard reads - so the ceiling is the only thing that can stop the walk. Reaching it
    // means moving 500k albums through the fetch mock, so each one is cut to the single
    // field the walk reads and the shared tail is built as text once: a page of realistic
    // album objects spends the whole budget in JSON.parse, which is time this assertion
    // never reads and enough to time the case out on a loaded machine.
    const tailJson = Array.from({ length: PAGE_SIZE - 1 }, (_, i) => `{"id":"t${i}"}`).join(",");
    let served = 0;
    fetchMock.mockImplementation(() => {
      const body = `{"subsonic-response":{"status":"ok","albumList2":{"album":[{"id":"h${served++}"},${tailJson}]}}}`;
      return Promise.resolve(new Response(body, { status: 200 }));
    });

    await expect(settle(fetchAllAlbums(BASE, "alice", cred))).rejects.toThrow(
      `getAlbumList2 exceeded the ${MAX_ALBUMS} album ceiling`
    );

    expect(fetchMock).toHaveBeenCalledTimes(MAX_ALBUMS / PAGE_SIZE);
  });

  it("threads the alt url through every page", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValueOnce(albumPage(PAGE_SIZE))
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValueOnce(albumPage(0));

    await settle(fetchAllAlbums(BASE, "alice", cred, ALT));

    expect(urls()).toEqual([
      "http://music.example/rest/getAlbumList2",
      "http://192.168.1.5:4533/rest/getAlbumList2",
      "http://music.example/rest/getAlbumList2",
      "http://192.168.1.5:4533/rest/getAlbumList2",
    ]);
  });
});
