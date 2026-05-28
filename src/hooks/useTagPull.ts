import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { fetchAlbumTags, classifyTag } from "../lib/lastfm";
import { findCanonical, getCanonTree } from "../lib/canonicalize";
import { useTagsStore } from "../store/tags";
import type { InboxItem, InboxTagRow } from "../store/tags";
import type { AlbumRow } from "./useAlbums";

async function stageGenrePendingEdits(
  trackIds: string[],
  source: "lastfm" | "manual"
): Promise<void> {
  const db = await getDb();
  const tree = await getCanonTree();

  for (const trackId of trackIds) {
    type GenreTagRow = { canonical_id: string };
    const tagRows = await db.select<GenreTagRow[]>(
      "SELECT DISTINCT canonical_id FROM track_tags WHERE track_id = ? AND kind = 'genre' AND canonical_id IS NOT NULL",
      [trackId]
    );

    const names = tagRows
      .map((r) => tree.byId.get(r.canonical_id)?.name ?? null)
      .filter((n): n is string => n !== null)
      .sort();

    if (names.length === 0) continue;
    const newValue = names.join("; ");

    type GenreRow = { genre: string | null };
    const trackRow = await db.select<GenreRow[]>(
      "SELECT genre FROM tracks WHERE id = ?",
      [trackId]
    );
    const oldValue = trackRow[0]?.genre ?? null;
    if (newValue === oldValue) continue;

    await db.execute(
      "DELETE FROM pending_edits WHERE track_id = ? AND field = 'genre'",
      [trackId]
    );
    await db.execute(
      "INSERT INTO pending_edits (track_id, field, old_value, new_value, source, created_at) VALUES (?, 'genre', ?, ?, ?, datetime('now'))",
      [trackId, oldValue, newValue, source]
    );
  }
}

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
        `INSERT OR REPLACE INTO tag_mappings (raw_value, kind, canonical_id, source, match_type, created_at)
         VALUES (?, ?, ?, 'manual', ?, datetime('now'))`,
        [tag.rawValue, tag.kind, canonicalId, matchType]
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

  const genreSource = item.source === "lastfm" ? "lastfm" : "manual";
  await stageGenrePendingEdits(trackRows.map((r) => r.id), genreSource);
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
      void queryClient.invalidateQueries({ queryKey: ["track_tags"] });
      void queryClient.invalidateQueries({ queryKey: ["tag_mappings"] });
      void queryClient.invalidateQueries({ queryKey: ["albums"] });
      void queryClient.invalidateQueries({ queryKey: ["pending_edits"] });
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
      void queryClient.invalidateQueries({ queryKey: ["track_tags"] });
      void queryClient.invalidateQueries({ queryKey: ["tag_mappings"] });
      void queryClient.invalidateQueries({ queryKey: ["pending_edits"] });
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
      void queryClient.invalidateQueries({ queryKey: ["track_tags"] });
      void queryClient.invalidateQueries({ queryKey: ["tag_mappings"] });
      void queryClient.invalidateQueries({ queryKey: ["albums"] });
      void queryClient.invalidateQueries({ queryKey: ["vocab"] });
      void queryClient.invalidateQueries({ queryKey: ["pending_edits"] });
    },
  });
}
