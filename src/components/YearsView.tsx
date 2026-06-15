import { AlbumGrid } from "./AlbumGrid";
import { useAlbums } from "../hooks/useAlbums";
import type { AlbumRow } from "../hooks/useAlbums";
import type { ServerWithCredential } from "../hooks/useServer";
import type { RadioMode } from "../store/player";

interface Props {
  serverWithCredential: ServerWithCredential;
  onSelect: (album: AlbumRow) => void;
  onStartRadio: (album: AlbumRow, mode: RadioMode) => void;
  serverDisplayName?: string;
}

export function YearsView({ serverWithCredential, onSelect, onStartRadio, serverDisplayName }: Props) {
  const { data: albums } = useAlbums("year");

  return (
    <main className="library">
      <header className="library-header">
        <h1>Years</h1>
        <span className="server-name">{serverDisplayName}</span>
      </header>
      <AlbumGrid
        albums={albums ?? []}
        serverWithCredential={serverWithCredential}
        onSelect={onSelect}
        onStartRadio={onStartRadio}
        emptyMessage="No albums yet. Sync your library first."
        scrollKey="years"
        sort="year"
      />
    </main>
  );
}
