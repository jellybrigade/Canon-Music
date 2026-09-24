import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { extractAccent } from "../lib/artColor";
import { QK } from "../lib/queryKeys";
import { useAlbumBrowseSessionStore } from "../store/albumBrowseSessionStore";

/**
 * The accent color an album tints itself with, derived from its cover art and cached on the
 * `albums` row.
 *
 * Publishing the write is the point: the album detail route renders a row it holds through
 * React Query and Home fills picks from the cached album list, so a bare `UPDATE` leaves both
 * copies null and every revisit decodes the cover again.
 */
export function useAlbumAccent(
  albumId: string,
  storedAccent: string | null | undefined,
  artUrl: string | null,
  serverId: string | undefined
): string | null {
  const queryClient = useQueryClient();
  const [accentColor, setAccentColor] = useState<string | null>(storedAccent ?? null);

  useEffect(() => {
    if (storedAccent) {
      setAccentColor(storedAccent);
      return;
    }
    // Clear immediately so a previous album's color doesn't show during async extraction.
    setAccentColor(null);
    if (!artUrl) return;
    let cancelled = false;
    void extractAccent(artUrl)
      .then(async (color) => {
        if (cancelled) return;
        setAccentColor(color);
        if (!color) return;
        const db = await getDb();
        await db.execute("UPDATE albums SET accent_color = ? WHERE id = ?", [color, albumId]);
        useAlbumBrowseSessionStore.getState().setAccent(albumId, color);
        await queryClient.invalidateQueries({ queryKey: QK.albumById(albumId, serverId) });
      })
      .catch((err) => {
        // Cosmetic only: the album renders untinted and the next mount retries. Swallowing
        // it silently would hide a failing db handle.
        console.error(`Accent extraction failed for ${albumId}`, err);
      });
    return () => { cancelled = true; };
  }, [artUrl, storedAccent, albumId, serverId, queryClient]);

  return accentColor;
}
