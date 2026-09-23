import { create } from "zustand";

interface TagsState {
  pullProgress: { done: number; total: number } | null;
  setPullProgress: (p: { done: number; total: number } | null) => void;
  enrichmentPending: number | null;
  setEnrichmentPending: (n: number | null) => void;
  decrementEnrichmentPending: () => void;
}

export const useTagsStore = create<TagsState>()((set) => ({
  pullProgress: null,
  setPullProgress: (p) => set({ pullProgress: p }),
  enrichmentPending: null,
  setEnrichmentPending: (n) => set({ enrichmentPending: n }),
  decrementEnrichmentPending: () =>
    set((s) => {
      if (s.enrichmentPending === null) return s;
      const next = s.enrichmentPending - 1;
      return { enrichmentPending: next <= 0 ? null : next };
    }),
}));
