/**
 * URL and credential construction in `src/lib/navidrome.ts`: `getCoverArtUrl`,
 * `getArtistImageUrl`, `getStreamUrl`, `updateCoverProxyConfig`, and the md5
 * salt/token pair `authenticate` sends.
 *
 * Separate file from `navidrome.test.ts` on purpose. That file installs fake timers
 * and a stubbed global `fetch` for every test to drive `apiPost`'s retry loop; this
 * one needs neither, and it needs `vi.resetModules()` per test because
 * `_coverServerReady` is one-way (`initCoverServer()` has no counterpart), so a single
 * test that flips it would otherwise decide the outcome of every test after it.
 *
 * `_streamMaxBitrate` is also module state, shared with `track.test.ts`. Vitest isolates
 * module registries per file so the two cannot collide today, but the fresh import per
 * test here means an intra-file leak is impossible either.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { md5 } from "js-md5";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);

import { invoke } from "@tauri-apps/api/core";
import { resetTauriMocks } from "../test/mocks/tauri";
import type { NavidromeCredential } from "./navidrome";

type Nav = typeof import("./navidrome");

const BASE = "http://music.example";
const cred: NavidromeCredential = { type: "md5", token: "tok", salt: "slt" };
const apiKeyCred: NavidromeCredential = { type: "apikey", apiKey: "key-123" };

/** A module instance with `_coverServerReady === false` and `_streamMaxBitrate === 0`. */
async function freshNav(): Promise<Nav> {
  vi.resetModules();
  return await import("./navidrome");
}

/** Query params of a built URL. */
function params(url: string): URLSearchParams {
  return new URLSearchParams(url.slice(url.indexOf("?") + 1));
}

let nav: Nav;

beforeEach(async () => {
  resetTauriMocks();
  nav = await freshNav();
});

describe("buildAuthParams (through getStreamUrl)", () => {
  it("sends u/t/s plus the fixed client params for an md5 credential", () => {
    const p = params(nav.getStreamUrl(BASE, "alice", cred, "tr-1"));
    expect(p.get("u")).toBe("alice");
    expect(p.get("t")).toBe("tok");
    expect(p.get("s")).toBe("slt");
    expect(p.get("v")).toBe("1.16.1");
    expect(p.get("c")).toBe("canon");
    expect(p.get("f")).toBe("json");
    expect(p.has("apiKey")).toBe(false);
  });

  it("sends apiKey and omits t/s entirely for an apikey credential", () => {
    const p = params(nav.getStreamUrl(BASE, "alice", apiKeyCred, "tr-1"));
    expect(p.get("apiKey")).toBe("key-123");
    expect(p.has("t")).toBe(false);
    expect(p.has("s")).toBe(false);
  });

  it("emits an empty u rather than dropping the key when username is empty", () => {
    const url = nav.getStreamUrl(BASE, "", cred, "tr-1");
    expect(url).toContain("u=&");
    expect(params(url).get("u")).toBe("");
  });

  it("form-encodes a username with reserved characters, space as +", () => {
    const url = nav.getStreamUrl(BASE, "user name+x&y", cred, "tr-1");
    // The raw form matters: updateCoverProxyConfig ships this exact string into Rust,
    // which concatenates it into an upstream query without re-encoding.
    expect(url).toContain("u=user+name%2Bx%26y");
    expect(params(url).get("u")).toBe("user name+x&y");
  });

  it("round-trips a unicode username as UTF-8 percent-encoding", () => {
    const url = nav.getStreamUrl(BASE, "ユーザー", cred, "tr-1");
    expect(url).toContain("%E3%83%A6");
    expect(params(url).get("u")).toBe("ユーザー");
  });

  it("orders the params u, t, s, v, c, f, then the call-specific ones", () => {
    const url = nav.getStreamUrl(BASE, "alice", cred, "tr-1");
    expect(url.slice(url.indexOf("?") + 1)).toBe(
      "u=alice&t=tok&s=slt&v=1.16.1&c=canon&f=json&id=tr-1"
    );
  });
});

