import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { runQuitFlushes } from "./quitFlush";

export type DownloadProgress = { downloaded: number; total: number | null };

/** Null means the feed answered with nothing newer; a feed that couldn't be read rejects, so callers can tell them apart. */
export async function checkForUpdate(): Promise<Update | null> {
  const update = await check();
  return update?.available ? update : null;
}

/** Downloads and installs with a progress callback, then relaunches. Throws on failure. */
export async function installAndRestart(update: Update, onProgress: (p: DownloadProgress) => void): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? null;
      onProgress({ downloaded: 0, total });
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress({ downloaded, total });
    }
  });
  // Relaunch ends the process without a quit request, so pending writes go out here.
  await runQuitFlushes();
  await relaunch();
}
