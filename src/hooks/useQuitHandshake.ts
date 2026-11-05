import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { runQuitFlushes } from "../lib/quitFlush";

/** Rust holds a quit until the frontend says its pending writes are out (or a deadline passes). */
export function useQuitHandshake() {
  useEffect(() => {
    let isCancelled = false;
    const unlisten = listen("quit-requested", async () => {
      await runQuitFlushes();
      await invoke("quit_ready");
    });
    void unlisten.then((stop) => {
      if (isCancelled) {
        stop();
        return;
      }
      void invoke("quit_listener_ready").catch((err: unknown) => console.warn("Quit handshake failed", err));
    });
    return () => {
      isCancelled = true;
      void unlisten.then((stop) => stop());
    };
  }, []);
}
