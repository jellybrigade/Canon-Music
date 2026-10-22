import { describe, expect, it } from "vitest";
import { resolveResumeIndex } from "./playlistResume";

const rows = (...ids: string[]) => ids.map((id) => ({ id }));

describe("resolveResumeIndex", () => {
  it("keeps the stored position while it still holds the stored track", () => {
    expect(resolveResumeIndex(rows("a", "b", "b"), { lastTrackId: "b", trackPosition: 2 })).toBe(2);
  });

  it("follows the track when an earlier removal shifted it up", () => {
    expect(resolveResumeIndex(rows("b", "c", "d"), { lastTrackId: "c", trackPosition: 2 })).toBe(1);
  });

  it("follows the track to the nearest copy of a duplicate", () => {
    expect(resolveResumeIndex(rows("c", "x", "y", "c"), { lastTrackId: "c", trackPosition: 4 })).toBe(3);
  });

  it("gives up when the track is no longer in the playlist", () => {
    expect(resolveResumeIndex(rows("a", "b"), { lastTrackId: "z", trackPosition: 1 })).toBeNull();
  });
});
