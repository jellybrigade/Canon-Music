import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import type { TagKind } from "../lib/canonicalize";

export interface TrackTagRow {
  id: number;
  track_id: string;
  kind: TagKind;
  raw_value: string;
  canonical_id: string | null;
  source: "server" | "lastfm" | "manual";
  created_at: string;
}

export interface AlbumTagSummary {
  albumId: string;
  hasOffTree: boolean;
  tagCount: number;
}

export function useTrackTagsForAlbum(albumId: string) {
  return useQuery({
    queryKey: ["track_tags", "album", albumId],
    queryFn: async () => {
      const db = await getDb();
      return db.select<TrackTagRow[]>(
        `SELECT tt.*
         FROM track_tags tt
         JOIN tracks t ON tt.track_id = t.id
         WHERE t.album_id = ?
         ORDER BY tt.kind, tt.raw_value`,
        [albumId]
      );
    },
    enabled: !!albumId,
  });
}

export function useOffTreeAlbumIds() {
  return useQuery({
    queryKey: ["track_tags", "off_tree_albums"],
    queryFn: async () => {
      const db = await getDb();
      type Row = { album_id: string };
      const rows = await db.select<Row[]>(
        `SELECT DISTINCT t.album_id
         FROM track_tags tt
         JOIN tracks t ON tt.track_id = t.id
         WHERE tt.canonical_id IS NULL`
      );
      return rows.map((r) => r.album_id) as string[];
    },
  });
}

export function useTrackTagMutations() {
  const queryClient = useQueryClient();

  const upsertTags = useMutation({
    mutationFn: async (rows: Array<{ trackId: string; kind: TagKind; rawValue: string; canonicalId: string | null; source: "server" | "lastfm" | "manual" }>) => {
      const db = await getDb();
      for (const row of rows) {
        await db.execute(
          `INSERT OR REPLACE INTO track_tags (track_id, kind, raw_value, canonical_id, source)
           VALUES (?, ?, ?, ?, ?)`,
          [row.trackId, row.kind, row.rawValue, row.canonicalId, row.source]
        );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["track_tags"] });
    },
  });

  const backfillCanonical = useMutation({
    mutationFn: async ({ rawValue, kind, canonicalId }: { rawValue: string; kind: TagKind; canonicalId: string }) => {
      const db = await getDb();
      await db.execute(
        "UPDATE track_tags SET canonical_id = ? WHERE raw_value = ? AND kind = ? AND canonical_id IS NULL",
        [canonicalId, rawValue, kind]
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["track_tags"] });
      void queryClient.invalidateQueries({ queryKey: ["track_tags", "off_tree_albums"] });
    },
  });

  return { upsertTags, backfillCanonical };
}

export function useAlbumTagsRefreshedAt(albumId: string) {
  return useQuery({
    queryKey: ["albums", "tags_refreshed_at", albumId],
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<{ tags_refreshed_at: string | null }[]>(
        "SELECT tags_refreshed_at FROM albums WHERE id = ?",
        [albumId]
      );
      return rows[0]?.tags_refreshed_at ?? null;
    },
    enabled: !!albumId,
  });
}

export function useStaleAlbums(staleDays: number) {
  return useQuery({
    queryKey: ["albums", "stale", staleDays],
    queryFn: async () => {
      const db = await getDb();
      type Row = { id: string; name: string; artist: string | null; tags_refreshed_at: string | null };
      return db.select<Row[]>(
        `SELECT id, name, artist, tags_refreshed_at
         FROM albums
         WHERE tags_refreshed_at IS NULL
            OR datetime(tags_refreshed_at) < datetime('now', '-' || ? || ' days')
         ORDER BY name`,
        [staleDays]
      );
    },
    enabled: staleDays >= 0,
  });
}

export function useTagStats() {
  return useQuery({
    queryKey: ["track_tags", "stats"],
    queryFn: async () => {
      const db = await getDb();
      type Row = { total: number; canonical: number; off_tree: number };
      const rows = await db.select<Row[]>(
        `SELECT
           COUNT(*) as total,
           COUNT(canonical_id) as canonical,
           COUNT(*) - COUNT(canonical_id) as off_tree
         FROM track_tags`
      );
      const row = rows[0] ?? { total: 0, canonical: 0, off_tree: 0 };
      type StaleRow = { stale_count: number };
      const staleRows = await db.select<StaleRow[]>(
        `SELECT COUNT(*) as stale_count FROM albums
         WHERE tags_refreshed_at IS NULL`
      );
      return {
        total: row.total,
        canonical: row.canonical,
        offTree: row.off_tree,
        staleAlbums: staleRows[0]?.stale_count ?? 0,
        pctCanonical: row.total > 0 ? Math.round((row.canonical / row.total) * 100) : 0,
      };
    },
  });
}
