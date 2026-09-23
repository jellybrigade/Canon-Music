import Database from "@tauri-apps/plugin-sql";
import type { Server } from "../../types/server";
import type { NavidromeCredential } from "../../clients/navidromeUrls";

/** What every stage after the album pass reads, and where it reports a stage it skipped. */
export interface SyncStageContext {
  db: Database;
  server: Server;
  credential: NavidromeCredential;
  altUrl: string | undefined;
  skippedStages: string[];
}
