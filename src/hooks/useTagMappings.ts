import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import type { TagKind } from "../lib/canonicalize";

export interface TagMappingRow {
  raw_value: string;
  kind: TagKind;
  canonical_id: string;
  source: "auto" | "manual";
  match_type: "exact" | "fuzzy" | null;
  created_at: string;
}

export interface VocabRow {
  raw_value: string;
  kind: TagKind;
  track_count: number;
  canonical_id: string | null;
  mapping_source: "auto" | "manual" | null;
  mapping_match_type: "exact" | "fuzzy" | null;
  locked: number;
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
    mutationFn: async ({ rawValue, kind, canonicalId, source = "manual", matchType = null }: {
      rawValue: string;
      kind: TagKind;
      canonicalId: string;
      source?: "auto" | "manual";
      matchType?: "exact" | "fuzzy" | null;
    }) => {
      const db = await getDb();
      const existing = await db.select<{ locked: number }[]>(
        "SELECT locked FROM tag_mappings WHERE raw_value = ? AND kind = ?",
        [rawValue, kind]
      );
      if (existing[0]?.locked === 1) {
        throw new Error(`Mapping for "${rawValue}" is locked. Unlock it first.`);
      }
      await db.execute(
        `INSERT OR REPLACE INTO tag_mappings (raw_value, kind, canonical_id, source, match_type, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
        [rawValue, kind, canonicalId, source, matchType]
      );
      await db.execute(
        "UPDATE track_tags SET canonical_id = ? WHERE raw_value = ? AND kind = ?",
        [canonicalId, rawValue, kind]
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tag_mappings"] });
      void queryClient.invalidateQueries({ queryKey: ["track_tags"] });
      void queryClient.invalidateQueries({ queryKey: ["vocab"] });
      void queryClient.invalidateQueries({ queryKey: ["unresolved-genres"] });
    },
  });

  const deleteMapping = useMutation({
    mutationFn: async ({ rawValue, kind }: { rawValue: string; kind: TagKind }) => {
      const db = await getDb();
      const existing = await db.select<{ locked: number }[]>(
        "SELECT locked FROM tag_mappings WHERE raw_value = ? AND kind = ?",
        [rawValue, kind]
      );
      if (existing[0]?.locked === 1) {
        throw new Error(`Mapping for "${rawValue}" is locked. Unlock it first.`);
      }
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

  const lockMapping = useMutation({
    mutationFn: async ({ rawValue, kind, locked }: { rawValue: string; kind: TagKind; locked: boolean }) => {
      const db = await getDb();
      await db.execute(
        "UPDATE tag_mappings SET locked = ? WHERE raw_value = ? AND kind = ?",
        [locked ? 1 : 0, rawValue, kind]
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vocab"] });
      void queryClient.invalidateQueries({ queryKey: ["tag_mappings"] });
      void queryClient.invalidateQueries({ queryKey: ["genre-display-mappings"] });
    },
  });

  return { data: query.data, isLoading: query.isLoading, saveMapping, deleteMapping, lockMapping };
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
           tm.canonical_id AS canonical_id,
           tm.source AS mapping_source,
           tm.match_type AS mapping_match_type,
           COALESCE(tm.locked, 0) AS locked
         FROM track_tags tt
         LEFT JOIN tag_mappings tm
           ON LOWER(REPLACE(REPLACE(TRIM(tm.raw_value), '-', ' '), '_', ' '))
            = LOWER(REPLACE(REPLACE(TRIM(tt.raw_value), '-', ' '), '_', ' '))
           AND tm.kind = tt.kind
         GROUP BY tt.raw_value, tt.kind
         UNION ALL
         SELECT
           tm.raw_value,
           tm.kind,
           0 AS track_count,
           tm.canonical_id,
           tm.source AS mapping_source,
           tm.match_type AS mapping_match_type,
           COALESCE(tm.locked, 0) AS locked
         FROM tag_mappings tm
         WHERE NOT EXISTS (
           SELECT 1 FROM track_tags tt
           WHERE LOWER(REPLACE(REPLACE(TRIM(tt.raw_value), '-', ' '), '_', ' '))
               = LOWER(REPLACE(REPLACE(TRIM(tm.raw_value), '-', ' '), '_', ' '))
             AND tt.kind = tm.kind
         )
         ORDER BY track_count DESC, raw_value`
      );
    },
  });
}

