import { describe, it, expect } from "vitest";
import { mostPlayedHere } from "./artist-ranking";

function track(title: string, play_count: number | null, played_at: string | null = null) {
  return { id: `id-${title}`, title, play_count, played_at };
}

describe("mostPlayedHere", () => {
  it("ranks by the server's play count, highest first", () => {
    const ranked = mostPlayedHere([track("a", 2), track("b", 9), track("c", 5)], 10);
    expect(ranked.map((t) => t.title)).toEqual(["b", "c", "a"]);
  });

  it("drops tracks nobody here has played", () => {
    const ranked = mostPlayedHere([track("played", 1), track("never", 0), track("unknown", null)], 10);
    expect(ranked.map((t) => t.title)).toEqual(["played"]);
  });

  it("breaks a play-count tie on the most recent play", () => {
    const ranked = mostPlayedHere(
      [track("older", 4, "2026-01-01T00:00:00Z"), track("newer", 4, "2026-06-01T00:00:00Z")],
      10
    );
    expect(ranked.map((t) => t.title)).toEqual(["newer", "older"]);
  });

  it("puts a track with no last-played stamp behind one that has it", () => {
    const ranked = mostPlayedHere([track("unstamped", 4), track("stamped", 4, "2020-01-01T00:00:00Z")], 10);
    expect(ranked.map((t) => t.title)).toEqual(["stamped", "unstamped"]);
  });

  it("settles a full tie on the title, so two runs agree", () => {
    const same = "2026-01-01T00:00:00Z";
    const ranked = mostPlayedHere([track("beta", 3, same), track("alpha", 3, same)], 10);
    expect(ranked.map((t) => t.title)).toEqual(["alpha", "beta"]);
  });

  it("caps the list at the limit", () => {
    const ranked = mostPlayedHere([track("a", 5), track("b", 4), track("c", 3)], 2);
    expect(ranked.map((t) => t.title)).toEqual(["a", "b"]);
  });

  it("returns nothing for an artist with no tracks at all", () => {
    expect(mostPlayedHere([], 5)).toEqual([]);
  });

  it("leaves the input array untouched", () => {
    const input = [track("a", 1), track("b", 9)];
    mostPlayedHere(input, 5);
    expect(input.map((t) => t.title)).toEqual(["a", "b"]);
  });
});
