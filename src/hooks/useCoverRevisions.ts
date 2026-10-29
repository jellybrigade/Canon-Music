import { useSyncExternalStore } from "react";
import { getCoverRevisionsVersion, subscribeCoverRevisions } from "../clients/navidromeUrls";

/** Re-renders when a chosen album cover changes, for views that build cover URLs during render. */
export function useCoverRevisions(): number {
  return useSyncExternalStore(subscribeCoverRevisions, getCoverRevisionsVersion);
}
