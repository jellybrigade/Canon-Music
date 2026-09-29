import { getDb } from "../../../db";
import { canonicalKey } from "./canonicalize";

// Cached so bulk normalization doesn't re-read `tag_mappings` per album. Every writer of
// `tag_mappings` must call `invalidateManualMappings()` before it returns.
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
  const pending = (async () => {
    type MappingRow = { raw_value: string; canonical_id: string };
    try {
      const db = await getDb();
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
    } catch (err) {
      // Without this the memo holds a rejected promise for the life of the process and
      // every later caller gets the same failure, so manual mappings silently stop
      // applying. The generation check keeps a newer read armed by an invalidation.
      if (generation === startGeneration) inFlight = null;
      throw err;
    }
  })();
  inFlight = pending;

  return pending;
}
