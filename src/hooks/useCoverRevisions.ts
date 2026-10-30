import { useCallback, useSyncExternalStore } from "react";
import { subscribeCoverRevisions, withCoverRevision } from "../clients/navidromeUrls";

/** `url` with the album's current chosen-cover revision; re-renders only when that URL changes. */
export function useCoverUrl(url: string): string;
export function useCoverUrl(url: string | undefined): string | undefined;
export function useCoverUrl(url: string | null): string | null;
export function useCoverUrl(url: string | null | undefined): string | null | undefined;
export function useCoverUrl(url: string | null | undefined): string | null | undefined {
  const revisedUrl = useCallback(() => (typeof url === "string" ? withCoverRevision(url) : url), [url]);
  return useSyncExternalStore(subscribeCoverRevisions, revisedUrl);
}
