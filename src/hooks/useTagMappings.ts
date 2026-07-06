import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { sqlNorm } from "../lib/canonicalize";
import type { TagKind } from "../lib/canonicalize";
import { QK } from "../lib/query-keys";

// ── Sentinel constants ────────────────────────────────────────────────────────

export const ACCEPTED = "__accepted__";
export const IGNORED = "__ignored__";

// ── Types ─────────────────────────────────────────────────────────────────────

/** A row from the unified tag vocabulary. canonical_id = null means unresolved. */
export interface TagVocabRow {
  raw_value: string;
  kind: TagKind;
  /** COUNT(DISTINCT album_id). 0 = tag no longer in library (stale). */
  album_count: number;
  /** Comma-separated tag data sources: file, lastfm, musicbrainz, musicbrainz-folksonomy */
  sources: string | null;
  canonical_id: string | null;
  mapping_source: "auto" | "manual" | null;
  locked: number;
}

// ── useTagMappings ─────────────────────────────────────────────────────────────

export function useTagMappings() {
  const queryClient = useQueryClient();

  const saveMapping = useMutation({
    mutationFn: async ({
      rawValue,
      kind,
      canonicalId,
      source = "manual",
      matchType = null,
    }: {
      rawValue: string;
      kind: TagKind;
      canonicalId: string;
      source?: "auto" | "manual";
      matchType?: "exact" | "fuzzy" | null;
    }) => {
      const db = await getDb();
      const existing = await db.select<{ locked: number }[]>(
        "SELECT locked FROM tag_mappings WHERE raw_value = ? AND kind = ?",
        [rawValue, kind],
      );
      if (existing[0]?.locked === 1) {
        throw new Error(`Mapping for "${rawValue}" is locked. Unlock it first.`);
      }
      await db.execute(
        `INSERT OR REPLACE INTO tag_mappings (raw_value, kind, canonical_id, source, match_type, created_at, norm_value)
         VALUES (?, ?, ?, ?, ?, datetime('now'), ?)`,
        [rawValue, kind, canonicalId, source, matchType, sqlNorm(rawValue)],
      );
      // Sentinels must NOT land in track_tags.canonical_id, only real canon ids go there
      if (canonicalId === ACCEPTED || canonicalId === IGNORED) {
        await db.execute(
          "UPDATE track_tags SET canonical_id = NULL WHERE raw_value = ? AND kind = ?",
          [rawValue, kind],
        );
      } else {
        await db.execute(
          "UPDATE track_tags SET canonical_id = ? WHERE raw_value = ? AND kind = ?",
          [canonicalId, rawValue, kind],
        );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.tagVocab() });
      void queryClient.invalidateQueries({ queryKey: QK.trackTagsAll() });
      void queryClient.invalidateQueries({ queryKey: QK.tagMappings() });
      void queryClient.invalidateQueries({ queryKey: QK.genreDisplayMappings() });
    },
    onError: (e) => {
      console.error("[saveMapping]", e);
    },
  });

  const deleteMapping = useMutation({
    mutationFn: async ({ rawValue, kind }: { rawValue: string; kind: TagKind }) => {
      const db = await getDb();
      const norm = sqlNorm(rawValue);
      const existing = await db.select<{ locked: number }[]>(
        "SELECT locked FROM tag_mappings WHERE norm_value = ? AND kind = ?",
        [norm, kind],
      );
      if (existing.some((r) => r.locked === 1)) {
        throw new Error(`Mapping for "${rawValue}" is locked. Unlock it first.`);
      }
      await db.execute("DELETE FROM tag_mappings WHERE norm_value = ? AND kind = ?", [norm, kind]);
      // Clear all raw variants that share the same norm_value, not just the one passed in
      await db.execute(
        "UPDATE track_tags SET canonical_id = NULL WHERE LOWER(REPLACE(REPLACE(TRIM(raw_value), '-', ' '), '_', ' ')) = ? AND kind = ?",
        [norm, kind],
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.tagVocab() });
      void queryClient.invalidateQueries({ queryKey: QK.trackTagsAll() });
      void queryClient.invalidateQueries({ queryKey: QK.tagMappings() });
      void queryClient.invalidateQueries({ queryKey: QK.genreDisplayMappings() });
    },
  });

  const lockMapping = useMutation({
    mutationFn: async ({
      rawValue,
      kind,
      locked,
    }: {
      rawValue: string;
      kind: TagKind;
      locked: boolean;
    }) => {
      const db = await getDb();
      await db.execute(
        "UPDATE tag_mappings SET locked = ? WHERE raw_value = ? AND kind = ?",
        [locked ? 1 : 0, rawValue, kind],
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.tagVocab() });
      void queryClient.invalidateQueries({ queryKey: QK.tagMappings() });
      void queryClient.invalidateQueries({ queryKey: QK.genreDisplayMappings() });
    },
  });

  return { saveMapping, deleteMapping, lockMapping };
}

