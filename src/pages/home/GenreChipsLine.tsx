import type { GenreRow } from "../../hooks/useGenres";

// One flowing typographic line, size/weight stepped by relevance, no boxes.

interface FeaturedGenresSectionProps {
  genres: GenreRow[];
  onPlayGenre: (canonicalId: string, label?: string) => void;
}

export function GenreChipsLine({ genres, onPlayGenre }: FeaturedGenresSectionProps) {
  if (genres.length === 0) return null;
  const ranked = genres.slice(0, 10);
  return (
    <>
      <p className="genre-line__caption">Recent genres · click to start a radio</p>
      <p className="genre-line">
        {ranked.map((g, i) => (
          <span key={g.canonical_id}>
            <button
              type="button"
              className={`genre-line__item genre-line__item--tier${Math.min(Math.floor(i / 3), 2)}`}
              onClick={() => onPlayGenre(g.canonical_id, g.name)}
              title={`Start a radio from ${g.name}`}
            >
              {g.name}
            </button>
            {i < ranked.length - 1 && <span className="genre-line__sep" aria-hidden="true">·</span>}
          </span>
        ))}
      </p>
    </>
  );
}
