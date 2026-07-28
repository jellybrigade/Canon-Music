import { getDb } from "../db";
import { canonicalKey } from "./canonicalize";

/**
 * Cache for the manual genre mappings table read.
 *
 * `normalizeAlbum` needs the whole `tag_mappings` manual set to decide overrides,
 * and it used to re-read the full table once per album. A bulk pass over a
 * 2000-album library therefore cost O(albums x mappings) rows across the SQL
 * bridge. The set only changes when a mutation writes `tag_mappings`, so it is
 * cached here and dropped explicitly by those mutations.
 *
 * Any new writer of `tag_mappings` MUST call `invalidateManualMappings()` before
 * it returns, or normalization will keep using the pre-write mapping set.
 */
let cache: Map<string, string> | null = null;
let inFlight: Promise<Map<string, string>> | null = null;
let generation = 0;

export function invalidateManualMappings(): void {
  cache = null;
  inFlight = null;
  generation++;
}

/** raw-value canonical key -> canonical_id, for `kind = 'genre'`, `source = 'manual'`. */
export async function getManualGenreMappings(): Promise<Map<string, string>> {
  if (cache) return cache;
  if (inFlight) return inFlight;

  const startGeneration = generation;
  inFlight = (async () => {
    const db = await getDb();
    type MappingRow = { raw_value: string; canonical_id: string };
    const rows = await db.select<MappingRow[]>(
      "SELECT raw_value, canonical_id FROM tag_mappings WHERE kind = 'genre' AND source = 'manual'"
    );
    const map = new Map(rows.map((r) => [canonicalKey(r.raw_value), r.canonical_id]));
    // A write that landed while this read was in flight bumped the generation,
    // so the result may already be stale. Return it, but don't cache it.
    if (generation === startGeneration) {
      cache = map;
      inFlight = null;
    }
    return map;
  })();

  return inFlight;
}
