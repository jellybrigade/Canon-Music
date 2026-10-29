import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../clients/coverArtArchive", () => ({ fetchCaaFrontCovers: vi.fn() }));
vi.mock("../../clients/fanart", () => ({ fetchFanartAlbumCovers: vi.fn(), getFanartApiKey: vi.fn() }));
vi.mock("../../clients/itunes", () => ({ fetchItunesAlbumCovers: vi.fn() }));
vi.mock("../../clients/musicbrainz", () => ({ lookupRelease: vi.fn() }));

import { fetchCaaFrontCovers } from "../../clients/coverArtArchive";
import { fetchFanartAlbumCovers, getFanartApiKey } from "../../clients/fanart";
import { fetchItunesAlbumCovers } from "../../clients/itunes";
import { lookupRelease } from "../../clients/musicbrainz";
import { type CoverCandidate, findCoverCandidates, rankCoverCandidates, type SourceResult } from "./coverCandidates";

function candidate(overrides: Partial<CoverCandidate>): CoverCandidate {
  return {
    source: "itunes",
    sourceRef: null,
    fullUrl: "https://x/full.jpg",
    thumbUrl: "https://x/thumb.jpg",
    width: null,
    height: null,
    isApproved: true,
    ...overrides,
  };
}

function found(source: SourceResult["source"], candidates: CoverCandidate[]): SourceResult {
  return { source, status: "found", candidates };
}

const lookup = { artist: "Artist", album: "Album", releaseMbid: "rel-1", releaseGroupMbid: "rg-1" };

beforeEach(() => {
  vi.mocked(fetchCaaFrontCovers).mockReset().mockResolvedValue([]);
  vi.mocked(fetchFanartAlbumCovers).mockReset().mockResolvedValue([]);
  vi.mocked(getFanartApiKey).mockReset().mockResolvedValue("key");
  vi.mocked(fetchItunesAlbumCovers).mockReset().mockResolvedValue([]);
  vi.mocked(lookupRelease).mockReset();
});

describe("rankCoverCandidates", () => {
  it("puts the release's own fronts first, then its release group, fanart.tv, iTunes", () => {
    const ranked = rankCoverCandidates([
      found("itunes", [candidate({ source: "itunes", fullUrl: "https://i" })]),
      found("fanart", [candidate({ source: "fanart", fullUrl: "https://f" })]),
      found("caa-release-group", [candidate({ source: "caa-release-group", fullUrl: "https://g" })]),
      found("caa-release", [candidate({ source: "caa-release", fullUrl: "https://r" })]),
    ]);
    expect(ranked.map((c) => c.fullUrl)).toEqual(["https://r", "https://g", "https://f", "https://i"]);
  });

  it("puts approved archive images ahead of unapproved ones within a source", () => {
    const ranked = rankCoverCandidates([
      found("caa-release", [
        candidate({ source: "caa-release", fullUrl: "https://pending", isApproved: false }),
        candidate({ source: "caa-release", fullUrl: "https://approved" }),
      ]),
    ]);
    expect(ranked.map((c) => c.fullUrl)).toEqual(["https://approved", "https://pending"]);
  });

  it("shows an image two sources share once, under the better source", () => {
    const ranked = rankCoverCandidates([
      found("caa-release-group", [candidate({ source: "caa-release-group", fullUrl: "https://same" })]),
      found("caa-release", [candidate({ source: "caa-release", fullUrl: "https://same" })]),
    ]);
    expect(ranked).toEqual([expect.objectContaining({ source: "caa-release" })]);
  });

  it("drops images known to be too small or far from square, and keeps unmeasured ones", () => {
    const ranked = rankCoverCandidates([
      found("fanart", [
        candidate({ source: "fanart", fullUrl: "https://small", width: 200, height: 200 }),
        candidate({ source: "fanart", fullUrl: "https://wide", width: 1000, height: 800 }),
        candidate({ source: "fanart", fullUrl: "https://near", width: 1000, height: 990 }),
        candidate({ source: "fanart", fullUrl: "https://unknown" }),
      ]),
    ]);
    expect(ranked.map((c) => c.fullUrl)).toEqual(["https://near", "https://unknown"]);
  });

  it("ignores sources that failed or were skipped", () => {
    expect(
      rankCoverCandidates([
        { source: "fanart", status: "skipped", candidates: [], reason: "No fanart.tv key" },
        { source: "itunes", status: "failed", candidates: [], reason: "iTunes returned 503" },
      ]),
    ).toEqual([]);
  });
});

