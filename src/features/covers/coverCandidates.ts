import { fetchCaaFrontCovers } from "../../clients/coverArtArchive";
import { fetchFanartAlbumCovers, getFanartApiKey } from "../../clients/fanart";
import { fetchItunesAlbumCovers } from "../../clients/itunes";
import { lookupRelease } from "../../clients/musicbrainz";
import { errorMessage } from "../../lib/errorMessage";
import type { CoverChoice } from "./albumCoverOverrides";

export const COVER_SOURCES = ["caa-release", "caa-release-group", "fanart", "itunes"] as const;
export type CoverSource = (typeof COVER_SOURCES)[number];

export const COVER_SOURCE_LABELS: Record<CoverSource, string> = {
  "caa-release": "Cover Art Archive",
  "caa-release-group": "Cover Art Archive, other editions",
  fanart: "fanart.tv",
  itunes: "iTunes",
};

const FANART_COVER_EDGE = 1000;
// iTunes scales to the edge asked for in the URL, never past its own image.
const ITUNES_MAX_EDGE = 1200;
const NEEDS_IDENTITY = "Identify the album on MusicBrainz to search here";

export interface CoverCandidate extends CoverChoice {
  source: CoverSource;
  thumbUrl: string;
  /** The longest edge the source can deliver, shown until the image itself is measured. */
  maxEdge: number | null;
  isApproved: boolean;
}

export function isCoverSource(source: string): source is CoverSource {
  return COVER_SOURCES.some((known) => known === source);
}

export type SourceResult =
  | { source: CoverSource; status: "found"; candidates: CoverCandidate[] }
  | { source: CoverSource; status: "skipped" | "failed"; candidates: []; reason: string };

/** The stored fanart.tv key, or why fanart.tv can't be asked. */
export type FanartKeyRead = string | SourceResult;

export interface CoverLookup {
  artist: string;
  album: string;
  releaseMbid: string | null;
  releaseGroupMbid: string | null;
  fanartKey: FanartKeyRead;
}

/** Every found candidate, best source first, approved archive images first within a source, each image once. */
export function rankCoverCandidates(results: readonly SourceResult[]): CoverCandidate[] {
  const seen = new Set<string>();
  const ranked: CoverCandidate[] = [];
  for (const source of COVER_SOURCES) {
    const candidates = results.filter((result) => result.source === source).flatMap((result) => result.candidates);
    const ordered = [...candidates.filter((c) => c.isApproved), ...candidates.filter((c) => !c.isApproved)];
    for (const candidate of ordered) {
      if (seen.has(candidate.fullUrl)) continue;
      seen.add(candidate.fullUrl);
      ranked.push(candidate);
    }
  }
  return ranked;
}

async function settle(source: CoverSource, load: () => Promise<CoverCandidate[]>): Promise<SourceResult> {
  try {
    return { source, status: "found", candidates: await load() };
  } catch (err) {
    return failed(source, errorMessage(err));
  }
}

function skipped(source: CoverSource, reason: string): SourceResult {
  return { source, status: "skipped", candidates: [], reason };
}

function failed(source: CoverSource, reason: string): SourceResult {
  return { source, status: "failed", candidates: [], reason };
}

async function caaCandidates(kind: "release" | "release-group", mbid: string): Promise<CoverCandidate[]> {
  const covers = await fetchCaaFrontCovers(kind, mbid);
  return covers.map((cover) => ({
    source: kind === "release" ? "caa-release" : "caa-release-group",
    sourceRef: `${kind}:${mbid}`,
    fullUrl: cover.fullUrl,
    thumbUrl: cover.thumbUrl,
    width: null,
    height: null,
    maxEdge: cover.fullMaxEdge,
    isApproved: cover.isApproved,
  }));
}

/** The stored key, or why fanart.tv can't be asked: without a key nothing else about it matters. */
export async function readFanartKey(): Promise<FanartKeyRead> {
  try {
    return (await getFanartApiKey()) ?? skipped("fanart", "Add a fanart.tv key in Settings to search it");
  } catch (err) {
    return failed("fanart", errorMessage(err));
  }
}

function fanartCandidates(releaseGroupMbid: string, apiKey: string): Promise<SourceResult> {
  return settle("fanart", async () =>
    (await fetchFanartAlbumCovers(releaseGroupMbid, apiKey)).map((cover) => ({
      source: "fanart",
      sourceRef: `fanart:${cover.id}`,
      fullUrl: cover.fullUrl,
      thumbUrl: cover.thumbUrl,
      width: FANART_COVER_EDGE,
      height: FANART_COVER_EDGE,
      maxEdge: FANART_COVER_EDGE,
      isApproved: true,
    })),
  );
}

async function releaseGroupSources(lookup: CoverLookup): Promise<[SourceResult, SourceResult]> {
  const key = lookup.fanartKey;
  let releaseGroupMbid = lookup.releaseGroupMbid;
  if (releaseGroupMbid === null && lookup.releaseMbid !== null) {
    try {
      releaseGroupMbid = (await lookupRelease(lookup.releaseMbid)).releaseGroupId;
    } catch (err) {
      const reason = errorMessage(err);
      return [failed("caa-release-group", reason), typeof key === "string" ? failed("fanart", reason) : key];
    }
  }
  if (releaseGroupMbid === null) {
    return [
      skipped("caa-release-group", NEEDS_IDENTITY),
      typeof key === "string" ? skipped("fanart", NEEDS_IDENTITY) : key,
    ];
  }
  const mbid = releaseGroupMbid;
  const [releaseGroup, fanart] = await Promise.all([
    settle("caa-release-group", () => caaCandidates("release-group", mbid)),
    typeof key === "string" ? fanartCandidates(mbid, key) : key,
  ]);
  return [releaseGroup, fanart];
}

/** Asks every cover source at once; one source failing never hides another's answer. */
export async function findCoverCandidates(lookup: CoverLookup): Promise<SourceResult[]> {
  const { releaseMbid } = lookup;
  const [release, [releaseGroup, fanart], itunes] = await Promise.all([
    releaseMbid === null
      ? skipped("caa-release", NEEDS_IDENTITY)
      : settle("caa-release", () => caaCandidates("release", releaseMbid)),
    releaseGroupSources(lookup),
    settle("itunes", async () =>
      (await fetchItunesAlbumCovers(lookup.artist, lookup.album)).map((cover) => ({
        source: "itunes",
        sourceRef: null,
        fullUrl: cover.fullUrl,
        thumbUrl: cover.thumbUrl,
        width: null,
        height: null,
        maxEdge: ITUNES_MAX_EDGE,
        isApproved: true,
      })),
    ),
  ]);
  return [release, releaseGroup, fanart, itunes];
}
