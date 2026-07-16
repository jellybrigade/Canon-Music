import { create } from "zustand";

interface LovedSessionState {
  refreshTick: number;
  bumpRefresh: () => void;
}

// Third domain in the RQ -> local-SQLite-mirror migration (psysonic pattern).
// useLoved reads SQLite directly instead of react-query; toggle mutations and
// sync bump this tick to trigger a refetch instead of queryClient.invalidateQueries.
// This also removes the documented RQ Set-in-queryFn footgun (feedback-rq-set-bug.md)
// since react-query no longer sits in front of this data at all.
export const useLovedSessionStore = create<LovedSessionState>((set) => ({
  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}));
