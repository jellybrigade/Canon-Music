import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "../../../db";
import { QK } from "../../../lib/queryKeys";
import { useArtistAlbumsSessionStore } from "../../../store/artistAlbumsSessionStore";
import { useArtistBrowseSessionStore } from "../../../store/artistBrowseSessionStore";

export interface ArtistAlias {
  alias_name: string;
  canonical_name: string;
}

type AliasFoldedRoot =
  | ReturnType<typeof QK.artistTopTracks>[0]
  | ReturnType<typeof QK.artistSeedTrack>[0]
  | ReturnType<typeof QK.artistGenres>[0]
  | ReturnType<typeof QK.artistAppearsOn>[0]
  | ReturnType<typeof QK.similarArtistAlbums>[0]
  | ReturnType<typeof QK.similarInLibrary>[0];

// Reads that fold aliases into their canonical artist: a merge or unmerge changes every one of them.
const ALIAS_FOLDED_ROOTS: ReadonlySet<unknown> = new Set<AliasFoldedRoot>([
  "artist-top-tracks",
  "artist-seed-track",
  "artist-genres",
  "artist-appears-on",
  "similar-artist-albums",
  "similar-in-library",
]);

function refreshAliasReads(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: QK.artistAliases() });
  void qc.invalidateQueries({ predicate: (query) => ALIAS_FOLDED_ROOTS.has(query.queryKey[0]) });
  useArtistBrowseSessionStore.getState().bumpRefresh();
  useArtistAlbumsSessionStore.getState().bumpRefresh();
}

export function useArtistAliases() {
  return useQuery({
    queryKey: QK.artistAliases(),
    queryFn: async (): Promise<ArtistAlias[]> => {
      const db = await getDb();
      return db.select<ArtistAlias[]>(
        `SELECT alias_name, canonical_name FROM artist_aliases ORDER BY canonical_name, alias_name`,
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
        [aliasName],
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
        [canonicalName],
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
      await db.execute(`INSERT OR REPLACE INTO artist_aliases (alias_name, canonical_name) VALUES (?, ?)`, [
        aliasName,
        canonicalName,
      ]);
    },
    onSuccess: () => refreshAliasReads(qc),
  });
}

export function useRemoveArtistAlias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (aliasName: string) => {
      const db = await getDb();
      await db.execute(`DELETE FROM artist_aliases WHERE alias_name = ?`, [aliasName]);
    },
    onSuccess: () => refreshAliasReads(qc),
  });
}
