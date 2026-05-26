import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import type { TagKind } from "../lib/canonicalize";

async function stageGenreEditsForRawValue(rawValue: string): Promise<void> {
  const db = await getDb();
  const { getCanonTree } = await import("../lib/canonicalize");
  const tree = await getCanonTree();

  type TrackRow = { id: string };
  const tracks = await db.select<TrackRow[]>(
    `SELECT DISTINCT t.id FROM track_tags tt JOIN tracks t ON tt.track_id = t.id
     WHERE tt.raw_value = ? AND tt.kind = 'genre'`,
    [rawValue]
  );

  for (const { id: trackId } of tracks) {
    type TagRow = { canonical_id: string };
    const tagRows = await db.select<TagRow[]>(
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
    const trackGenre = await db.select<GenreRow[]>("SELECT genre FROM tracks WHERE id = ?", [trackId]);
    const oldValue = trackGenre[0]?.genre ?? null;
    if (newValue === oldValue) continue;

    await db.execute(
      "DELETE FROM pending_edits WHERE track_id = ? AND field = 'genre'",
      [trackId]
    );
    await db.execute(
      "INSERT INTO pending_edits (track_id, field, old_value, new_value, source, created_at) VALUES (?, 'genre', ?, ?, 'manual', datetime('now'))",
      [trackId, oldValue, newValue]
    );
  }
}

export interface TagMappingRow {
  raw_value: string;
  kind: TagKind;
  canonical_id: string;
  created_at: string;
}

export interface VocabRow {
  raw_value: string;
  kind: TagKind;
  track_count: number;
  canonical_id: string | null;
}

export function useTagMappings() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["tag_mappings"],
    queryFn: async () => {
      const db = await getDb();
      return db.select<TagMappingRow[]>(
        "SELECT raw_value, kind, canonical_id, created_at FROM tag_mappings ORDER BY raw_value"
      );
    },
  });

  const saveMapping = useMutation({
    mutationFn: async ({ rawValue, kind, canonicalId }: { rawValue: string; kind: TagKind; canonicalId: string }) => {
      const db = await getDb();
      await db.execute(
        `INSERT OR REPLACE INTO tag_mappings (raw_value, kind, canonical_id, created_at)
         VALUES (?, ?, ?, datetime('now'))`,
        [rawValue, kind, canonicalId]
      );
      await db.execute(
        "UPDATE track_tags SET canonical_id = ? WHERE raw_value = ? AND kind = ?",
        [canonicalId, rawValue, kind]
      );
      if (kind === "genre") {
        await stageGenreEditsForRawValue(rawValue);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tag_mappings"] });
      void queryClient.invalidateQueries({ queryKey: ["track_tags"] });
      void queryClient.invalidateQueries({ queryKey: ["vocab"] });
      void queryClient.invalidateQueries({ queryKey: ["pending_edits"] });
    },
  });

  const deleteMapping = useMutation({
    mutationFn: async ({ rawValue, kind }: { rawValue: string; kind: TagKind }) => {
      const db = await getDb();
      await db.execute(
        "DELETE FROM tag_mappings WHERE raw_value = ? AND kind = ?",
        [rawValue, kind]
      );
      await db.execute(
        "UPDATE track_tags SET canonical_id = NULL WHERE raw_value = ? AND kind = ?",
        [rawValue, kind]
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tag_mappings"] });
      void queryClient.invalidateQueries({ queryKey: ["track_tags"] });
      void queryClient.invalidateQueries({ queryKey: ["vocab"] });
    },
  });

  return { data: query.data, isLoading: query.isLoading, saveMapping, deleteMapping };
}

export function useVocabulary() {
  return useQuery({
    queryKey: ["vocab"],
    queryFn: async () => {
      const db = await getDb();
      return db.select<VocabRow[]>(
        `SELECT
           tt.raw_value,
           tt.kind,
           COUNT(DISTINCT tt.track_id) AS track_count,
           MAX(tt.canonical_id) AS canonical_id
         FROM track_tags tt
         GROUP BY tt.raw_value, tt.kind
         ORDER BY track_count DESC, tt.raw_value`
      );
    },
  });
}

export function useVocabAlbums(rawValue: string, kind: TagKind) {
  return useQuery({
    queryKey: ["vocab", "albums", rawValue, kind],
    queryFn: async () => {
      const db = await getDb();
      type Row = { album_id: string; album_name: string; track_count: number };
      return db.select<Row[]>(
        `SELECT a.id as album_id, a.name as album_name, COUNT(tt.track_id) as track_count
         FROM track_tags tt
         JOIN tracks t ON tt.track_id = t.id
         JOIN albums a ON t.album_id = a.id
         WHERE tt.raw_value = ? AND tt.kind = ?
         GROUP BY a.id, a.name
         ORDER BY track_count DESC, a.name`,
        [rawValue, kind]
      );
    },
    enabled: !!rawValue,
  });
}

export function useAddUserTreeNode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, name, type, canonical_key, parent_ids }: {
      id: string;
      name: string;
      type: "genre" | "mood" | "category";
      canonical_key: string;
      parent_ids: string[];
    }) => {
      const db = await getDb();
      await db.execute(
        "INSERT OR REPLACE INTO user_tree_nodes (id, name, type, canonical_key, parent_ids) VALUES (?, ?, ?, ?, ?)",
        [id, name, type, canonical_key, JSON.stringify(parent_ids)]
      );
      const { bustCanonTreeCache } = await import("../lib/canonicalize");
      bustCanonTreeCache();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["track_tags"] });
      void queryClient.invalidateQueries({ queryKey: ["vocab"] });
    },
  });
}
