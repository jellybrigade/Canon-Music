import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { usePlayerStore } from "../store/player";

export function useTrackEndedListener() {
  useEffect(() => {
    const unlistenPromise = listen("track-ended", () => {
      usePlayerStore.getState().next();
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
}