// ── useTagVocab ───────────────────────────────────────────────────────────────

/**
 * Unified vocabulary query. Returns all distinct (raw_value, kind) tags in the library
 * joined with any tag_mappings decision. Album counts everywhere; sentinel-safe.
 *
 * Classification in JS:
 *   !canonical_id && album_count > 0  → unresolved (Review)
 *   canonical_id = '__accepted__'     → accepted
 *   canonical_id = '__ignored__'      → ignored
 *   canonical_id (other)              → mapped to canon node
 *   album_count = 0 && canonical_id   → stale (decision but tag gone from library)
 */
export function useTagVocab() {
  return useQuery({
    queryKey: QK.tagVocab(),
    queryFn: async () => {
      const db = await getDb();
      return db.select<TagVocabRow[]>(`
        SELECT
          c.raw_value,
          c.kind,
          c.album_count,
          c.sources,
          tm.canonical_id,
          tm.source AS mapping_source,
          COALESCE(tm.locked, 0) AS locked
        FROM tag_vocab_cache c
        LEFT JOIN (
          SELECT norm_value, kind, canonical_id, source, locked
          FROM tag_mappings
          GROUP BY norm_value, kind
        ) tm ON tm.norm_value = c.norm_value AND tm.kind = c.kind
        UNION ALL
        SELECT
          tm.raw_value,
          tm.kind,
          0 AS album_count,
          NULL AS sources,
          tm.canonical_id,
          tm.source AS mapping_source,
          COALESCE(tm.locked, 0) AS locked
        FROM tag_mappings tm
        WHERE NOT EXISTS (
          SELECT 1 FROM tag_vocab_cache c WHERE c.norm_value = tm.norm_value AND c.kind = tm.kind
        )
        GROUP BY tm.norm_value, tm.kind
        ORDER BY album_count DESC, raw_value
      `);
    },
  });
}

// ── useTagAlbums ──────────────────────────────────────────────────────────────

/** Album art for a tag, works for both resolved and unresolved tags. */
export function useTagAlbums(rawValue: string, kind: TagKind) {
  return useQuery({
    queryKey: QK.tagAlbums(rawValue, kind),
    queryFn: async () => {
      const db = await getDb();
      type Row = { album_id: string; album_name: string; artwork_url: string | null };
      return db.select<Row[]>(
        `SELECT a.id as album_id, a.name as album_name, a.artwork_url
         FROM track_tags tt
         JOIN tracks t ON tt.track_id = t.id
         JOIN albums a ON t.album_id = a.id
         WHERE tt.raw_value = ? AND tt.kind = ?
         GROUP BY a.id, a.name
         ORDER BY COUNT(tt.track_id) DESC
         LIMIT 4`,
        [rawValue, kind],
      );
    },
    enabled: !!rawValue,
  });
}

// ── useAutoMapExact ────────────────────────────────────────────────────────────

