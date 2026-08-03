import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { primaryArtistOf } from "./now-playing-queries";

describe("primaryArtistOf", () => {
  it("returns null for null, undefined, and empty string", () => {
    expect(primaryArtistOf(null)).toBeNull();
    expect(primaryArtistOf(undefined)).toBeNull();
    expect(primaryArtistOf("")).toBeNull();
  });

  it("strips a 'feat.' suffix", () => {
    expect(primaryArtistOf("Burial feat. Four Tet")).toBe("Burial");
  });

  it("strips a 'ft.' suffix", () => {
    expect(primaryArtistOf("Burial ft. Four Tet")).toBe("Burial");
  });

  it("strips a 'featuring' suffix", () => {
    expect(primaryArtistOf("Burial featuring Four Tet")).toBe("Burial");
  });

  it("matches the feat. keyword case-insensitively", () => {
    expect(primaryArtistOf("Burial FEAT. Four Tet")).toBe("Burial");
  });

  it("does not split on '&' or ',' - only feat./ft./featuring are handled", () => {
    expect(primaryArtistOf("X & Y")).toBe("X & Y");
    expect(primaryArtistOf("X, Y")).toBe("X, Y");
  });

  it("returns the original string unchanged when there is no feat. keyword", () => {
    expect(primaryArtistOf("Radiohead")).toBe("Radiohead");
  });

  it("cuts at the first feat. keyword when there are multiple", () => {
    expect(primaryArtistOf("A feat. B feat. C")).toBe("A");
  });

  it("does not trim surrounding whitespace", () => {
    expect(primaryArtistOf("  Burial  ")).toBe("  Burial  ");
  });
});

describe("regression: prefetch/consumer key parity", () => {
  // known-issues.md: "A prefetch that duplicates a query instead of sharing it warms a key
  // nobody reads" - useNowPlayingPrefetch used to hold its own copy of NowPlayingView's query
  // fns/keys/staleTime, keyed on the raw artist name instead of primaryArtistOf's stripped one,
  // so "X feat. Y" tracks never hit their own prefetch. A component-mount test can't see an
  // import statement; asserting on the source text is what actually catches a reintroduced copy.
  const sharedExports = [
    "primaryArtistOf",
    "fetchArtistAlbums",
    "fetchArtistTopTracksForNowPlaying",
    "fetchSuggestedTracksForNowPlaying",
    "NOW_PLAYING_STALE_TIME",
    "SUGGESTED_STALE_TIME",
  ];

  function importsSharedModule(source: string): boolean {
    const match = source.match(/import\s*{([^}]+)}\s*from\s*["'].*now-playing-queries["']/);
    const captured = match?.[1];
    if (!captured) return false;
    const named = captured.split(",").map((s) => s.trim());
    return sharedExports.every((name) => named.includes(name));
  }

  it("useNowPlayingPrefetch imports every query building block from the shared module", () => {
    const source = readFileSync(new URL("../hooks/useNowPlayingPrefetch.ts", import.meta.url), "utf-8");
    expect(importsSharedModule(source)).toBe(true);
  });

  it("NowPlayingView imports the same building blocks, not a local re-declaration", () => {
    const source = readFileSync(new URL("../components/NowPlayingView.tsx", import.meta.url), "utf-8");
    expect(importsSharedModule(source)).toBe(true);
  });

  it("neither consumer hardcodes its own numeric staleTime for these queries", () => {
    const prefetch = readFileSync(new URL("../hooks/useNowPlayingPrefetch.ts", import.meta.url), "utf-8");
    const view = readFileSync(new URL("../components/NowPlayingView.tsx", import.meta.url), "utf-8");
    for (const source of [prefetch, view]) {
      const staleTimeValues = [...source.matchAll(/staleTime:\s*([^,\n]+)/g)].map((m) => (m[1] ?? "").trim());
      for (const value of staleTimeValues) {
        expect(value).toMatch(/^(NOW_PLAYING_STALE_TIME|SUGGESTED_STALE_TIME)$/);
      }
    }
  });
});
