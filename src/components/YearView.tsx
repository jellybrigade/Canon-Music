import type { AlbumRow } from "../hooks/useAlbums";
import type { ServerWithCredential } from "../hooks/useServer";
import { AlbumGrid } from "./AlbumGrid";

interface Props {
  albums: AlbumRow[];
  serverWithCredential: ServerWithCredential;
  onSelect: (album: AlbumRow) => void;
}

export function YearView({ albums, serverWithCredential, onSelect }: Props) {
  if (albums.length === 0) {
    return <p className="empty-state">No albums found.</p>;
  }

  const withYear = albums.filter((a) => a.year != null).sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  const noYear = albums.filter((a) => a.year == null);

  const byYear = new Map<number, AlbumRow[]>();
  for (const album of withYear) {
    const y = album.year as number;
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(album);
  }
  const sortedYears = [...byYear.keys()].sort((a, b) => b - a);

  return (
    <div className="year-view">
      {sortedYears.map((year) => (
        <section key={year} className="year-section">
          <h2 className="year-section-title">{year}</h2>
          <AlbumGrid
            albums={byYear.get(year)!}
            serverWithCredential={serverWithCredential}
            onSelect={onSelect}
          />
        </section>
      ))}
      {noYear.length > 0 && (
        <section className="year-section">
          <h2 className="year-section-title">Unknown Year</h2>
          <AlbumGrid
            albums={noYear}
            serverWithCredential={serverWithCredential}
            onSelect={onSelect}
          />
        </section>
      )}
    </div>
  );
}