export function useAutoMapExact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ mapped: number; remaining: number }> => {
      const db = await getDb();
      const { getCanonTree, findCanonicalSync } = await import("../lib/canonicalize");
      const tree = await getCanonTree();

      type LockedRow = { raw_value: string; kind: string };
      const lockedRows = await db.select<LockedRow[]>(
        "SELECT raw_value, kind FROM tag_mappings WHERE locked = 1",
      );
      const lockedSet = new Set(lockedRows.map((r) => `${r.kind}:${r.raw_value}`));

      type Row = { raw_value: string; kind: string };
      const all = await db.select<Row[]>(`SELECT DISTINCT raw_value, kind FROM track_tags`);

      type Match = { raw_value: string; kind: string; canonical_id: string; match_type: string };
      const matches: Match[] = [];
      for (const { raw_value, kind } of all) {
        if (lockedSet.has(`${kind}:${raw_value}`)) continue;
        const result = findCanonicalSync(raw_value, kind as TagKind, tree);
        if (result.node && (result.matchType === "exact" || result.matchType === "cross-type")) {
          matches.push({ raw_value, kind, canonical_id: result.node.id, match_type: result.matchType });
        }
      }

      // Batch insert, 5 params/row, so CHUNK = floor(999/5) = 199
      const CHUNK = 199;
      let mapped = 0;
      for (let i = 0; i < matches.length; i += CHUNK) {
        const chunk = matches.slice(i, i + CHUNK);
        const placeholders = chunk.map(() => "(?, ?, ?, 'auto', ?, datetime('now'), ?)").join(", ");
        const params: unknown[] = [];
        for (const m of chunk) params.push(m.raw_value, m.kind, m.canonical_id, m.match_type, sqlNorm(m.raw_value));
        const res = await db.execute(
          `INSERT OR IGNORE INTO tag_mappings (raw_value, kind, canonical_id, source, match_type, created_at, norm_value) VALUES ${placeholders}`,
          params,
        );
        mapped += res.rowsAffected;
      }

      if (matches.length > 0) {
        // Only update canonical_id for real (non-sentinel) mappings
        await db.execute(`
          UPDATE track_tags
          SET canonical_id = (
            SELECT tm.canonical_id FROM tag_mappings tm
            WHERE tm.raw_value = track_tags.raw_value AND tm.kind = track_tags.kind
              AND tm.canonical_id NOT IN ('__accepted__', '__ignored__')
            LIMIT 1
          )
          WHERE canonical_id IS NULL
            AND EXISTS (
              SELECT 1 FROM tag_mappings tm
              WHERE tm.raw_value = track_tags.raw_value AND tm.kind = track_tags.kind
                AND tm.canonical_id NOT IN ('__accepted__', '__ignored__')
            )
        `);
      }

      // Count remaining unresolved tags that still have albums in the library
      const remainingRows = await db.select<{ n: number }[]>(`
        SELECT COUNT(*) AS n FROM (
          SELECT DISTINCT tt.raw_value, tt.kind
          FROM track_tags tt
          JOIN tracks t ON t.id = tt.track_id
          WHERE NOT EXISTS (
            SELECT 1 FROM tag_mappings tm
            WHERE LOWER(REPLACE(REPLACE(TRIM(tm.raw_value), '-', ' '), '_', ' '))
                = LOWER(REPLACE(REPLACE(TRIM(tt.raw_value), '-', ' '), '_', ' '))
              AND tm.kind = tt.kind
          )
          GROUP BY tt.raw_value, tt.kind
          HAVING COUNT(DISTINCT t.album_id) > 0
        )
      `);
      const remaining = remainingRows[0]?.n ?? 0;

      return { mapped, remaining };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.tagVocab() });
      void queryClient.invalidateQueries({ queryKey: QK.tagMappings() });
      void queryClient.invalidateQueries({ queryKey: QK.trackTagsAll() });
    },
  });
}

// ── useRapToHipHop ─────────────────────────────────────────────────────────────

export function useRapToHipHop() {
  const queryClient = useQueryClient();

  const { data: enabled } = useQuery({
    queryKey: QK.tagRapToHipHop(),
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<{ value: string }[]>(
        "SELECT value FROM settings WHERE key = 'tags.rap_to_hiphop'",
      );
      return rows[0]?.value === "true";
    },
  });

  const toggle = useMutation({
    mutationFn: async (enable: boolean) => {
      const db = await getDb();
      await db.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('tags.rap_to_hiphop', ?)",
        [enable ? "true" : "false"],
      );
      if (enable) {
        await db.execute(
          "INSERT OR REPLACE INTO tag_mappings (raw_value, kind, canonical_id, source, match_type, created_at, norm_value) VALUES ('Rap', 'genre', 'hip-hop', 'auto', 'exact', datetime('now'), 'rap')",
        );
        await db.execute(
          "UPDATE track_tags SET canonical_id = 'hip-hop' WHERE raw_value = 'Rap' AND kind = 'genre'",
        );
      } else {
        const rows = await db.select<{ canonical_id: string }[]>(
          "SELECT canonical_id FROM tag_mappings WHERE raw_value = 'Rap' AND kind = 'genre'",
        );
        if (rows[0]?.canonical_id === "hip-hop") {
          await db.execute("DELETE FROM tag_mappings WHERE raw_value = 'Rap' AND kind = 'genre'");
          await db.execute(
            "UPDATE track_tags SET canonical_id = NULL WHERE raw_value = 'Rap' AND kind = 'genre' AND canonical_id = 'hip-hop'",
          );
        }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.tagRapToHipHop() });
      void queryClient.invalidateQueries({ queryKey: QK.tagMappings() });
      void queryClient.invalidateQueries({ queryKey: QK.tagVocab() });
      void queryClient.invalidateQueries({ queryKey: QK.trackTagsAll() });
    },
  });

  return { enabled: enabled ?? false, toggle };
}
