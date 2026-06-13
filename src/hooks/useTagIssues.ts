import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { QK } from "../lib/query-keys";

export interface TagIssueRow {
  id: number;
  track_id: string;
  issue_type: string;
  details: string | null;
  detected_at: string;
  track_title: string;
  track_artist: string | null;
  album_name: string;
  album_id: string;
}

export function useTagIssues() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QK.tagIssues(),
    queryFn: async (): Promise<TagIssueRow[]> => {
      const db = await getDb();
      return db.select<TagIssueRow[]>(
        `SELECT ti.id, ti.track_id, ti.issue_type, ti.details, ti.detected_at,
                t.title AS track_title, t.artist AS track_artist,
                a.name AS album_name, a.id AS album_id
         FROM tag_issues ti
         JOIN tracks t ON t.id = ti.track_id
         JOIN albums a ON a.id = t.album_id
         WHERE ti.dismissed_at IS NULL
         ORDER BY ti.issue_type, a.name, t.title`
      );
    },
  });

  const dismissIssue = useMutation({
    mutationFn: async (id: number) => {
      const db = await getDb();
      await db.execute(
        "UPDATE tag_issues SET dismissed_at = datetime('now') WHERE id = ?",
        [id]
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.tagIssues() });
    },
  });

  const dismissAll = useMutation({
    mutationFn: async () => {
      const db = await getDb();
      await db.execute(
        "UPDATE tag_issues SET dismissed_at = datetime('now') WHERE dismissed_at IS NULL"
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.tagIssues() });
    },
  });

  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
    dismissIssue,
    dismissAll,
    issueCount: query.data?.length ?? 0,
  };
}
