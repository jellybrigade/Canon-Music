import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../../../db";
import { QK } from "../../../lib/queryKeys";
import type { TagKind } from "../lib/canonicalize";
import { sqlNorm, sqlNormExpression } from "../lib/canonicalize";
import { invalidateManualMappings } from "../lib/manualMappings";

export const ACCEPTED = "__accepted__";
export const IGNORED = "__ignored__";

/** A row from the unified tag vocabulary. canonical_id = null means unresolved. */
export interface TagVocabRow {
  raw_value: string;
  kind: TagKind;
  /** COUNT(DISTINCT album_id). 0 = tag no longer in library (stale). */
  album_count: number;
  /** Comma-separated tag data sources: file, lastfm, musicbrainz, discogs, musicbrainz-folksonomy */
  sources: string | null;
  canonical_id: string | null;
  mapping_source: "auto" | "manual" | null;
  locked: number;
}

type SaveMappingInput = {
  rawValue: string;
  kind: TagKind;
  canonicalId: string;
  source?: "auto" | "manual";
  matchType?: "exact" | "fuzzy" | null;
};

/**
 * Every write keys on the spelling group (`norm_value`), the unit the Tags list shows one decision for.
 * One transaction in Rust: the lock check, the group's decision and its track tags change together.
 */
export async function saveTagMapping({
  rawValue,
  kind,
  canonicalId,
  source = "manual",
  matchType = null,
}: SaveMappingInput): Promise<void> {
  // Migrations first: the Rust connection shares canon.db with no schema of its own.
  await getDb();
  try {
    await invoke("save_tag_mapping", {
      rawValue,
      kind,
      normValue: sqlNorm(rawValue),
      canonicalId,
      source,
      matchType,
    });
  } finally {
    invalidateManualMappings();
  }
}

export async function deleteTagMapping({ rawValue, kind }: { rawValue: string; kind: TagKind }): Promise<void> {
  await getDb();
  try {
    await invoke("delete_tag_mapping", { rawValue, kind, normValue: sqlNorm(rawValue) });
  } finally {
    invalidateManualMappings();
  }
}

export async function lockTagMapping({
  rawValue,
  kind,
  locked,
}: {
  rawValue: string;
  kind: TagKind;
  locked: boolean;
}): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE tag_mappings SET locked = ? WHERE norm_value = ? AND kind = ?", [
    locked ? 1 : 0,
    sqlNorm(rawValue),
    kind,
  ]);
  invalidateManualMappings();
}

export function useTagMappings() {
  const queryClient = useQueryClient();

  const saveMapping = useMutation({
    mutationFn: saveTagMapping,
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
    mutationFn: deleteTagMapping,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.tagVocab() });
      void queryClient.invalidateQueries({ queryKey: QK.trackTagsAll() });
      void queryClient.invalidateQueries({ queryKey: QK.tagMappings() });
      void queryClient.invalidateQueries({ queryKey: QK.genreDisplayMappings() });
    },
  });

  const lockMapping = useMutation({
    mutationFn: lockTagMapping,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.tagVocab() });
      void queryClient.invalidateQueries({ queryKey: QK.tagMappings() });
      void queryClient.invalidateQueries({ queryKey: QK.genreDisplayMappings() });
    },
  });

  return { saveMapping, deleteMapping, lockMapping };
}

/** One decision per spelling group: a locked one, then a manual one, then the first spelling. */
export const TAG_VOCAB_SQL = `
  WITH ranked AS (
    SELECT raw_value, norm_value, kind, canonical_id, source, locked,
      ROW_NUMBER() OVER (
        PARTITION BY norm_value, kind ORDER BY locked DESC, source = 'manual' DESC, raw_value
      ) AS group_rank
    FROM tag_mappings
  ),
  decision AS (SELECT * FROM ranked WHERE group_rank = 1)
  SELECT
    c.raw_value,
    c.kind,
    c.album_count,
    c.sources,
    decision.canonical_id,
    decision.source AS mapping_source,
    COALESCE(decision.locked, 0) AS locked
  FROM tag_vocab_cache c
  LEFT JOIN decision ON decision.norm_value = c.norm_value AND decision.kind = c.kind
  UNION ALL
  SELECT
    decision.raw_value,
    decision.kind,
    0 AS album_count,
    NULL AS sources,
    decision.canonical_id,
    decision.source AS mapping_source,
    COALESCE(decision.locked, 0) AS locked
  FROM decision
  WHERE NOT EXISTS (
    SELECT 1 FROM tag_vocab_cache c WHERE c.norm_value = decision.norm_value AND c.kind = decision.kind
  )
  ORDER BY album_count DESC, raw_value, kind`;

