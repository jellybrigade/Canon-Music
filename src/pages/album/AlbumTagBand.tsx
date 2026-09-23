import { Pencil } from "lucide-react";
import { rawGenreId } from "../../features/tags/lib/canonicalize";
import type { NormalizedTags } from "../../features/tags/lib/tagNormalize";
import type { DisplayGenre } from "../../components/AlbumGenreEditor";
import type { RawSourcesByCanonicalId } from "./albumGenres";
import "./AlbumTagBand.css";

interface Props {
  displayGenres: DisplayGenre[];
  normalizedTags: NormalizedTags | null | undefined;
  rawSourcesByCanonicalId: RawSourcesByCanonicalId;
  unmatchedCount: number;
  showGenreEditor: boolean;
  onToggleGenreEditor: () => void;
  onOpenGenreEditor: () => void;
  onTagFilter?: (canonicalId: string) => void;
  onOpenDrawer: () => void;
}

interface TagChipProps {
  tag: DisplayGenre;
  fallbackTitle: string | undefined;
  rawSourcesByCanonicalId: RawSourcesByCanonicalId;
  onTagFilter?: (canonicalId: string) => void;
  onOpenDrawer: () => void;
}

function TagChip({ tag, fallbackTitle, rawSourcesByCanonicalId, onTagFilter, onOpenDrawer }: TagChipProps) {
  const rawSources = tag.id ? (rawSourcesByCanonicalId.get(tag.id) ?? []) : [];
  const chipTitle = rawSources.length > 0
    ? rawSources.map((r) => `"${r.raw_value}" (${r.source === "server" ? "file" : r.source})`).join(", ")
    : fallbackTitle;
  const sourceClass = tag.source ? ` album-tag-chip--${tag.source}` : "";
  return (
    <button
      className={`album-tag-chip${sourceClass}`}
      title={chipTitle}
      onClick={() => onTagFilter?.(tag.id !== null ? tag.id : rawGenreId(tag.name))}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenDrawer();
      }}
    >
      {tag.name}
    </button>
  );
}

export function AlbumTagBand({
  displayGenres,
  normalizedTags,
  rawSourcesByCanonicalId,
  unmatchedCount,
  showGenreEditor,
  onToggleGenreEditor,
  onOpenGenreEditor,
  onTagFilter,
  onOpenDrawer,
}: Props) {
  const chipProps = { rawSourcesByCanonicalId, onTagFilter, onOpenDrawer };
  return (
    <section className="album-tag-band" aria-label="Album tags">
      <div className="album-tag-column">
        <div className="album-tag-column-header">
          <h3 className="album-tag-column-title" title="Genre tags aggregated from track files and enrichment services (Last.fm, MusicBrainz)">Genres</h3>
          <button
            className="album-tag-add-genre-btn"
            onClick={onToggleGenreEditor}
            title={showGenreEditor ? "Close genre editor" : "Edit genres"}
          >
            <Pencil size={10} />
          </button>
        </div>

        {displayGenres.map((tag) => (
          <TagChip key={tag.id ?? tag.name} tag={tag} fallbackTitle={tag.source ?? undefined} {...chipProps} />
        ))}

        {unmatchedCount > 0 && !showGenreEditor && (
          <button
            className="album-unmatched-hint"
            onClick={onOpenGenreEditor}
            title="Open genre editor to map unmatched genres"
          >
            {unmatchedCount} unmatched →
          </button>
        )}
      </div>
      {normalizedTags && normalizedTags.descriptors.length > 0 && (
        <div className="album-tag-column">
          <h3 className="album-tag-column-title" title="Mood and style descriptors from enrichment services">Descriptors</h3>
          {normalizedTags.descriptors.map((tag) => (
            <TagChip key={tag.id ?? tag.name} tag={tag} fallbackTitle={undefined} {...chipProps} />
          ))}
        </div>
      )}
      {normalizedTags && normalizedTags.scenes.length > 0 && (
        <div className="album-tag-column">
          <h3 className="album-tag-column-title" title="Musical scenes, movements and subgenre contexts">Scenes & Movements</h3>
          {normalizedTags.scenes.map((tag) => (
            <TagChip key={tag.id ?? tag.name} tag={tag} fallbackTitle={undefined} {...chipProps} />
          ))}
        </div>
      )}
    </section>
  );
}
