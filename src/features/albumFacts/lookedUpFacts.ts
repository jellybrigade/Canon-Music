import { useQuery } from "@tanstack/react-query";
import { getDb } from "../../db";
import { QK } from "../../lib/queryKeys";
import { currentLookupSql } from "../../lib/releaseLookupSql";

type Db = Pick<Awaited<ReturnType<typeof getDb>>, "select">;

/** Release facts other sources found for the album, shown where MusicBrainz has none. */
export interface LookedUpFacts {
  label: string | null;
  /** Only beside Discogs' own label: a catalog number belongs to the label that issued it. */
  catalogNumber: string | null;
  country: string | null;
}

export const NO_LOOKED_UP_FACTS: LookedUpFacts = { label: null, catalogNumber: null, country: null };

/** What Discogs, then a release-date lookup, found for the album, while that lookup still describes it. */
export async function readLookedUpFacts(
  db: Db,
  { albumId, serverId }: { albumId: string; serverId: string },
): Promise<LookedUpFacts> {
  const [discogs] = await db.select<{ label: string | null; catalog_number: string | null; country: string | null }[]>(
    `SELECT lookup.label, lookup.catalog_number, lookup.country FROM album_discogs lookup
     JOIN albums album ON ${currentLookupSql("lookup", "album")}
     WHERE album.id = ? AND album.server_id = ? AND lookup.status = 'found'`,
    [albumId, serverId],
  );
  if (discogs?.label != null) {
    return { label: discogs.label, catalogNumber: discogs.catalog_number, country: discogs.country };
  }
  const [releaseLookup] = await db.select<{ label: string }[]>(
    `SELECT lookup.label FROM album_release_lookups lookup
     JOIN albums album ON ${currentLookupSql("lookup", "album")}
     WHERE album.id = ? AND album.server_id = ? AND lookup.status = 'found' AND lookup.label IS NOT NULL
     ORDER BY lookup.source
     LIMIT 1`,
    [albumId, serverId],
  );
  return { label: releaseLookup?.label ?? null, catalogNumber: null, country: discogs?.country ?? null };
}

export function useLookedUpFacts({ albumId, serverId }: { albumId: string; serverId: string }) {
  return useQuery({
    queryKey: QK.lookedUpFacts(albumId, serverId),
    queryFn: async () => readLookedUpFacts(await getDb(), { albumId, serverId }),
  });
}
