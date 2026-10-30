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

export interface CoverCandidate extends CoverChoice {
  source: CoverSource;
  thumbUrl: string;
  isApproved: boolean;
}

export type SourceResult =
  | { source: CoverSource; status: "found"; candidates: CoverCandidate[] }
  | { source: CoverSource; status: "skipped" | "failed"; candidates: []; reason: string };

export interface CoverLookup {
  artist: string;
  album: string;
  releaseMbid: string | null;
  releaseGroupMbid: string | null;
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
    return { source, status: "failed", candidates: [], reason: errorMessage(err) };
  }
}

function skipped(source: CoverSource, reason: string): SourceResult {
  return { source, status: "skipped", candidates: [], reason };
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
    isApproved: cover.isApproved,
  }));
}

async function fanartCandidates(releaseGroupMbid: string): Promise<SourceResult> {
  let apiKey: string | null;
  try {
    apiKey = await getFanartApiKey();
  } catch (err) {
    return { source: "fanart", status: "failed", candidates: [], reason: errorMessage(err) };
  }
  if (apiKey === null) return skipped("fanart", "Add a fanart.tv key in Settings to search it");
  const key = apiKey;
  return settle("fanart", async () =>
    (await fetchFanartAlbumCovers(releaseGroupMbid, key)).map((cover) => ({
      source: "fanart",
      sourceRef: `fanart:${cover.id}`,
      fullUrl: cover.fullUrl,
      thumbUrl: cover.thumbUrl,
      width: FANART_COVER_EDGE,
      height: FANART_COVER_EDGE,
      isApproved: true,
    })),
  );
}

async function releaseGroupSources(lookup: CoverLookup): Promise<[SourceResult, SourceResult]> {
  let releaseGroupMbid = lookup.releaseGroupMbid;
  if (releaseGroupMbid === null && lookup.releaseMbid !== null) {
    try {
      releaseGroupMbid = (await lookupRelease(lookup.releaseMbid)).releaseGroupId;
    } catch (err) {
      const reason = errorMessage(err);
      return [
        { source: "caa-release-group", status: "failed", candidates: [], reason },
        { source: "fanart", status: "failed", candidates: [], reason },
      ];
    }
  }
  if (releaseGroupMbid === null) {
    const reason = "Identify the album on MusicBrainz to search here";
    return [skipped("caa-release-group", reason), skipped("fanart", reason)];
  }
  const mbid = releaseGroupMbid;
  return Promise.all([settle("caa-release-group", () => caaCandidates("release-group", mbid)), fanartCandidates(mbid)]);
}

/** Asks every cover source at once; one source failing never hides another's answer. */
export async function findCoverCandidates(lookup: CoverLookup): Promise<SourceResult[]> {
  const { releaseMbid } = lookup;
  const [release, [releaseGroup, fanart], itunes] = await Promise.all([
    releaseMbid === null
      ? skipped("caa-release", "Identify the album on MusicBrainz to search here")
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
        isApproved: true,
      })),
    ),
  ]);
  return [release, releaseGroup, fanart, itunes];
}
