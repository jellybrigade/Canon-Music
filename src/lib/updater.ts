import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** Returns the pending update if one is available, null otherwise. Swallows network errors. */
export async function checkForUpdate(): Promise<Update | null> {
  try {
    const update = await check();
    return update?.available ? update : null;
  } catch {
    return null;
  }
}

/** Downloads, installs, and relaunches. Throws on failure. */
export async function installAndRestart(update: Update): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}
