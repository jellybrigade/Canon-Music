import { AlbumGrid } from "./AlbumGrid";
import { useAlbums } from "../hooks/useAlbums";
import { useAlbumBrowseSessionStore } from "../store/albumBrowseSessionStore";
import type { AlbumRow } from "../types/library";
import type { ServerWithCredential } from "../hooks/useServer";
import type { RadioMode } from "../store/player";

interface Props {
  serverWithCredential: ServerWithCredential;
  onSelect: (album: AlbumRow) => void;
  onStartRadio: (album: AlbumRow, mode: RadioMode) => void;
  serverDisplayName?: string;
}

export function YearsView({ serverWithCredential, onSelect, onStartRadio, serverDisplayName }: Props) {
  const { data: albums, isLoading, error } = useAlbums("year");

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
        emptyMessage={{
          title: "No albums yet",
          hint: "Sync your library from Settings and this view groups every album by release year.",
        }}
        sort="year"
        isLoading={isLoading}
        error={error}
        onRetry={() => useAlbumBrowseSessionStore.getState().bumpRefresh()}
      />
    </main>
  );
}
