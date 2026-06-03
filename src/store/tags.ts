import { create } from "zustand";
import type { FindResult, TagKind } from "../lib/canonicalize";

export interface InboxTagRow {
  rawValue: string;
  kind: TagKind;
  findResult: FindResult;
  kept: boolean;
  overrideCanonicalId?: string;
}

export interface InboxItem {
  albumId: string;
  albumName: string;
  albumArtist: string;
  artworkUrl?: string;
  source: "lastfm" | "canonize";
  tags: InboxTagRow[];
}

interface TagsState {
  inboxItems: InboxItem[];
  addInboxItem: (item: InboxItem) => void;
  removeInboxItem: (albumId: string) => void;
  updateTagRow: (albumId: string, rawValue: string, kind: TagKind, patch: Partial<InboxTagRow>) => void;
  clearInbox: () => void;
  pullProgress: { done: number; total: number } | null;
  setPullProgress: (p: { done: number; total: number } | null) => void;
  enrichmentPending: number | null;
  setEnrichmentPending: (n: number | null) => void;
  decrementEnrichmentPending: () => void;
}

export const useTagsStore = create<TagsState>()((set) => ({
  inboxItems: [],

  addInboxItem: (item) =>
    set((s) => {
      const filtered = s.inboxItems.filter((i) => i.albumId !== item.albumId);
      return { inboxItems: [item, ...filtered] };
    }),

  removeInboxItem: (albumId) =>
    set((s) => ({ inboxItems: s.inboxItems.filter((i) => i.albumId !== albumId) })),

  updateTagRow: (albumId, rawValue, kind, patch) =>
    set((s) => ({
      inboxItems: s.inboxItems.map((item) => {
        if (item.albumId !== albumId) return item;
        return {
          ...item,
          tags: item.tags.map((tag) =>
            tag.rawValue === rawValue && tag.kind === kind ? { ...tag, ...patch } : tag
          ),
        };
      }),
    })),

  clearInbox: () => set({ inboxItems: [] }),

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
