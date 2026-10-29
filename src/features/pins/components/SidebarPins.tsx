import { Music, User } from "lucide-react";
import { useState } from "react";
import type { ServerWithCredential } from "../../../hooks/useServer";
import type { AlbumRow } from "../../../types/library";
import { ContextMenu } from "../../../ui/ContextMenu";
import type { SearchArtist } from "../../search/useSearch";
import { type PinnedItem, pinsNewestFirst, pinTargetOf } from "../pins";
import { usePinArt } from "../usePinArt";
import { usePins, useSetPinned } from "../usePins";
import "./SidebarPins.css";
import { CoverImg } from "../../../components/CoverImg";

const THUMB_SIZE = 64;
// The rest are listed in Ctrl+K.
const SIDEBAR_PIN_LIMIT = 3;

const KIND_LABEL: Record<PinnedItem["kind"], string> = { album: "Album", artist: "Artist" };

interface Props {
  serverWithCredential: ServerWithCredential | undefined;
  isExpanded: boolean;
  onSelectAlbum: (album: AlbumRow) => void;
  onSelectArtist: (artist: SearchArtist) => void;
}

type PinMenu = { x: number; y: number; item: PinnedItem };

export function SidebarPins({ serverWithCredential, ...listProps }: Props) {
  const { data: pins } = usePins(serverWithCredential?.server.id);
  // A pin read that fails or is still running shows nothing too: the group only exists once something is pinned.
  const items = pins ? pinsNewestFirst(pins).slice(0, SIDEBAR_PIN_LIMIT) : [];
  if (!serverWithCredential || items.length === 0) return null;
  return <SidebarPinList items={items} serverWithCredential={serverWithCredential} {...listProps} />;
}

interface ListProps extends Omit<Props, "serverWithCredential"> {
  items: PinnedItem[];
  serverWithCredential: ServerWithCredential;
}

// Split from the gate so the image, cover and name lookups only mount while a pin shows.
function SidebarPinList({ items, serverWithCredential, isExpanded, onSelectAlbum, onSelectArtist }: ListProps) {
  const setPinned = useSetPinned();
  const { nameOf, thumbOf } = usePinArt(serverWithCredential, THUMB_SIZE);
  const [menu, setMenu] = useState<PinMenu | null>(null);

  const albums = items.filter((item) => item.kind === "album");
  const artists = items.filter((item) => item.kind === "artist");
  const { server } = serverWithCredential;

  const activate = (item: PinnedItem) =>
    item.kind === "artist" ? onSelectArtist(item.artist) : onSelectAlbum(item.album);

  const renderPin = (item: PinnedItem) => {
    const name = nameOf(item);
    const thumbUrl = thumbOf(item);
    return (
      <button
        key={item.key}
        className="sidebar-pin"
        title={`${name} · ${KIND_LABEL[item.kind]}`}
        onClick={() => activate(item)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, item });
        }}
      >
        <span className={`sidebar-pin__thumb sidebar-pin__thumb--${item.kind}`}>
          {thumbUrl ? (
            <CoverImg src={thumbUrl} alt="" decoding="async" loading="lazy" />
          ) : item.kind === "artist" ? (
            <User size={14} />
          ) : (
            <Music size={14} />
          )}
        </span>
        {isExpanded && <span className="sidebar-pin__label">{name}</span>}
      </button>
    );
  };

  return (
    <div className="sidebar-pins">
      {isExpanded ? <p className="sidebar-pins__heading">Pinned</p> : <div className="sidebar-pins__divider" />}
      <div className="sidebar-pins__list">
        {albums.map(renderPin)}
        {albums.length > 0 && artists.length > 0 && <div className="sidebar-pins__separator" />}
        {artists.map(renderPin)}
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <button
            onClick={() => {
              setPinned(pinTargetOf(menu.item, server.id), false).catch((err: unknown) =>
                console.error("pins: couldn't remove the pin", err),
              );
              setMenu(null);
            }}
          >
            Unpin
          </button>
        </ContextMenu>
      )}
    </div>
  );
}
