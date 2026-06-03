import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type DownloadProgress = { downloaded: number; total: number | null };

/** Returns the pending update if one is available, null otherwise. Swallows network errors. */
export async function checkForUpdate(): Promise<Update | null> {
  try {
    const update = await check();
    return update?.available ? update : null;
  } catch {
    return null;
  }
}

/** Downloads and installs with a progress callback, then relaunches. Throws on failure. */
export async function installAndRestart(
  update: Update,
  onProgress: (p: DownloadProgress) => void
): Promise<void> {
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
  await relaunch();
}
