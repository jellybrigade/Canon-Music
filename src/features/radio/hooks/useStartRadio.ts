import { useCallback } from "react";
import { usePlayerStore, type RadioStartAction, type RadioStartRequest } from "../../playback/store/player";
import { useRadioStartStore } from "../store/radioStart";
import { useSetting } from "../../../hooks/useSetting";

export const RADIO_START_ACTION_SETTING = "radio.start_action";

export type RadioStartSetting = RadioStartAction | "ask";

export function resolveRadioStart(setting: string, queueLength: number): RadioStartSetting {
  const choice: RadioStartSetting = setting === "replace" || setting === "queue_last" ? setting : "ask";
  if (queueLength === 0) return choice === "ask" ? "replace" : choice;
  return choice;
}

export function useStartRadio(): (request: RadioStartRequest) => Promise<void> {
  const [setting] = useSetting(RADIO_START_ACTION_SETTING, "ask");
  return useCallback(
    async (request: RadioStartRequest) => {
      const action = resolveRadioStart(setting, usePlayerStore.getState().queue.length);
      if (action === "ask") {
        useRadioStartStore.getState().ask(request);
        return;
      }
      await usePlayerStore.getState().startRadioFrom(action, request);
    },
    [setting]
  );
}
