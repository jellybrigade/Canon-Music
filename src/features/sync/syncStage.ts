import type Database from "@tauri-apps/plugin-sql";
import type { NavidromeCredential } from "../../clients/navidromeUrls";
import type { Server } from "../../types/server";

/** What every stage after the album pass reads, and where it reports a stage it skipped. */
export interface SyncStageContext {
  db: Database;
  server: Server;
  credential: NavidromeCredential;
  altUrl: string | undefined;
  skippedStages: string[];
}
