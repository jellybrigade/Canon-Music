import { create } from "zustand";

interface AlbumTracksNoticeState {
  notice: { message: string } | null;
  report: (message: string) => void;
  dismiss: () => void;
}

export const useAlbumTracksNoticeStore = create<AlbumTracksNoticeState>((set) => ({
  notice: null,
  report: (message) => set((s) => (s.notice?.message === message ? s : { notice: { message } })),
  dismiss: () => set({ notice: null }),
}));