describe("findCoverCandidates", () => {
  it("asks every source and reports each one's outcome", async () => {
    vi.mocked(fetchCaaFrontCovers).mockImplementation(async (kind) =>
      kind === "release"
        ? [{ originalUrl: "https://o", thumbUrl: "https://t", fullUrl: "https://r1200", isApproved: true }]
        : [],
    );
    vi.mocked(fetchItunesAlbumCovers).mockRejectedValue(new Error("iTunes returned 503"));

    const results = await findCoverCandidates(lookup);

    expect(results.map(({ source, status }) => ({ source, status }))).toEqual([
      { source: "caa-release", status: "found" },
      { source: "caa-release-group", status: "found" },
      { source: "fanart", status: "found" },
      { source: "itunes", status: "failed" },
    ]);
    expect(results[0]?.candidates[0]).toMatchObject({ fullUrl: "https://r1200", sourceRef: "release:rel-1" });
    expect(results[3]).toMatchObject({ reason: "iTunes returned 503" });
    expect(fetchFanartAlbumCovers).toHaveBeenCalledWith("rg-1", "key");
  });

  it("skips fanart.tv without a key, and reports a locked secret store as a failure", async () => {
    vi.mocked(getFanartApiKey).mockResolvedValue(null);
    expect((await findCoverCandidates(lookup))[2]).toMatchObject({ source: "fanart", status: "skipped" });

    vi.mocked(getFanartApiKey).mockRejectedValue(new Error("secret store locked"));
    expect((await findCoverCandidates(lookup))[2]).toMatchObject({ source: "fanart", status: "failed" });
    expect(fetchFanartAlbumCovers).not.toHaveBeenCalled();
  });

  it("finds the release group through the release when only the release is known", async () => {
    vi.mocked(lookupRelease).mockResolvedValue({ releaseGroupId: "rg-from-release" } as never);
    await findCoverCandidates({ ...lookup, releaseGroupMbid: null });
    expect(fetchCaaFrontCovers).toHaveBeenCalledWith("release-group", "rg-from-release");
    expect(fetchFanartAlbumCovers).toHaveBeenCalledWith("rg-from-release", "key");
  });

  it("reports the release-group sources failed when that lookup fails, keeping the release's own", async () => {
    vi.mocked(lookupRelease).mockRejectedValue(new Error("MusicBrainz release/rel-1 returned 503"));
    const results = await findCoverCandidates({ ...lookup, releaseGroupMbid: null });
    expect(results.map(({ source, status }) => ({ source, status }))).toEqual([
      { source: "caa-release", status: "found" },
      { source: "caa-release-group", status: "failed" },
      { source: "fanart", status: "failed" },
      { source: "itunes", status: "found" },
    ]);
  });

  it("asks only iTunes for an album never identified", async () => {
    const results = await findCoverCandidates({ ...lookup, releaseMbid: null, releaseGroupMbid: null });
    expect(results.map(({ source, status }) => ({ source, status }))).toEqual([
      { source: "caa-release", status: "skipped" },
      { source: "caa-release-group", status: "skipped" },
      { source: "fanart", status: "skipped" },
      { source: "itunes", status: "found" },
    ]);
    expect(fetchCaaFrontCovers).not.toHaveBeenCalled();
  });
});