/** Up to four of the server's albums carrying any spelling of a tag, most tagged tracks first. */
export const TAG_ALBUMS_SQL = `
  SELECT a.id AS album_id, a.name AS album_name, a.artwork_url
  FROM track_tags tt
  JOIN tracks t ON t.id = tt.track_id
  JOIN albums a ON a.id = t.album_id
  WHERE ${sqlNormExpression("tt.raw_value")} = ? AND tt.kind = ? AND t.server_id = ?
  GROUP BY a.id
  ORDER BY COUNT(DISTINCT tt.track_id) DESC, a.id
  LIMIT 4`;

/** Tags on albums with no decision for any of their spellings. */
export const UNRESOLVED_TAG_COUNT_SQL = `
  SELECT COUNT(*) AS n FROM (
    SELECT DISTINCT tt.raw_value, tt.kind
    FROM track_tags tt
    JOIN tracks t ON t.id = tt.track_id
    WHERE NOT EXISTS (
      SELECT 1 FROM tag_mappings tm
      WHERE tm.norm_value = ${sqlNormExpression("tt.raw_value")}
        AND tm.kind = tt.kind
    )
    GROUP BY tt.raw_value, tt.kind
    HAVING COUNT(DISTINCT t.album_id) > 0
  )`;

/**
 * Every distinct (raw_value, kind) tag joined with its tag_mappings decision, with album counts.
 * Classified in JS: unresolved, accepted, ignored, mapped, or stale (decision, no albums left).
 */
export function useTagVocab() {
  return useQuery({
    queryKey: QK.tagVocab(),
    queryFn: async () => {
      const db = await getDb();
      return db.select<TagVocabRow[]>(TAG_VOCAB_SQL);
    },
  });
}

/**
 * Sidebar Tags badge: unresolved tags with albums, counted in SQL. Keyed under QK.tagVocab()
 * so existing mapping invalidations match by prefix.
 */
export function useUnmappedTagCount() {
  return useQuery({
    queryKey: [...QK.tagVocab(), "count"],
    queryFn: async () => {
      // Wait for tauri-plugin-sql's migrations before reading via rusqlite - both
      // engines share canon.db and this read path has no schema awareness of its own.
      await getDb();
      return invoke<number>("get_unmapped_tag_count");
    },
  });
}

/** Album art for a tag, works for both resolved and unresolved tags. */
export function useTagAlbums(rawValue: string, kind: TagKind, serverId: string | undefined) {
  return useQuery({
    queryKey: QK.tagAlbums(rawValue, kind, serverId),
    queryFn: async () => {
      const db = await getDb();
      type Row = { album_id: string; album_name: string; artwork_url: string | null };
      return db.select<Row[]>(TAG_ALBUMS_SQL, [sqlNorm(rawValue), kind, serverId]);
    },
    enabled: !!rawValue && !!serverId,
  });
}

export function useAutoMapExact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ mapped: number; remaining: number }> => {
      const db = await getDb();
      const { getCanonTree, findCanonicalSync } = await import("../lib/canonicalize");
      const tree = await getCanonTree();

      type LockedRow = { raw_value: string; kind: string };
      const lockedRows = await db.select<LockedRow[]>("SELECT raw_value, kind FROM tag_mappings WHERE locked = 1");
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
        invalidateManualMappings();
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
      const remainingRows = await db.select<{ n: number }[]>(UNRESOLVED_TAG_COUNT_SQL);
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

/** An automatic rule: it yields to a manual or locked decision on any spelling of Rap. */
export async function setRapToHipHop(enable: boolean): Promise<void> {
  await getDb();
  try {
    await invoke("set_rap_to_hip_hop", { enabled: enable });
  } finally {
    invalidateManualMappings();
  }
}

export function useRapToHipHop() {
  const queryClient = useQueryClient();

  const { data: enabled } = useQuery({
    queryKey: QK.tagRapToHipHop(),
    queryFn: async () => {
      const db = await getDb();
      const rows = await db.select<{ value: string }[]>("SELECT value FROM settings WHERE key = 'tags.rap_to_hiphop'");
      return rows[0]?.value === "true";
    },
  });

  const toggle = useMutation({
    mutationFn: setRapToHipHop,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.tagRapToHipHop() });
      void queryClient.invalidateQueries({ queryKey: QK.tagMappings() });
      void queryClient.invalidateQueries({ queryKey: QK.tagVocab() });
      void queryClient.invalidateQueries({ queryKey: QK.trackTagsAll() });
    },
  });

  return { enabled: enabled ?? false, toggle };
}
