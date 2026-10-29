import { useSyncExternalStore } from "react";
import { getCoverRevisionsVersion, subscribeCoverRevisions, withCoverRevision } from "../clients/navidromeUrls";

/** Re-renders when a chosen album cover changes, for views that build cover URLs during render. */
export function useCoverRevisions(): number {
  return useSyncExternalStore(subscribeCoverRevisions, getCoverRevisionsVersion);
}

/** `url` with the album's current chosen-cover revision, kept current while mounted. */
export function useCoverUrl(url: string): string;
export function useCoverUrl(url: string | undefined): string | undefined;
export function useCoverUrl(url: string | null | undefined): string | null | undefined;
export function useCoverUrl(url: string | null | undefined): string | null | undefined {
  useCoverRevisions();
  return typeof url === "string" ? withCoverRevision(url) : url;
}
