import { create } from "zustand";
import type { RadioStartRequest } from "../../playback/store/player";

// A radio start waiting on the user's replace-or-add answer. One at a time: a second request
// while the dialog is open replaces the first, since only the latest click is still wanted.
interface RadioStartState {
  pending: RadioStartRequest | null;
  ask: (request: RadioStartRequest) => void;
  dismiss: () => void;
}

export const useRadioStartStore = create<RadioStartState>((set) => ({
  pending: null,
  ask: (request) => set({ pending: request }),
  dismiss: () => set({ pending: null }),
}));