describe("normalizeUrl (through getStreamUrl)", () => {
  it.each([
    ["http://music.example", "http://music.example/rest/stream"],
    ["http://music.example/", "http://music.example/rest/stream"],
    ["http://music.example///", "http://music.example/rest/stream"],
    ["http://music.example/rest", "http://music.example/rest/stream"],
    ["http://music.example/rest/", "http://music.example/rest/stream"],
  ])("normalizes %s to %s", (base, expected) => {
    const url = nav.getStreamUrl(base, "alice", cred, "tr-1");
    expect(url.slice(0, url.indexOf("?"))).toBe(expected);
  });

  it("keeps a path that merely starts with rest, because the suffix strip is anchored", () => {
    const url = nav.getStreamUrl(`${BASE}/restaurant`, "alice", cred, "tr-1");
    expect(url.startsWith("http://music.example/restaurant/rest/stream?")).toBe(true);
  });

  it("strips only one /rest, not every occurrence", () => {
    const url = nav.getStreamUrl(`${BASE}/rest/rest`, "alice", cred, "tr-1");
    expect(url.startsWith("http://music.example/rest/rest/stream?")).toBe(true);
  });
});

describe("getStreamUrl", () => {
  it("omits maxBitRate when the module bitrate is the default 0", () => {
    const url = nav.getStreamUrl(BASE, "alice", cred, "tr-1");
    expect(url).not.toContain("maxBitRate");
  });

  it("appends maxBitRate after id once a bitrate is set", () => {
    nav.setStreamMaxBitrate(192);
    const url = nav.getStreamUrl(BASE, "alice", cred, "tr-1");
    expect(url.endsWith("&id=tr-1&maxBitRate=192")).toBe(true);
  });

  it("reads the bitrate at call time, not at import time", () => {
    const before = nav.getStreamUrl(BASE, "alice", cred, "tr-1");
    nav.setStreamMaxBitrate(320);
    const after = nav.getStreamUrl(BASE, "alice", cred, "tr-1");
    expect(before).not.toBe(after);
    expect(params(after).get("maxBitRate")).toBe("320");
  });

  it("omits maxBitRate for a negative bitrate", () => {
    nav.setStreamMaxBitrate(-1);
    expect(nav.getStreamUrl(BASE, "alice", cred, "tr-1")).not.toContain("maxBitRate");
  });

  it("omits maxBitRate for NaN, which a corrupt stream.max_bitrate setting produces", () => {
    // App.tsx parseInt()s the raw setting string with no fallback, so NaN is reachable.
    nav.setStreamMaxBitrate(Number.NaN);
    expect(nav.getStreamUrl(BASE, "alice", cred, "tr-1")).not.toContain("maxBitRate");
  });

  it("passes a fractional bitrate through unrounded", () => {
    nav.setStreamMaxBitrate(192.7);
    expect(params(nav.getStreamUrl(BASE, "alice", cred, "tr-1")).get("maxBitRate")).toBe("192.7");
  });

  it("emits an empty id when the track id is empty", () => {
    // Reachable: stripServerPrefix("srv1:") returns "".
    const url = nav.getStreamUrl(BASE, "alice", cred, "");
    expect(url.endsWith("&id=")).toBe(true);
    expect(params(url).get("id")).toBe("");
  });

  it("percent-encodes a hash in the track id so the URL is not truncated at a fragment", () => {
    const url = nav.getStreamUrl(BASE, "alice", cred, "tr#1");
    expect(url).toContain("id=tr%231");
    expect(url).not.toContain("#");
    expect(params(url).get("id")).toBe("tr#1");
  });

  it("encodes reserved and unicode characters in the track id", () => {
    const url = nav.getStreamUrl(BASE, "alice", cred, "a+b&c/d eロ");
    expect(params(url).get("id")).toBe("a+b&c/d eロ");
    expect(url).toContain("id=a%2Bb%26c%2Fd+e%E3%83%AD");
  });
});

