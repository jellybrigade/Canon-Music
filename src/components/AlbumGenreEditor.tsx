import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X, Plus } from "lucide-react";
import { QK } from "../lib/query-keys";
import { getDb } from "../db";
import { normalizeAlbum } from "../lib/tag-normalize";
import { getCanonTree, rawGenreId } from "../lib/canonicalize";
import { useAlbumIdentity } from "../hooks/useAlbumIdentity";
import { UnmatchedSection } from "./TagDrawer";
import type { TreeNode } from "../lib/canonicalize";
import "./AlbumGenreEditor.css";

export type DisplayGenre = {
  id: string | null;
  name: string;
  source?: "file" | "lastfm" | "manual" | "musicbrainz" | "musicbrainz-folksonomy";
};

export type GenreGroups = {
  manual: DisplayGenre[];
  file: DisplayGenre[];
  lastfm: DisplayGenre[];
  musicbrainz: DisplayGenre[];
  folksonomy: DisplayGenre[];
  unsourced: DisplayGenre[];
  multiSource: boolean;
};

interface Props {
  albumId: string;
  albumArtist: string;
  albumName: string;
  genreGroups: GenreGroups;
  rawSourcesByCanonicalId: Map<string, Array<{ raw_value: string; source: string }>>;
  onTagFilter?: (canonicalId: string) => void;
  onClose: () => void;
}

