import { getDb } from "../../db";
import type { ServerWithCredential } from "../../hooks/useServer";
import { clearSyncWatermark } from "./syncWatermark";
import type { useLibrarySync } from "./useLibrarySync";

export async function resyncLibrary(
  serverWithCredential: ServerWithCredential,
  runSync: ReturnType<typeof useLibrarySync>["runSync"],
) {
  const db = await getDb();
  // The flag is what actually forces the pass; clearing the watermark is what makes the
  // next sync do it too, so a resync interrupted half way is not silently skipped.
  await clearSyncWatermark(db, serverWithCredential.server.id);
  runSync(serverWithCredential, { forceTrackPass: true });
}
