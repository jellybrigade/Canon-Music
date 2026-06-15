import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { fetchAlbumTags, classifyTag } from "../lib/lastfm";
import { QK } from "../lib/query-keys";
import { findCanonical, getCanonTree, sqlNorm } from "../lib/canonicalize";
import { useTagsStore } from "../store/tags";
import type { InboxItem, InboxTagRow } from "../store/tags";
import type { AlbumRow } from "../types/library";

export type PullMode = "silent" | "review";

async function buildInboxItem(
  album: AlbumRow,
  rawTags: string[],
  source: "lastfm" | "canonize"
): Promise<InboxItem> {
  await getCanonTree();
  const db = await getDb();

  // Load saved mappings for lookup
  type MappingRow = { raw_value: string; kind: string; canonical_id: string };
  const mappingRows = await db.select<MappingRow[]>("SELECT raw_value, kind, canonical_id FROM tag_mappings");
  const mappings = new Map<string, string>();
  for (const m of mappingRows) {
    mappings.set(`${m.raw_value}:${m.kind}`, m.canonical_id);
  }

  const tagRows: InboxTagRow[] = [];
  const seen = new Set<string>();

  for (const raw of rawTags) {
    if (!raw.trim()) continue;
    const kind = await classifyTag(raw);
    const key = `${raw}:${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const findResult = await findCanonical(raw, kind, mappings);
    tagRows.push({
      rawValue: raw,
      kind,
      findResult,
      kept: findResult.matchType !== "none",
    });
  }

  // Sort: exact first, then fuzzy, then none
  tagRows.sort((a, b) => {
    const order = { mapping: 0, exact: 1, "cross-type": 2, fuzzy: 3, none: 4 };
    return order[a.findResult.matchType] - order[b.findResult.matchType];
  });

  return {
    albumId: album.id,
    albumName: album.name,
    albumArtist: album.artist ?? "",
    artworkUrl: album.artwork_url ?? undefined,
    source,
    tags: tagRows,
  };
}

async function applyInboxItem(item: InboxItem): Promise<void> {
  const db = await getDb();
  const keptTags = item.tags.filter((t) => t.kept);

  // Get all track ids for this album
  type TrackIdRow = { id: string };
  const trackRows = await db.select<TrackIdRow[]>(
    "SELECT id FROM tracks WHERE album_id = ?",
    [item.albumId]
  );

  for (const tag of keptTags) {
    const canonicalId = tag.overrideCanonicalId ?? tag.findResult.node?.id ?? null;

    // Upsert tag_mappings if we have a canonical
    if (canonicalId) {
      const mt = tag.findResult.matchType;
      const matchType = mt === "exact" || mt === "fuzzy" ? mt : null;
      await db.execute(
        `INSERT OR REPLACE INTO tag_mappings (raw_value, kind, canonical_id, source, match_type, created_at, norm_value)
         VALUES (?, ?, ?, 'manual', ?, datetime('now'), ?)`,
        [tag.rawValue, tag.kind, canonicalId, matchType, sqlNorm(tag.rawValue)]
      );
    }

    for (const track of trackRows) {
      await db.execute(
        `INSERT OR REPLACE INTO track_tags (track_id, kind, raw_value, canonical_id, source)
         VALUES (?, ?, ?, ?, ?)`,
        [track.id, tag.kind, tag.rawValue, canonicalId, item.source === "lastfm" ? "lastfm" : "manual"]
      );
    }
  }

  // Backfill canonical_id for any other track_tags rows matching this raw_value+kind
  for (const tag of keptTags) {
    const canonicalId = tag.overrideCanonicalId ?? tag.findResult.node?.id ?? null;
    if (canonicalId) {
      await db.execute(
        "UPDATE track_tags SET canonical_id = ? WHERE raw_value = ? AND kind = ? AND canonical_id IS NULL",
        [canonicalId, tag.rawValue, tag.kind]
      );
    }
  }

  await db.execute(
    "UPDATE albums SET tags_refreshed_at = datetime('now') WHERE id = ?",
    [item.albumId]
  );
}

export function useTagPull() {
  const queryClient = useQueryClient();
  const addInboxItem = useTagsStore((s) => s.addInboxItem);

  const pullForAlbum = useMutation({
    mutationFn: async ({ album, mode }: { album: AlbumRow; mode: PullMode }) => {
      const rawResult = await fetchAlbumTags(album.artist ?? "", album.name);
      const allTags = [...rawResult.genres, ...rawResult.moods];
      const item = await buildInboxItem(album, allTags, "lastfm");

      if (mode === "silent") {
        await applyInboxItem(item);
      } else {
        addInboxItem(item);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.trackTagsAll() });
      void queryClient.invalidateQueries({ queryKey: QK.tagMappings() });
      void queryClient.invalidateQueries({ queryKey: QK.albumsAll() });
    },
  });

  const canonizeAlbum = useMutation({
    mutationFn: async ({ album, mode }: { album: AlbumRow; mode: PullMode }) => {
      const db = await getDb();
      // Get all existing track_tags for the album that have no canonical
      type TagRow = { raw_value: string; kind: string };
      const existingTags = await db.select<TagRow[]>(
        `SELECT DISTINCT tt.raw_value, tt.kind
         FROM track_tags tt
         JOIN tracks t ON tt.track_id = t.id
         WHERE t.album_id = ? AND tt.canonical_id IS NULL`,
        [album.id]
      );

      const rawTags = existingTags.map((t) => t.raw_value);
      if (rawTags.length === 0) return;

      const item = await buildInboxItem(album, rawTags, "canonize");

      if (mode === "silent") {
        await applyInboxItem(item);
      } else {
        addInboxItem(item);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.trackTagsAll() });
      void queryClient.invalidateQueries({ queryKey: QK.tagMappings() });
    },
  });

  return { pullForAlbum, canonizeAlbum };
}

export function useAcceptInboxItem() {
  const queryClient = useQueryClient();
  const removeInboxItem = useTagsStore((s) => s.removeInboxItem);

  return useMutation({
    mutationFn: async (item: InboxItem) => {
      await applyInboxItem(item);
      removeInboxItem(item.albumId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.trackTagsAll() });
      void queryClient.invalidateQueries({ queryKey: QK.tagMappings() });
      void queryClient.invalidateQueries({ queryKey: QK.albumsAll() });
      void queryClient.invalidateQueries({ queryKey: QK.tagVocab() });
    },
  });
}