export function AlbumGenreEditor({
  albumId,
  albumArtist,
  albumName,
  genreGroups,
  rawSourcesByCanonicalId,
  onTagFilter,
  onClose,
}: Props) {
  const queryClient = useQueryClient();
  const { data: albumIdentity } = useAlbumIdentity(albumId);
  const [isUpdating, setIsUpdating] = useState(false);
  const [genreInput, setGenreInput] = useState("");
  const [autocomplete, setAutocomplete] = useState<TreeNode[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const buildNormalizeArgs = useCallback(
    () => ({
      lastfmArtistName: albumIdentity?.lastfm_artist_name ?? null,
      lastfmAlbumName: albumIdentity?.lastfm_album_name ?? null,
      combinedMbGenres: albumIdentity?.combined_genres_json
        ? (JSON.parse(albumIdentity.combined_genres_json) as Array<{ name: string; count: number }>)
        : null,
      combinedMbTags: albumIdentity?.combined_tags_json
        ? (JSON.parse(albumIdentity.combined_tags_json) as Array<{ name: string; count: number }>)
        : null,
    }),
    [albumIdentity]
  );

  const runNormalize = useCallback(async () => {
    await normalizeAlbum(albumId, albumArtist, albumName, buildNormalizeArgs());
    await queryClient.invalidateQueries({ queryKey: QK.normalizedTags(albumId) });
  }, [albumId, albumArtist, albumName, buildNormalizeArgs, queryClient]);

  const handleAdd = useCallback(
    async (canonicalId: string, name: string) => {
      setIsUpdating(true);
      setGenreInput("");
      setAutocomplete([]);
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR IGNORE INTO album_user_genres (album_id, canonical_id, name) VALUES (?, ?, ?)",
          [albumId, canonicalId, name]
        );
        await runNormalize();
      } finally {
        setIsUpdating(false);
      }
    },
    [albumId, runNormalize]
  );

  const handleRemove = useCallback(
    async (canonicalId: string) => {
      setIsUpdating(true);
      try {
        const db = await getDb();
        await db.execute(
          "DELETE FROM album_user_genres WHERE album_id = ? AND canonical_id = ?",
          [albumId, canonicalId]
        );
        await runNormalize();
      } finally {
        setIsUpdating(false);
      }
    },
    [albumId, runNormalize]
  );

  const handleExclude = useCallback(
    async (canonicalId: string) => {
      setIsUpdating(true);
      try {
        const db = await getDb();
        await db.execute(
          "INSERT OR IGNORE INTO album_genre_exclusions (album_id, canonical_id) VALUES (?, ?)",
          [albumId, canonicalId]
        );
        await normalizeAlbum(albumId, albumArtist, albumName, buildNormalizeArgs());
        await queryClient.invalidateQueries({ queryKey: QK.normalizedTags(albumId) });
        await queryClient.invalidateQueries({ queryKey: QK.albumGenreExclusions(albumId) });
      } finally {
        setIsUpdating(false);
      }
    },
    [albumId, albumArtist, albumName, buildNormalizeArgs, queryClient]
  );

  const handleInputChange = useCallback(async (value: string) => {
    setGenreInput(value);
    if (!value.trim()) {
      setAutocomplete([]);
      return;
    }
    const tree = await getCanonTree();
    const q = value.toLowerCase();
    setAutocomplete(
      tree.nodes.filter((n) => n.type === "genre" && n.name.toLowerCase().includes(q)).slice(0, 8)
    );
  }, []);

  const renderGroup = (label: string | null, genres: DisplayGenre[], removable: boolean) => {
    if (genres.length === 0) return null;
    return (
      <div className="age-group">
        {label && <span className="age-group-label">{label}</span>}
        <div className="age-chips">
          {genres.map((g) => {
            const rawSrc = g.id ? (rawSourcesByCanonicalId.get(g.id) ?? []) : [];
            const chipTitle =
              rawSrc.length > 0
                ? rawSrc
                    .map((r) => `"${r.raw_value}" (${r.source === "server" ? "file" : r.source})`)
                    .join(", ")
                : undefined;
            return (
              <span
                key={g.id ?? g.name}
                className={`age-chip${g.source ? ` age-chip--${g.source}` : ""}`}
              >
                <button
                  className="age-chip-label"
                  title={chipTitle}
                  onClick={() => onTagFilter?.(g.id !== null ? g.id : rawGenreId(g.name))}
                >
                  {g.name}
                </button>
                <button
                  className="age-chip-remove"
                  onClick={() => void (removable ? handleRemove(g.id!) : handleExclude(g.id!))}
                  title={removable ? "Remove" : "Exclude from this album"}
                  disabled={isUpdating || g.id === null}
                >
                  <X size={9} />
                </button>
              </span>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="album-genre-editor">
      <div className="age-header">
        <span className="age-title">Edit Genres</span>
        <button className="age-close" onClick={onClose} aria-label="Close genre editor">
          <X size={13} />
        </button>
      </div>

      <div className="age-body">
        {renderGroup("Added by you", genreGroups.manual, true)}
        {renderGroup("File", genreGroups.file, false)}
        {renderGroup("Last.fm", genreGroups.lastfm, false)}
        {renderGroup("MusicBrainz", genreGroups.musicbrainz, false)}
        {renderGroup("Folksonomy", genreGroups.folksonomy, false)}
        {renderGroup(null, genreGroups.unsourced, false)}

        <div className="age-add-row">
          <Plus size={11} className="age-add-icon" />
          <div className="age-input-wrap">
            <input
              ref={inputRef}
              className="age-input"
              type="text"
              placeholder="Add genre…"
              value={genreInput}
              onChange={(e) => void handleInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setGenreInput("");
                  setAutocomplete([]);
                } else if (e.key === "Enter" && autocomplete.length > 0) {
                  void handleAdd(autocomplete[0]!.id, autocomplete[0]!.name);
                }
              }}
              disabled={isUpdating}
            />
            {autocomplete.length > 0 && (
              <ul className="age-autocomplete">
                {autocomplete.map((n) => (
                  <li
                    key={n.id}
                    className="age-autocomplete-item"
                    onClick={() => void handleAdd(n.id, n.name)}
                  >
                    {n.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <UnmatchedSection albumId={albumId} albumArtist={albumArtist} albumName={albumName} />
      </div>
    </div>
  );
}
