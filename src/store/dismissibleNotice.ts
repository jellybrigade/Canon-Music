import { create } from "zustand";

interface DismissibleNoticeState {
  notice: { message: string } | null;
  report: (message: string) => void;
  dismiss: () => void;
}

export const useDismissibleNoticeStore = create<DismissibleNoticeState>((set) => ({
  notice: null,
  report: (message) => set((s) => (s.notice?.message === message ? s : { notice: { message } })),
  dismiss: () => set({ notice: null }),
}));