describe("getCoverArtUrl before the cover server is ready", () => {
  it("builds a direct /rest/getCoverArt URL with credentials and the default size 300", () => {
    expect(nav.getCoverArtUrl(BASE, "alice", cred, "al-1")).toBe(
      "http://music.example/rest/getCoverArt?u=alice&t=tok&s=slt&v=1.16.1&c=canon&f=json&id=al-1&size=300"
    );
  });

  it("uses apiKey when the credential is an api key", () => {
    const p = params(nav.getCoverArtUrl(BASE, "alice", apiKeyCred, "al-1"));
    expect(p.get("apiKey")).toBe("key-123");
    expect(p.has("t")).toBe(false);
  });

  it("emits size=0 rather than omitting it, unlike maxBitRate", () => {
    // size is set unconditionally; maxBitRate is guarded by > 0. The asymmetry is the point.
    expect(params(nav.getCoverArtUrl(BASE, "alice", cred, "al-1", 0)).get("size")).toBe("0");
  });

  it("passes a large size through unclamped", () => {
    expect(params(nav.getCoverArtUrl(BASE, "alice", cred, "al-1", 100000)).get("size")).toBe(
      "100000"
    );
  });

  it("emits an empty id when the cover art id is empty", () => {
    const url = nav.getCoverArtUrl(BASE, "alice", cred, "");
    expect(url).toContain("&id=&size=300");
  });

  it("encodes reserved characters in the cover art id", () => {
    const url = nav.getCoverArtUrl(BASE, "alice", cred, "al 1&x#y+z");
    expect(url).toContain("id=al+1%26x%23y%2Bz");
    expect(url).not.toContain("#");
    expect(params(url).get("id")).toBe("al 1&x#y+z");
  });

  it("round-trips a unicode cover art id", () => {
    const url = nav.getCoverArtUrl(BASE, "alice", cred, "アルバム");
    expect(params(url).get("id")).toBe("アルバム");
  });
});

describe("getCoverArtUrl once the cover server is ready", () => {
  beforeEach(() => {
    nav.initCoverServer();
  });

  it("switches from a direct URL to the cover:// scheme", () => {
    expect(nav.isCoverServerReady()).toBe(true);
    expect(nav.getCoverArtUrl(BASE, "alice", cred, "al-1", 300)).toBe(
      "cover://localhost/cover/al-1?size=300"
    );
  });

  it("still defaults size to 300, matching the Rust handler's own fallback", () => {
    expect(nav.getCoverArtUrl(BASE, "alice", cred, "al-1")).toBe(
      "cover://localhost/cover/al-1?size=300"
    );
  });

  it("emits an identical URL for a different server, so the ready branch is not owner-scoped", () => {
    // Documents current behavior, not desired behavior. baseUrl/username/credential are
    // all discarded here; the host is reconstructed in Rust from CoverState's single
    // global proxy_config slot, and the disk cache key is `{id}:{size}` with no server
    // namespace. Same shape as known-issues' "A mirror not scoped by owner". Recorded as
    // a follow-up in instructions/tests.md; flip this assertion when the URL gains a
    // server id.
    const a = nav.getCoverArtUrl(BASE, "alice", cred, "al-1", 300);
    const b = nav.getCoverArtUrl("http://other.example", "bob", apiKeyCred, "al-1", 300);
    expect(b).toBe(a);
  });

  it("percent-encodes a slash in the id so the Rust /cover/ prefix strip sees one segment", () => {
    expect(nav.getCoverArtUrl(BASE, "alice", cred, "al/1", 300)).toBe(
      "cover://localhost/cover/al%2F1?size=300"
    );
  });

  it("percent-encodes a question mark and ampersand so the id cannot corrupt size", () => {
    const url = nav.getCoverArtUrl(BASE, "alice", cred, "al?x=2&size=9", 300);
    expect(url).toBe("cover://localhost/cover/al%3Fx%3D2%26size%3D9?size=300");
    expect(params(url).get("size")).toBe("300");
  });

  it("encodes a unicode id", () => {
    expect(nav.getCoverArtUrl(BASE, "alice", cred, "アル", 64)).toBe(
      "cover://localhost/cover/%E3%82%A2%E3%83%AB?size=64"
    );
  });

  it("leaves encodeURIComponent's unreserved set alone", () => {
    // Guards against a swap to encodeURI, which would also leave & ? / unescaped.
    expect(nav.getCoverArtUrl(BASE, "alice", cred, "a'b(c)*-._~!", 300)).toBe(
      "cover://localhost/cover/a'b(c)*-._~!?size=300"
    );
  });

  it("interpolates size raw, so a non-integer size reaches the URL verbatim", () => {
    // Rust parses size as u32 and silently falls back to 300, but the JS-side string
    // (and therefore every React memo key derived from it) keeps the bogus value.
    expect(nav.getCoverArtUrl(BASE, "alice", cred, "al-1", -1)).toBe(
      "cover://localhost/cover/al-1?size=-1"
    );
    expect(nav.getCoverArtUrl(BASE, "alice", cred, "al-1", Number.NaN)).toBe(
      "cover://localhost/cover/al-1?size=NaN"
    );
  });
});

