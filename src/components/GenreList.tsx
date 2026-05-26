import type { GenreRow } from "../hooks/useGenres";

interface Props {
  genres: GenreRow[];
  onSelect: (genre: GenreRow) => void;
}

export function GenreList({ genres, onSelect }: Props) {
  if (genres.length === 0) {
    return <p className="empty-state">No genres found. Sync first.</p>;
  }

  return (
    <div className="genre-list">
      {genres.map((genre) => (
        <button
          key={genre.name}
          className="genre-row"
          onClick={() => onSelect(genre)}
        >
          <span className="genre-row-name">{genre.name}</span>
          <span className="genre-row-meta">
            {genre.album_count} {genre.album_count === 1 ? "album" : "albums"} · {genre.track_count} {genre.track_count === 1 ? "track" : "tracks"}
          </span>
        </button>
      ))}
    </div>
  );
}
