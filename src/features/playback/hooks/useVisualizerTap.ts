import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";

/** Has the audio engine copy samples for the visualizer only while one is on screen. */
export function useVisualizerTap(isOnScreen: boolean) {
  useEffect(() => {
    if (!isOnScreen) return;
    void invoke("audio_visualizer_set_active", { active: true });
    return () => {
      void invoke("audio_visualizer_set_active", { active: false });
    };
  }, [isOnScreen]);
}