describe("isCoverServerReady", () => {
  it("starts false and is one-way", () => {
    expect(nav.isCoverServerReady()).toBe(false);
    nav.initCoverServer();
    expect(nav.isCoverServerReady()).toBe(true);
    // No reset exists. If one is added, the server-switch follow-up above is addressable.
    expect("resetCoverServer" in nav).toBe(false);
  });
});

describe("getArtistImageUrl", () => {
  it("returns the source URL unchanged before the cover server is ready", () => {
    const src = "https://lastfm.example/img.jpg?x=1";
    expect(nav.getArtistImageUrl(src)).toBe(src);
  });

  it("returns an empty string unchanged before ready", () => {
    // Currently unreachable: both call sites guard on a falsy portrait URL.
    expect(nav.getArtistImageUrl("")).toBe("");
  });

  it("collapses the whole source URL into one cover:// path segment once ready", () => {
    nav.initCoverServer();
    const src = "https://lastfm.example/img.jpg?x=1";
    expect(nav.getArtistImageUrl(src)).toBe(
      "cover://localhost/artist-image/https%3A%2F%2Flastfm.example%2Fimg.jpg%3Fx%3D1"
    );
  });

  it("encodes an ampersand in the source query so it cannot split into a second param", () => {
    nav.initCoverServer();
    const url = nav.getArtistImageUrl("https://h/i?a=1&b=2");
    expect(url).not.toContain("&");
    expect(decodeURIComponent(url.slice("cover://localhost/artist-image/".length))).toBe(
      "https://h/i?a=1&b=2"
    );
  });

  it("double-encodes an already-percent-encoded source, and Rust's single decode undoes it", () => {
    nav.initCoverServer();
    const src = "https://h/Bj%C3%B6rk.jpg";
    const url = nav.getArtistImageUrl(src);
    expect(url).toContain("Bj%25C3%25B6rk.jpg");
    expect(decodeURIComponent(url.slice("cover://localhost/artist-image/".length))).toBe(src);
  });

  it("never leaves a bare % that is not the start of an escape", () => {
    nav.initCoverServer();
    const url = nav.getArtistImageUrl("https://h/a%.jpg");
    expect(/%(?![0-9A-Fa-f]{2})/.test(url)).toBe(false);
  });

  it("produces an empty trailing segment for an empty source once ready", () => {
    nav.initCoverServer();
    expect(nav.getArtistImageUrl("")).toBe("cover://localhost/artist-image/");
  });
});

describe("updateCoverProxyConfig", () => {
  /** The single argument object handed to the nth `set_cover_proxy_config` invoke. */
  function proxyArgs(n = 0): { baseUrl: string; authParams: string } {
    const calls = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "set_cover_proxy_config");
    return calls[n]![1] as { baseUrl: string; authParams: string };
  }

  it("normalizes the base URL and flattens the auth params to a query string", async () => {
    await nav.updateCoverProxyConfig(`${BASE}/rest/`, "alice", cred);
    expect(proxyArgs()).toEqual({
      baseUrl: "http://music.example",
      authParams: "u=alice&t=tok&s=slt&v=1.16.1&c=canon&f=json",
    });
  });

  it("encodes a space in the username as + inside the flat param string", async () => {
    // Rust concatenates authParams into an upstream query verbatim, where + means space.
    await nav.updateCoverProxyConfig(BASE, "al ice", cred);
    expect(proxyArgs().authParams).toContain("u=al+ice");
  });

  it("carries apiKey and no t/s for an api key credential", async () => {
    await nav.updateCoverProxyConfig(BASE, "alice", apiKeyCred);
    const p = new URLSearchParams(proxyArgs().authParams);
    expect(p.get("apiKey")).toBe("key-123");
    expect(p.has("t")).toBe(false);
  });

  it("propagates an invoke failure instead of swallowing it", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("no such command"));
    await expect(nav.updateCoverProxyConfig(BASE, "alice", cred)).rejects.toThrow(
      "no such command"
    );
  });
});

