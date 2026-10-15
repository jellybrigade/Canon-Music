import { describe, expect, it, vi } from "vitest";

vi.mock("../../../clients/musicbrainz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../clients/musicbrainz")>()),
  searchReleaseGroups: vi.fn(),
  lookupReleaseGroup: vi.fn(),
  lookupRelease: vi.fn(),
}));

import {
  lookupRelease,
  lookupReleaseGroup,
  type MbReleaseGroupCandidate,
  searchReleaseGroups,
} from "../../../clients/musicbrainz";
import {
  AUTO_IDENTIFY_RETRY_SECONDS,
  autoIdentifyAlbum,
  needsAutoIdentify,
  stripTrailingBrackets,
} from "./albumIdentify";

describe("stripTrailingBrackets", () => {
  it("strips a trailing parenthesized suffix", () => {
    expect(stripTrailingBrackets("Album (Deluxe Edition)")).toBe("Album");
  });

  it("strips a trailing bracketed suffix", () => {
    expect(stripTrailingBrackets("Album [Remastered]")).toBe("Album");
  });

  it("returns null when there is no trailing bracket group", () => {
    expect(stripTrailingBrackets("Album")).toBeNull();
  });

  it("returns null instead of an empty string when the whole title is the bracket group", () => {
    expect(stripTrailingBrackets("(Live)")).toBeNull();
  });

  it("does not strip a bracket group that isn't at the end of the string", () => {
    expect(stripTrailingBrackets("(Live) Album")).toBeNull();
  });

  it("strips from the first opening bracket through the end on multiple trailing groups", () => {
    // Lazy `.*?` still has to reach end-of-string, so it spans both groups, not just the last.
    expect(stripTrailingBrackets("Album (Live) [Remastered]")).toBe("Album");
  });

  it("strips a nested bracket group anchored at the end", () => {
    expect(stripTrailingBrackets("Album (Deluxe [2020] Edition)")).toBe("Album");
  });

  it("allows mismatched bracket/paren delimiters to still close the group", () => {
    expect(stripTrailingBrackets("Album (Live]")).toBe("Album");
  });

  it("returns null when brackets are mismatched but not at the true end", () => {
    expect(stripTrailingBrackets("Album (Live] mismatched")).toBeNull();
  });
});

function releaseGroup(id: string, primaryType: string): MbReleaseGroupCandidate {
  return {
    id,
    title: "Fresh Album",
    firstReleaseDate: "2026-09-01",
    primaryType,
    artistName: "Some Artist",
    artistMbid: "artist-mbid",
    score: 100,
  };
}

describe("autoIdentifyAlbum", () => {
  it("confirms the album when its same-titled lead single ties on score", async () => {
    vi.mocked(searchReleaseGroups).mockResolvedValue([
      releaseGroup("single", "Single"),
      releaseGroup("album", "Album"),
    ]);
    vi.mocked(lookupReleaseGroup).mockResolvedValue({
      ...releaseGroup("album", "Album"),
      genres: [],
      tags: [],
      releases: [{ id: "release", title: "Fresh Album", date: "2026-09-01", country: null }],
    });
    vi.mocked(lookupRelease).mockResolvedValue({
      id: "release",
      title: "Fresh Album",
      date: "2026-09-01",
      country: null,
      label: null,
      catalogNumber: null,
      barcode: null,
      genres: [],
      tags: [],
      trackCount: 2,
    });

    const result = await autoIdentifyAlbum({ artist: "Some Artist", album: "Fresh Album", trackCount: 2, year: 2026 });

    expect(result.decision).toBe("auto_confirmed");
    expect(result.detail?.id).toBe("album");
  });
});

describe("needsAutoIdentify", () => {
  const now = 10_000_000;
  const row = (over: Partial<Parameters<typeof needsAutoIdentify>[0] & object>) => ({
    mb_release_group_id: null,
    confirmed_at: null,
    looked_up_at: now,
    ...over,
  });

  it("looks up an album with no identity row", () => {
    expect(needsAutoIdentify(null, now)).toBe(true);
  });

  it("leaves a recent failed lookup alone", () => {
    expect(needsAutoIdentify(row({ looked_up_at: now - 60 }), now)).toBe(false);
  });

  it("retries a failed lookup once it is old enough", () => {
    expect(needsAutoIdentify(row({ looked_up_at: now - AUTO_IDENTIFY_RETRY_SECONDS }), now)).toBe(true);
  });

  it("never retries a matched album", () => {
    expect(needsAutoIdentify(row({ mb_release_group_id: "rg", looked_up_at: 0 }), now)).toBe(false);
  });

  it("never retries an album the user confirmed as unmatched", () => {
    expect(needsAutoIdentify(row({ confirmed_at: 1, looked_up_at: 0 }), now)).toBe(false);
  });
});
