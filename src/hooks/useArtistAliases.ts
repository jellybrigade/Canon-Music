import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../db";
import { QK } from "../lib/query-keys";

export interface ArtistAlias {
  alias_name: string;
  canonical_name: string;
}

export function useArtistAliases() {
  return useQuery({
    queryKey: QK.artistAliases(),
    queryFn: async (): Promise<ArtistAlias[]> => {
      const db = await getDb();
      return db.select<ArtistAlias[]>(
        `SELECT alias_name, canonical_name FROM artist_aliases ORDER BY canonical_name, alias_name`
      );
    },
  });
}

export function useArtistCanonicalOf(aliasName: string) {
  return useQuery({
    queryKey: QK.artistCanonicalOf(aliasName),
    queryFn: async (): Promise<string | null> => {
      const db = await getDb();
      const rows = await db.select<{ canonical_name: string }[]>(
        `SELECT canonical_name FROM artist_aliases WHERE alias_name = ?`,
        [aliasName]
      );
      return rows[0]?.canonical_name ?? null;
    },
  });
}

export function useAliasesOfCanonical(canonicalName: string) {
  return useQuery({
    queryKey: [...QK.artistAliases(), "of", canonicalName],
    queryFn: async (): Promise<string[]> => {
      const db = await getDb();
      const rows = await db.select<{ alias_name: string }[]>(
        `SELECT alias_name FROM artist_aliases WHERE canonical_name = ? ORDER BY alias_name`,
        [canonicalName]
      );
      return rows.map((r) => r.alias_name);
    },
  });
}

export function useSetArtistAlias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ aliasName, canonicalName }: { aliasName: string; canonicalName: string }) => {
      const db = await getDb();
      await db.execute(
        `INSERT OR REPLACE INTO artist_aliases (alias_name, canonical_name) VALUES (?, ?)`,
        [aliasName, canonicalName]
      );
    },
    onSuccess: (_data, { aliasName, canonicalName }) => {
      void qc.invalidateQueries({ queryKey: QK.artistAliases() });
      void qc.invalidateQueries({ queryKey: QK.artists() });
      void qc.invalidateQueries({ queryKey: QK.artistCanonicalOf(aliasName) });
      void qc.invalidateQueries({ queryKey: QK.artistAlbums(aliasName) });
      void qc.invalidateQueries({ queryKey: QK.artistAlbums(canonicalName) });
    },
  });
}

export function useRemoveArtistAlias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (aliasName: string): Promise<string | null> => {
      const db = await getDb();
      const rows = await db.select<{ canonical_name: string }[]>(
        `SELECT canonical_name FROM artist_aliases WHERE alias_name = ?`,
        [aliasName]
      );
      const canonicalName = rows[0]?.canonical_name ?? null;
      await db.execute(`DELETE FROM artist_aliases WHERE alias_name = ?`, [aliasName]);
      return canonicalName;
    },
    onSuccess: (canonicalName, aliasName) => {
      void qc.invalidateQueries({ queryKey: QK.artistAliases() });
      void qc.invalidateQueries({ queryKey: QK.artists() });
      void qc.invalidateQueries({ queryKey: QK.artistCanonicalOf(aliasName) });
      if (canonicalName) {
        void qc.invalidateQueries({ queryKey: QK.artistAlbums(canonicalName) });
        void qc.invalidateQueries({ queryKey: [...QK.artistAliases(), "of", canonicalName] });
      }
    },
  });
}