describe("authenticate credential generation", () => {
  /** Body of the nth fetch, parsed. */
  function sentBody(fetchMock: ReturnType<typeof vi.fn>, n = 0): URLSearchParams {
    return new URLSearchParams((fetchMock.mock.calls[n]![1] as RequestInit).body as string);
  }

  function okPing(): Response {
    return new Response(JSON.stringify({ "subsonic-response": { status: "ok" } }), { status: 200 });
  }

  function stubFetch(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async () => okPing());
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  /** Deterministic 8-byte RNG, so the salt and therefore the token are fixed. */
  function stubRandom(bytes: number[]): void {
    vi.stubGlobal("crypto", {
      ...globalThis.crypto,
      getRandomValues: (a: Uint8Array) => {
        a.set(bytes);
        return a;
      },
    });
  }

  it("returns a 16-char lowercase hex salt", async () => {
    stubFetch();
    const c = await nav.authenticate(BASE, "alice", "sesame");
    expect(c.type).toBe("md5");
    expect(c.type === "md5" && c.salt).toMatch(/^[0-9a-f]{16}$/);
    vi.unstubAllGlobals();
  });

  it("zero-pads each random byte, so a leading zero byte does not shorten the salt", async () => {
    stubRandom([0x00, 0x0f, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    stubFetch();
    const c = await nav.authenticate(BASE, "alice", "sesame");
    expect(c.type === "md5" && c.salt).toBe("000f00010203" + "0405");
    vi.unstubAllGlobals();
  });

  it("sets t to md5(password + salt) for the salt it actually sent", async () => {
    const fetchMock = stubFetch();
    const c = await nav.authenticate(BASE, "alice", "sesame");
    const sentSalt = sentBody(fetchMock).get("s")!;
    expect(sentBody(fetchMock).get("t")).toBe(md5("sesame" + sentSalt));
    expect(c.type === "md5" && c.token).toBe(md5("sesame" + sentSalt));
    vi.unstubAllGlobals();
  });

  it("matches the Subsonic spec vector for password sesame and salt c19b2d", () => {
    // generateSalt always yields 16 chars, so the spec's 6-char salt cannot come out of
    // it. Pin the hash itself as the anchor for the scheme.
    expect(md5("sesame" + "c19b2d")).toBe("26719a1196d2a940705a59634eb18eab");
  });

  it("produces a known token for a fixed salt", async () => {
    stubRandom([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77]);
    stubFetch();
    const c = await nav.authenticate(BASE, "alice", "password");
    expect(c.type === "md5" && c.salt).toBe("0011223344556677");
    expect(c.type === "md5" && c.token).toBe("5a2003658ab58e3063203be3a03703be");
    vi.unstubAllGlobals();
  });

  it("hashes the UTF-8 bytes of a unicode password", async () => {
    stubRandom([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77]);
    stubFetch();
    const c = await nav.authenticate(BASE, "alice", "pä&ss");
    expect(c.type === "md5" && c.token).toBe("9d403c2f973a5463d065f055ec2cbf31");
    vi.unstubAllGlobals();
  });

  it("never sends the password itself, only the token", async () => {
    const fetchMock = stubFetch();
    await nav.authenticate(BASE, "alice", "a&b=c");
    const raw = (fetchMock.mock.calls[0]![1] as RequestInit).body as string;
    expect(raw).not.toContain("a%26b");
    expect(raw).not.toContain("a&b");
    expect(new URLSearchParams(raw).get("t")).toMatch(/^[0-9a-f]{32}$/);
    vi.unstubAllGlobals();
  });

  it("draws a fresh salt on every call", async () => {
    stubFetch();
    const a = await nav.authenticate(BASE, "alice", "sesame");
    const b = await nav.authenticate(BASE, "alice", "sesame");
    expect(a.type === "md5" && b.type === "md5" && a.salt).not.toBe(b.type === "md5" && b.salt);
    expect(a.type === "md5" && b.type === "md5" && a.token).not.toBe(
      b.type === "md5" && b.token
    );
    vi.unstubAllGlobals();
  });

  it("sends the same v/c/f literals it hand-writes as buildAuthParams does", async () => {
    // authenticate duplicates the client-identity literals instead of calling
    // buildAuthParams. A protocol bump applied to one and not the other would break
    // login while leaving every other call working.
    const fetchMock = stubFetch();
    await nav.authenticate(BASE, "alice", "sesame");
    const sent = sentBody(fetchMock);
    const built = params(nav.getStreamUrl(BASE, "alice", cred, "tr-1"));
    for (const key of ["v", "c", "f"]) {
      expect(sent.get(key)).toBe(built.get(key));
    }
    vi.unstubAllGlobals();
  });

  it("posts to <base>/rest/ping.view, not authenticate.view", async () => {
    const fetchMock = stubFetch();
    await nav.authenticate(BASE, "alice", "sesame");
    expect(fetchMock.mock.calls[0]![0]).toBe("http://music.example/rest/ping.view");
    vi.unstubAllGlobals();
  });
});
