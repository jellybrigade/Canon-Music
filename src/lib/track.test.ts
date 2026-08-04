import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/mocks/tauri")).coreModule);

import { makeStreamUrlBuilder } from "./track";
import { setStreamMaxBitrate, type NavidromeCredential } from "./navidrome";
import type { Server } from "../types/server";
import type { CurrentTrack } from "../store/player";

function makeServer(overrides: Partial<Server> = {}): Server {
  return {
    id: "srv1",
    type: "navidrome",
    url: "http://music.example",
    alt_url: null,
    display_name: "Music",
    username: "alice",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const md5Cred: NavidromeCredential = { type: "md5", token: "tok", salt: "slt" };
const apiKeyCred: NavidromeCredential = { type: "apikey", apiKey: "key-123" };

function makeTrack(id: string): CurrentTrack {
  return { id, title: "Title", artist: "Artist", duration: 100 };
}

/** Parse the query string of a built stream URL. */
function params(url: string): URLSearchParams {
  return new URLSearchParams(url.slice(url.indexOf("?") + 1));
}

beforeEach(() => {
  setStreamMaxBitrate(0);
});

afterEach(() => {
  setStreamMaxBitrate(0);
});

describe("makeStreamUrlBuilder", () => {
  it("strips the server prefix and sends the bare Navidrome id", () => {
    const build = makeStreamUrlBuilder(makeServer(), md5Cred);
    const url = build(makeTrack("srv1:abc"));
    expect(url.startsWith("http://music.example/rest/stream?")).toBe(true);
    expect(params(url).get("id")).toBe("abc");
  });

  it("returns a builder without inspecting any track id up front", () => {
    // The throw below belongs to calling the builder, not to constructing it: a bad
    // server/track pairing must not blow up at wiring time.
    expect(() => makeStreamUrlBuilder(makeServer(), md5Cred)).not.toThrow();
  });

  it("throws when the track belongs to a different server", () => {
    const build = makeStreamUrlBuilder(makeServer({ id: "srv1" }), md5Cred);
    expect(() => build(makeTrack("srv2:abc"))).toThrow();
  });

  it("throws on an id carrying no server prefix at all", () => {
    const build = makeStreamUrlBuilder(makeServer(), md5Cred);
    expect(() => build(makeTrack("abc"))).toThrow();
  });

  it("keeps everything after the first colon, including further colons", () => {
    const build = makeStreamUrlBuilder(makeServer(), md5Cred);
    expect(params(build(makeTrack("srv1:foo:bar"))).get("id")).toBe("foo:bar");
  });

  it("emits an empty id rather than inventing one when the id is only a prefix", () => {
    const build = makeStreamUrlBuilder(makeServer(), md5Cred);
    expect(params(build(makeTrack("srv1:"))).get("id")).toBe("");
  });

  it("percent-encodes ids containing url-significant characters", () => {
    const build = makeStreamUrlBuilder(makeServer(), md5Cred);
    const url = build(makeTrack("srv1:a+b&c/d e"));
    expect(url).not.toContain("a+b&c/d e");
    expect(params(url).get("id")).toBe("a+b&c/d e");
  });

  it("round-trips a unicode id", () => {
    const build = makeStreamUrlBuilder(makeServer(), md5Cred);
    expect(params(build(makeTrack("srv1:ロック"))).get("id")).toBe("ロック");
  });

  it("carries md5 token and salt as auth params", () => {
    const build = makeStreamUrlBuilder(makeServer(), md5Cred);
    const p = params(build(makeTrack("srv1:abc")));
    expect(p.get("u")).toBe("alice");
    expect(p.get("t")).toBe("tok");
    expect(p.get("s")).toBe("slt");
    expect(p.get("apiKey")).toBeNull();
  });

  it("carries an api key instead of token/salt when the credential is an api key", () => {
    const build = makeStreamUrlBuilder(makeServer(), apiKeyCred);
    const p = params(build(makeTrack("srv1:abc")));
    expect(p.get("apiKey")).toBe("key-123");
    expect(p.get("t")).toBeNull();
    expect(p.get("s")).toBeNull();
  });

  it("normalizes a base url with trailing slashes into a single /rest/stream path", () => {
    const build = makeStreamUrlBuilder(makeServer({ url: "http://music.example///" }), md5Cred);
    expect(build(makeTrack("srv1:abc"))).toContain("http://music.example/rest/stream?");
  });

  it("normalizes a base url that already ends in /rest", () => {
    const build = makeStreamUrlBuilder(makeServer({ url: "http://music.example/rest" }), md5Cred);
    const url = build(makeTrack("srv1:abc"));
    expect(url).toContain("http://music.example/rest/stream?");
    expect(url).not.toContain("/rest/rest");
  });

  it("omits maxBitRate when the transcode cap is 0", () => {
    const build = makeStreamUrlBuilder(makeServer(), md5Cred);
    expect(params(build(makeTrack("srv1:abc"))).get("maxBitRate")).toBeNull();
  });

  it("applies a maxBitRate set after the builder was created", () => {
    // The builder closes over the server, not over the URL, so a settings change reaches
    // builders that already exist. A cached URL string would silently ignore it.
    const build = makeStreamUrlBuilder(makeServer(), md5Cred);
    expect(params(build(makeTrack("srv1:abc"))).get("maxBitRate")).toBeNull();
    setStreamMaxBitrate(192);
    expect(params(build(makeTrack("srv1:abc"))).get("maxBitRate")).toBe("192");
  });

  it("is stable across calls for the same track", () => {
    const build = makeStreamUrlBuilder(makeServer(), md5Cred);
    const track = makeTrack("srv1:abc");
    expect(build(track)).toBe(build(track));
  });

  it("treats an empty server id as a bare colon prefix", () => {
    const build = makeStreamUrlBuilder(makeServer({ id: "" }), md5Cred);
    expect(params(build(makeTrack(":abc"))).get("id")).toBe("abc");
    expect(() => build(makeTrack("abc"))).toThrow();
  });
});
