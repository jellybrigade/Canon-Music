import { describe, expect, it } from "vitest";
import type { CurrentTrack } from "../store/playerTypes";
import { defaultQueuePlaylistName } from "./queuePlaylistName";

const seed: CurrentTrack = { id: "s1:t1", title: "Windowlicker", artist: "Aphex Twin", duration: 360 };
const now = new Date(2026, 10, 9);

describe("defaultQueuePlaylistName", () => {
  it("names a radio queue by its seed", () => {
    expect(defaultQueuePlaylistName(seed, now)).toBe("Windowlicker");
  });

  it("names any other queue by the day it was saved", () => {
    expect(defaultQueuePlaylistName(null, now)).toBe(`Queue ${now.toLocaleDateString()}`);
  });
});