export function useAutoMapExact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const db = await getDb();
      const { getCanonTree, findCanonicalSync } = await import("../lib/canonicalize");
      const tree = await getCanonTree();

      // Collect locked raw values to skip
      type LockedRow = { raw_value: string; kind: string };
      const lockedRows = await db.select<LockedRow[]>(
        "SELECT raw_value, kind FROM tag_mappings WHERE locked = 1"
      );
      const lockedSet = new Set(lockedRows.map((r) => `${r.kind}:${r.raw_value}`));

      type Row = { raw_value: string; kind: string };
      const all = await db.select<Row[]>(
        `SELECT DISTINCT raw_value, kind FROM track_tags`
      );

      for (const { raw_value, kind } of all) {
        if (lockedSet.has(`${kind}:${raw_value}`)) continue;
        const result = findCanonicalSync(raw_value, kind as TagKind, tree);
        if (result.node && result.matchType === "exact") {
          await db.execute(
            `INSERT OR IGNORE INTO tag_mappings (raw_value, kind, canonical_id, source, match_type, created_at)
             VALUES (?, ?, ?, 'auto', ?, datetime('now'))`,
            [raw_value, kind, result.node.id, result.matchType]
          );
          await db.execute(
            "UPDATE track_tags SET canonical_id = ? WHERE raw_value = ? AND kind = ? AND canonical_id IS NULL",
            [result.node.id, raw_value, kind]
          );
        }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vocab"] });
      void queryClient.invalidateQueries({ queryKey: ["tag_mappings"] });
      void queryClient.invalidateQueries({ queryKey: ["track_tags"] });
    },
  });
}

export function useVocabAlbums(rawValue: string, kind: TagKind) {
  return useQuery({
    queryKey: ["vocab", "albums", rawValue, kind],
    queryFn: async () => {
      const db = await getDb();
      type Row = { album_id: string; album_name: string; track_count: number; artwork_url: string | null };
      return db.select<Row[]>(
        `SELECT a.id as album_id, a.name as album_name, a.artwork_url,
                COUNT(tt.track_id) as track_count
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

export function useUnresolvedAlbums(rawValue: string, kind: TagKind) {
  return useQuery({
    queryKey: ["unresolved", "albums", rawValue, kind],
    queryFn: async () => {
      const db = await getDb();
      type Row = { album_id: string; album_name: string; artwork_url: string | null };
      return db.select<Row[]>(
        `SELECT a.id as album_id, a.name as album_name, a.artwork_url
         FROM album_unresolved_genres aug
         JOIN albums a ON aug.album_id = a.id
         WHERE aug.raw_value = ? AND aug.kind = ?
         LIMIT 4`,
        [rawValue, kind]
      );
    },
    enabled: !!rawValue,
  });
}

export function useRapToHipHop() {
  const queryClient = useQueryClient();

  const { data: enabled } = useQuery({
    queryKey: ["settings", "tags.rap_to_hiphop"],
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<{ value: string }[]>(
        "SELECT value FROM settings WHERE key = 'tags.rap_to_hiphop'"
      );
      return rows[0]?.value === "true";
    },
  });

  const toggle = useMutation({
    mutationFn: async (enable: boolean) => {
      const db = await getDb();
      await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('tags.rap_to_hiphop', ?)",
        [enable ? "true" : "false"]
      );
      if (enable) {
        await db.execute(
          "INSERT OR REPLACE INTO tag_mappings (raw_value, kind, canonical_id, source, match_type, created_at) VALUES ('Rap', 'genre', 'hip-hop', 'auto', 'exact', datetime('now'))"
        );
        await db.execute(
          "UPDATE track_tags SET canonical_id = 'hip-hop' WHERE raw_value = 'Rap' AND kind = 'genre'"
        );
      } else {
        const rows = await db.select<{ canonical_id: string }[]>(
          "SELECT canonical_id FROM tag_mappings WHERE raw_value = 'Rap' AND kind = 'genre'"
        );
        if (rows[0]?.canonical_id === "hip-hop") {
          await db.execute(
            "DELETE FROM tag_mappings WHERE raw_value = 'Rap' AND kind = 'genre'"
          );
          await db.execute(
            "UPDATE track_tags SET canonical_id = NULL WHERE raw_value = 'Rap' AND kind = 'genre' AND canonical_id = 'hip-hop'"
          );
        }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings", "tags.rap_to_hiphop"] });
      void queryClient.invalidateQueries({ queryKey: ["tag_mappings"] });
      void queryClient.invalidateQueries({ queryKey: ["vocab"] });
      void queryClient.invalidateQueries({ queryKey: ["track_tags"] });
    },
  });

  return { enabled: enabled ?? false, toggle };
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

export interface UnresolvedGenreRow {
  raw_value: string;
  kind: TagKind;
  album_count: number;
  sources: string;
}

export function useUnresolvedGenres() {
  return useQuery({
    queryKey: ["unresolved-genres"],
    queryFn: async (): Promise<UnresolvedGenreRow[]> => {
      const db = await getDb();
      return db.select<UnresolvedGenreRow[]>(`
        SELECT aug.raw_value, aug.kind, COUNT(DISTINCT aug.album_id) AS album_count,
               GROUP_CONCAT(DISTINCT aug.source) AS sources
        FROM album_unresolved_genres aug
        WHERE NOT EXISTS (
          SELECT 1 FROM tag_mappings tm
          WHERE LOWER(REPLACE(REPLACE(TRIM(tm.raw_value), '-', ' '), '_', ' '))
              = LOWER(REPLACE(REPLACE(TRIM(aug.raw_value), '-', ' '), '_', ' '))
            AND tm.kind = aug.kind
        )
        GROUP BY aug.raw_value, aug.kind
        ORDER BY album_count DESC, aug.raw_value
      `);
    },
  });
}
