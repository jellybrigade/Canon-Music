import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { keychain } from "../keychain";
import { writeTags } from "../lib/sidecar";
import type { WriteDryRunResult } from "../lib/sidecar";
import type { ServerWithCredential } from "./useServer";

export interface PendingEditRow {
  id: number;
  track_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  source: string;
  created_at: string;
  track_title: string;
  track_artist: string | null;
  server_id: string;
  file_path: string | null;
  album_id: string;
  album_name: string;
}

async function getSidecarSecret(server: ServerWithCredential["server"]): Promise<string> {
  if (!server.sidecar_url) throw new Error("Sidecar URL not configured for this server");
  if (!server.sidecar_secret_key) throw new Error("Sidecar secret not configured for this server");
  return keychain.get(server.sidecar_secret_key, "secret");
}

export function usePendingEdits() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["pending_edits"],
    queryFn: async () => {
      const db = await getDb();
      return db.select<PendingEditRow[]>(
        `SELECT pe.id, pe.track_id, pe.field, pe.old_value, pe.new_value, pe.source, pe.created_at,
                t.title AS track_title, t.artist AS track_artist, t.server_id,
                t.file_path, t.album_id,
                a.name AS album_name
         FROM pending_edits pe
         JOIN tracks t ON t.id = pe.track_id
         JOIN albums a ON a.id = t.album_id
         ORDER BY pe.created_at ASC`
      );
    },
  });

  const addPendingEdits = useMutation({
    mutationFn: async ({
      trackId,
      fieldChanges,
      source = "manual",
    }: {
      trackId: string;
      fieldChanges: { field: string; oldValue: string | null; newValue: string }[];
      source?: string;
    }) => {
      const db = await getDb();
      for (const { field, oldValue, newValue } of fieldChanges) {
        await db.execute(
          "DELETE FROM pending_edits WHERE track_id = ? AND field = ?",
          [trackId, field]
        );
        await db.execute(
          "INSERT INTO pending_edits (track_id, field, old_value, new_value, source, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
          [trackId, field, oldValue, newValue, source]
        );
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pending_edits"] });
    },
  });

  const deletePendingEdit = useMutation({
    mutationFn: async (id: number) => {
      const db = await getDb();
      await db.execute("DELETE FROM pending_edits WHERE id = ?", [id]);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pending_edits"] });
    },
  });

  async function dryRunTrack(
    trackId: string,
    serverWithCredential: ServerWithCredential
  ): Promise<WriteDryRunResult> {
    const { server } = serverWithCredential;
    if (!server.sidecar_url) throw new Error("Sidecar URL not configured");
    const db = await getDb();
    type Row = { field: string; new_value: string | null; file_path: string | null };
    const rows = await db.select<Row[]>(
      `SELECT pe.field, pe.new_value, t.file_path
       FROM pending_edits pe
       JOIN tracks t ON t.id = pe.track_id
       WHERE pe.track_id = ?`,
      [trackId]
    );
    if (rows.length === 0) throw new Error("No pending edits for this track");
    const firstRow = rows[0];
    if (!firstRow) throw new Error("No pending edits for this track");
    const filePath = firstRow.file_path;
    if (!filePath) throw new Error("Track has no file path — rescan required to enable writes");
    const tags: Record<string, string | null> = {};
    for (const row of rows) {
      tags[row.field] = row.new_value;
    }
    const secret = await getSidecarSecret(server);
    const result = await writeTags(
      server.sidecar_url,
      secret,
      { filePath, tags, dryRun: true },
      server.sidecar_path_prefix_from,
      server.sidecar_path_prefix_to
    );
    if (!result) throw new Error("Dry run returned no result");
    return result;
  }

  const applyTrack = useMutation({
    mutationFn: async ({
      trackId,
      albumId,
      serverWithCredential,
    }: {
      trackId: string;
      albumId: string;
      serverWithCredential: ServerWithCredential;
    }) => {
      const { server } = serverWithCredential;
      if (!server.sidecar_url) throw new Error("Sidecar URL not configured");
      const db = await getDb();
      type Row = { id: number; field: string; old_value: string | null; new_value: string | null; file_path: string | null };
      const rows = await db.select<Row[]>(
        `SELECT pe.id, pe.field, pe.old_value, pe.new_value, t.file_path
         FROM pending_edits pe
         JOIN tracks t ON t.id = pe.track_id
         WHERE pe.track_id = ?`,
        [trackId]
      );
      if (rows.length === 0) throw new Error("No pending edits for this track");
      const firstRow = rows[0];
      if (!firstRow) throw new Error("No pending edits for this track");
      const filePath = firstRow.file_path;
      if (!filePath) throw new Error("Track has no file path — rescan required");
      const tags: Record<string, string | null> = {};
      for (const row of rows) {
        tags[row.field] = row.new_value;
      }
      const secret = await getSidecarSecret(server);
      await writeTags(
        server.sidecar_url,
        secret,
        { filePath, tags, dryRun: false },
        server.sidecar_path_prefix_from,
        server.sidecar_path_prefix_to
      );
      for (const row of rows) {
        await db.execute(
          "INSERT INTO edit_history (track_id, field, old_value, new_value, source, written_at) VALUES (?, ?, ?, ?, 'manual', datetime('now'))",
          [trackId, row.field, row.old_value, row.new_value]
        );
      }
      const ids = rows.map((r) => r.id);
      const placeholders = ids.map(() => "?").join(", ");
      await db.execute(
        `DELETE FROM pending_edits WHERE id IN (${placeholders})`,
        ids as unknown[]
      );
      return albumId;
    },
    onSuccess: (albumId) => {
      void queryClient.invalidateQueries({ queryKey: ["pending_edits"] });
      void queryClient.invalidateQueries({ queryKey: ["tracks", albumId] });
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    addPendingEdits,
    deletePendingEdit,
    dryRunTrack,
    applyTrack,
  };
}
