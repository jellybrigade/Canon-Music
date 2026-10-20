import { Music, User } from "lucide-react";
import type React from "react";
import type { ServerWithCredential } from "../../../hooks/useServer";
import type { PinnedItem } from "../pins";
import { usePinArt } from "../usePinArt";
import "./PinShelf.css";

const THUMB_SIZE = 128;
// Ctrl+K is a launcher: one row of tiles per kind, and past that the rest wait behind a count tile.
const SHELF_LIMIT = 6;

export type ShelfRow = PinnedItem["kind"];

const ROW_ORDER: ShelfRow[] = ["artist", "album"];

export type ShelfEntry =
  | { kind: "pin"; id: string; row: ShelfRow; pin: PinnedItem }
  | { kind: "more"; id: string; row: ShelfRow; hiddenCount: number; firstHiddenId: string };

function rowEntries(row: ShelfRow, pins: PinnedItem[], isExpanded: boolean): ShelfEntry[] {
  const toEntry = (pin: PinnedItem): ShelfEntry => ({ kind: "pin", id: pin.key, row, pin });
  if (isExpanded || pins.length <= SHELF_LIMIT) return pins.map(toEntry);
  const shown = pins.slice(0, SHELF_LIMIT - 1);
  const firstHidden = pins[shown.length];
  if (!firstHidden) return pins.map(toEntry);
  return [
    ...shown.map(toEntry),
    { kind: "more", id: `more-${row}`, row, hiddenCount: pins.length - shown.length, firstHiddenId: firstHidden.key },
  ];
}

// Artists row first, then albums, each keeping the newest-first order it was given.
export function shelfEntries(pins: PinnedItem[], expandedRows: readonly ShelfRow[]): ShelfEntry[] {
  return ROW_ORDER.flatMap((row) =>
    rowEntries(
      row,
      pins.filter((pin) => pin.kind === row),
      expandedRows.includes(row),
    ),
  );
}

interface Props {
  entries: ShelfEntry[];
  serverWithCredential: ServerWithCredential;
  focusedId: string | null;
  focusedRef: React.Ref<HTMLButtonElement>;
  onHover: (entry: ShelfEntry) => void;
  onActivate: (entry: ShelfEntry) => void;
}

export function PinShelf({ entries, serverWithCredential, focusedId, focusedRef, onHover, onActivate }: Props) {
  const { nameOf, thumbOf } = usePinArt(serverWithCredential, THUMB_SIZE);

  const renderTile = (entry: ShelfEntry) => {
    const isFocused = entry.id === focusedId;
    const name = entry.kind === "pin" ? nameOf(entry.pin) : "More";
    const detail = entry.kind === "pin" && entry.pin.kind === "album" ? (entry.pin.album.artist ?? "") : "";
    const thumbUrl = entry.kind === "pin" ? thumbOf(entry.pin) : null;
    return (
      <button
        key={entry.id}
        ref={isFocused ? focusedRef : null}
        className={`cp-shelf-tile${entry.kind === "more" ? " cp-shelf-more" : ""}${isFocused ? " cp-item--focused" : ""}`}
        title={entry.kind === "pin" ? [name, detail].filter(Boolean).join(" · ") : `Show ${entry.hiddenCount} more`}
        onMouseEnter={() => onHover(entry)}
        onMouseDown={(e) => {
          e.preventDefault();
          onActivate(entry);
        }}
      >
        <span className={`cp-shelf-art${entry.kind === "pin" ? ` cp-shelf-art--${entry.pin.kind}` : ""}`}>
          {thumbUrl ? (
            <img src={thumbUrl} alt="" decoding="async" />
          ) : entry.kind === "more" ? (
            `+${entry.hiddenCount}`
          ) : entry.pin.kind === "artist" ? (
            <User size={20} />
          ) : (
            <Music size={20} />
          )}
        </span>
        <span className="cp-shelf-name">{name}</span>
        <span className="cp-shelf-detail">{detail}</span>
      </button>
    );
  };

  return (
    <>
      {ROW_ORDER.map((row) => {
        const rowTiles = entries.filter((entry) => entry.row === row);
        return rowTiles.length > 0 ? (
          <div key={row} className="cp-shelf">
            {rowTiles.map(renderTile)}
          </div>
        ) : null;
      })}
    </>
  );
}
