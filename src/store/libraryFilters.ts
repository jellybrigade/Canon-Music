import { create } from "zustand";

interface LibraryFiltersState {
  canonicalIdFilters: string[];
  lovedOnly: boolean;
  yearFromInput: string;
  yearToInput: string;
  setCanonicalIdFilters: (ids: string[]) => void;
  toggleCanonicalIdFilter: (id: string) => void;
  setLovedOnly: (v: boolean) => void;
  toggleLovedOnly: () => void;
  setYearFromInput: (v: string) => void;
  setYearToInput: (v: string) => void;
}

export const useLibraryFiltersStore = create<LibraryFiltersState>((set) => ({
  canonicalIdFilters: [],
  lovedOnly: false,
  yearFromInput: "",
  yearToInput: "",
  setCanonicalIdFilters: (ids) => set({ canonicalIdFilters: ids }),
  toggleCanonicalIdFilter: (id) =>
    set((s) => ({
      canonicalIdFilters: s.canonicalIdFilters.includes(id)
        ? s.canonicalIdFilters.filter((x) => x !== id)
        : [...s.canonicalIdFilters, id],
    })),
  setLovedOnly: (v) => set({ lovedOnly: v }),
  toggleLovedOnly: () => set((s) => ({ lovedOnly: !s.lovedOnly })),
  setYearFromInput: (v) => set({ yearFromInput: v }),
  setYearToInput: (v) => set({ yearToInput: v }),
}));
