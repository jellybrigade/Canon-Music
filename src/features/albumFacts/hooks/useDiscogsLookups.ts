import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getDb } from "../../../db";
import { useSetting } from "../../../hooks/useSetting";
import { QK } from "../../../lib/queryKeys";
import { createSettlingRunner } from "../../../lib/settlingRunner";
import { normalizeAlbum } from "../../tags/lib/tagNormalize";
import { runDiscogsLookups } from "../discogsLookups";

// A pass over a whole library takes hours at Discogs' rate, so switching lookups off ends it early.
let isEnabled = false;

const runUntilSettled = createSettlingRunner(
  async ({ queryClient, serverId }: { queryClient: QueryClient; serverId: string }) => {
    await runDiscogsLookups(await getDb(), new Date(), {
      serverId,
      shouldStop: () => !isEnabled,
      onFound: ({ albumId, serverId }) => {
        void queryClient.invalidateQueries({ queryKey: QK.lookedUpFacts(albumId, serverId) });
        // Its styles are a genre source.
        normalizeAlbum(albumId)
          .then(() => {
            void queryClient.invalidateQueries({ queryKey: QK.normalizedTags(albumId) });
            void queryClient.invalidateQueries({ queryKey: QK.albumUnmatchedGenres(albumId) });
          })
          .catch((error: unknown) => console.warn("[discogs] refiling genres failed:", albumId, error));
      },
    });
  },
);

/** After each library sync, looks the server's albums up on Discogs for label, catalog number, country and styles, refiling the genres of each album found. */
export function useDiscogsLookups(lastSyncedAt: number | null, serverId: string | null): void {
  const [autoRefresh, , isAutoRefreshLoaded] = useSetting("tags.auto_refresh", "true");
  const queryClient = useQueryClient();
  const isAllowed = isAutoRefreshLoaded && autoRefresh === "true";

  useEffect(() => {
    isEnabled = isAllowed;
    return () => {
      isEnabled = false;
    };
  }, [isAllowed]);

  useEffect(() => {
    if (lastSyncedAt === null || serverId === null || !isAllowed) return;
    runUntilSettled({ queryClient, serverId }).catch((error: unknown) =>
      console.warn("[discogs] lookup pass failed:", error),
    );
  }, [lastSyncedAt, serverId, isAllowed, queryClient]);
}
