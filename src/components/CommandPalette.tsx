import { House, List, ListMusic, Music, Search, Settings, User, Users } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { resolvePortraitUrl } from "../clients/lastfm";
import { getCoverArtUrl } from "../clients/navidromeUrls";
import {
  type ActivateIntent,
  intentOf,
  PinShelf,
  type ShelfEntry,
  type ShelfRow,
  shelfEntries,
} from "../features/pins/components/PinShelf";
import { type PinnedItem, type Pins, pinsNewestFirst } from "../features/pins/pins";
import type { RecentItem, RecentTarget, RecentTrack } from "../features/recents/recents";
import { pickTopResult, type TopResult, toSearchTokens } from "../features/search/searchScore";
import { type SearchAlbum, type SearchArtist, useSearch } from "../features/search/useSearch";
import { useAlbumDisplayName } from "../hooks/useAlbumDisplayName";
import { resolveArtistImageUrl, useArtistImageMap } from "../hooks/useArtistImageCache";
import type { ServerWithCredential } from "../hooks/useServer";
import { rankCommands } from "../lib/commandMatch";
import { matchRanges } from "../lib/matchRanges";
import { plural } from "../lib/plural";
import type { AlbumTrackTarget } from "../lib/routes";
import type { AlbumRow } from "../types/library";
import "./CommandPalette.css";
import { ContextMenu } from "../ui/ContextMenu";
import { useOwnKeyboard } from "../ui/keyboardOwners";
import { useOverlayDismiss } from "../ui/useOverlayDismiss";
import { CoverImg } from "./CoverImg";

type View = "home" | "nowplaying" | "library" | "artists" | "playlists" | "tags" | "settings";

interface NavCommand {
  kind: "nav";
  id: string;
  label: string;
  icon: React.ReactNode;
  view: View;
}

export interface PaletteAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  run: () => void;
}

interface ActionCommand extends PaletteAction {
  kind: "action";
}

type Command = NavCommand | ActionCommand;

interface AlbumResult {
  kind: "album";
  id: string;
  server_id: string;
  name: string;
  artist: string | null;
  artwork_url: string | null;
}

interface TrackResult {
  kind: "track";
  id: string;
  server_id: string;
  album_id: string | null;
  title: string;
  artist: string | null;
  album_name: string | null;
  artwork_url: string | null;
}

interface ArtistResult extends Omit<SearchArtist, "kind"> {
  kind: "artist";
  id: string;
}

interface SeeAllRow {
  kind: "all";
  id: "all";
  query: string;
}

type LibraryResult = AlbumResult | TrackResult | ArtistResult;

type Item = ShelfEntry | Command | LibraryResult | SeeAllRow;

// What Enter and Shift+Enter say they do, per focused row; null where Shift+Enter has nothing to play.
type HintKey =
  | Exclude<Item["kind"], "pin">
  | `${Extract<Item, { kind: "pin" }>["pin"]["kind"]}-pin`
  | "track-without-album";

const HINTS: Record<HintKey, { open: string; play: string | null }> = {
  nav: { open: "go to", play: null },
  action: { open: "run", play: null },
  more: { open: "show all", play: null },
  all: { open: "show all results", play: null },
  album: { open: "open", play: "play" },
  "album-pin": { open: "open", play: "play" },
  artist: { open: "open", play: "start radio" },
  "artist-pin": { open: "open", play: "start radio" },
  track: { open: "open album", play: "play" },
  "track-without-album": { open: "play", play: null },
};

const hintKey = (item: Item): HintKey => {
  if (item.kind === "pin") return `${item.pin.kind}-pin`;
  if (item.kind === "track" && item.album_id === null) return "track-without-album";
  return item.kind;
};

// Ids are unique inside a kind but not across them, and an album and a track can carry the
// same native id on some servers.
const itemKey = (item: Item) => `${item.kind}:${item.id}`;

const NAV_COMMANDS: NavCommand[] = [
  { kind: "nav", id: "nav-home", label: "Home", icon: <House size={16} />, view: "home" },
  { kind: "nav", id: "nav-library", label: "Library", icon: <Music size={16} />, view: "library" },
  { kind: "nav", id: "nav-artists", label: "Artists", icon: <Users size={16} />, view: "artists" },
  { kind: "nav", id: "nav-playlists", label: "Playlists", icon: <ListMusic size={16} />, view: "playlists" },
  { kind: "nav", id: "nav-queue", label: "Queue", icon: <List size={16} />, view: "nowplaying" },
  { kind: "nav", id: "nav-settings", label: "Settings", icon: <Settings size={16} />, view: "settings" },
];

const RESULTS_CAP = 4;
const SKELETON_ROWS = 3;
const ROW_ART_SIZE = 48;
const TOP_ART_SIZE = 96;

const toAlbumResult = (album: SearchAlbum): AlbumResult => ({
  kind: "album",
  id: album.id,
  server_id: album.server_id,
  name: album.name,
  artist: album.artist,
  artwork_url: album.artwork_url,
});

const toTrackResult = (track: RecentTrack): TrackResult => ({
  kind: "track",
  id: track.id,
  server_id: track.server_id,
  album_id: track.album_id,
  title: track.title,
  artist: track.artist,
  album_name: track.album_name,
  artwork_url: track.artwork_url,
});

const toArtistResult = (artist: SearchArtist): ArtistResult => ({
  ...artist,
  kind: "artist",
  id: `artist-${artist.name}`,
});

const KIND_LABEL: Record<LibraryResult["kind"], string> = { artist: "Artist", album: "Album", track: "Track" };

function toLibraryResult(top: TopResult | RecentItem): LibraryResult {
  if (top.kind === "artist") return toArtistResult(top.artist);
  if (top.kind === "album") return toAlbumResult(top.album);
  return toTrackResult(top.track);
}

// The head of a section, minus the row already lifted into the top result.
function sectionOf<T extends LibraryResult>(rows: T[], top: LibraryResult | null): T[] {
  return rows.filter((row) => !top || itemKey(row) !== itemKey(top)).slice(0, RESULTS_CAP);
}

function MatchedText({ text, tokens }: { text: string; tokens: readonly string[] }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const { start, end } of matchRanges(text, tokens)) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <strong key={start} className="cp-match">
        {text.slice(start, end)}
      </strong>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

const isShelfItem = (item: Item | undefined): item is ShelfEntry => item?.kind === "pin" || item?.kind === "more";

// The 2D row an item sits in (a shelf row, a line of the Go to grid), or null for a plain list row.
type GridRow = string | null;

const NAV_GRID_COLUMNS = 3;

// Left and right move along a row; up and down step between rows, keeping the column where the
// row is long enough, and on into the lists below. Null leaves the key to the text field.
function arrowTarget(rows: GridRow[], from: number, key: string): number | null {
  const row = rows[from] ?? null;
  if (key === "ArrowLeft" || key === "ArrowRight") {
    if (row === null) return null;
    const to = from + (key === "ArrowRight" ? 1 : -1);
    return rows[to] === row ? to : from;
  }
  if (key === "ArrowDown") {
    if (row === null) return Math.min(from + 1, rows.length - 1);
    const below = rows.findIndex((other, i) => i > from && other !== row);
    if (below === -1) return from;
    return inColumn(rows, below, from - rows.indexOf(row));
  }
  if (key === "ArrowUp") {
    if (row === null) {
      const aboveRow = rows[from - 1] ?? null;
      return aboveRow === null ? Math.max(from - 1, 0) : rows.indexOf(aboveRow);
    }
    const above = rows.indexOf(row) - 1;
    const aboveRow = rows[above];
    if (aboveRow === undefined) return from;
    return aboveRow === null ? above : inColumn(rows, rows.indexOf(aboveRow), from - rows.indexOf(row));
  }
  return null;
}

// The item at `column` in the row starting at `start`, or that row's last item if it is shorter.
function inColumn(rows: GridRow[], start: number, column: number): number {
  const row = rows[start];
  if (row === null) return start;
  let to = start;
  while (to - start < column && rows[to + 1] === row) to++;
  return to;
}

// useDeferredValue only defers rendering - it still fires one search per
// keystroke. A real debounce keeps typing from queuing an FTS scan per character.
const SEARCH_DEBOUNCE_MS = 150;

interface Props {
  open: boolean;
  onClose: () => void;
  onNavigate: (view: View) => void;
  onSelectAlbum: (album: AlbumRow) => void;
  onSelectArtist: (name: string, albumCount: number) => void;
  onPlayTrack: (id: string) => void;
  onOpenTrack: (target: AlbumTrackTarget) => void;
  onPlayAlbum: (album: AlbumRow) => void;
  onStartArtistRadio: (name: string) => void;
  onSearchAll: (query: string) => void;
  onOpened: (target: RecentTarget) => void;
  onUnpin: (pin: PinnedItem) => void;
  serverWithCredential?: ServerWithCredential;
  serverId?: string;
  pins?: Pins;
  recents?: RecentItem[];
  actions?: PaletteAction[];
}

export function CommandPalette({
  open,
  onClose,
  onNavigate,
  onSelectAlbum,
  onSelectArtist,
  onPlayTrack,
  onOpenTrack,
  onPlayAlbum,
  onStartArtistRadio,
  onSearchAll,
  onOpened,
  onUnpin,
  serverWithCredential,
  serverId,
  pins,
  recents,
  actions,
}: Props) {
  const albumDisplayName = useAlbumDisplayName();
  const [raw, setRaw] = useState("");
  const [deferred, setDeferred] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const focusedRef = useRef<HTMLButtonElement>(null);
  // Held by identity, not position: `items` rebuilds asynchronously, so a stored index would
  // silently land the highlight (and Enter) on whatever row inherited that ordinal.
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [expandedShelfRows, setExpandedShelfRows] = useState<ShelfRow[]>([]);
  const [pinMenu, setPinMenu] = useState<{ x: number; y: number; pin: PinnedItem } | null>(null);

  const trimmedRaw = raw.trim();
  useEffect(() => {
    const t = setTimeout(() => setDeferred(trimmedRaw), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [trimmedRaw]);

  const libraryServerId = serverId ?? serverWithCredential?.server.id;
  const { data: results, isError } = useSearch(deferred, libraryServerId);

  const searchCommands: Command[] = deferred
    ? rankCommands<Command>(
        [...NAV_COMMANDS, ...(actions ?? []).map((action) => ({ ...action, kind: "action" as const }))],
        deferred,
      ).slice(0, RESULTS_CAP)
    : [];
  const library = deferred && !isError ? results : undefined;
  const top = library ? pickTopResult(library, deferred) : null;
  const topResult = top ? toLibraryResult(top) : null;
  // One past the cap: the top result may be the head of any of these.
  const searchArtists = sectionOf(library?.artists.slice(0, RESULTS_CAP + 1).map(toArtistResult) ?? [], topResult);
  const searchAlbums = sectionOf(library?.albums.slice(0, RESULTS_CAP + 1).map(toAlbumResult) ?? [], topResult);
  const searchTracks = sectionOf(library?.tracks.slice(0, RESULTS_CAP + 1).map(toTrackResult) ?? [], topResult);
  // From the rows, not the top result: the previous query's rows, kept on screen while the next
  // one runs, need not score against the new text.
  const hasLibraryResults = library
    ? library.artists.length + library.albums.length + library.tracks.length > 0
    : false;

  const pinned = !deferred && pins && serverWithCredential ? pinsNewestFirst(pins) : [];
  const shelf = shelfEntries(pinned, expandedShelfRows);
  const recentRows = !deferred && recents ? recents.map(toLibraryResult) : [];
  const items: Item[] = deferred
    ? [
        ...searchCommands,
        ...(topResult ? [topResult] : []),
        ...searchArtists,
        ...searchAlbums,
        ...searchTracks,
        ...(hasLibraryResults ? [{ kind: "all" as const, id: "all" as const, query: deferred }] : []),
      ]
    : [...shelf, ...recentRows, ...NAV_COMMANDS];
  const rows: GridRow[] = deferred
    ? items.map(() => null)
    : [
        ...shelf.map((entry) => `shelf:${entry.row}`),
        ...recentRows.map(() => null),
        ...NAV_COMMANDS.map((_, i) => `nav:${Math.floor(i / NAV_GRID_COLUMNS)}`),
      ];

  // Nothing focused, or a row that has since gone: the first row, which is what a freshly
  // arrived result set should offer Enter.
  const focusedIdx = Math.max(
    0,
    items.findIndex((item) => itemKey(item) === focusedKey),
  );

  const recentOffset = shelf.length;
  const navOffset = recentOffset + recentRows.length;
  const focusedItem = items[focusedIdx];
  const focusedHint = focusedItem ? HINTS[hintKey(focusedItem)] : null;
  const topOffset = searchCommands.length;
  const artistOffset = topOffset + (topResult ? 1 : 0);
  const albumOffset = artistOffset + searchArtists.length;
  const trackOffset = albumOffset + searchAlbums.length;
  const seeAllOffset = trackOffset + searchTracks.length;
  const listboxId = useId();
  const optionId = (idx: number) => `${listboxId}-option-${idx}`;
  const tokens = toSearchTokens(deferred);
  const artistImageMap = useArtistImageMap();

  const activate = useCallback(
    (item: Item, intent: ActivateIntent) => {
      if (item.kind === "all") {
        onSearchAll(item.query);
        onClose();
        return;
      }
      if (item.kind === "more") {
        setExpandedShelfRows((rows) => [...rows, item.row]);
        // The count tile is gone once its row unfolds; the first pin it was hiding takes the focus.
        setFocusedKey(`pin:${item.firstHiddenId}`);
        return;
      }
      const isPlay = intent === "play";
      const album = (row: AlbumRow) => {
        onOpened({ kind: "album", serverId: row.server_id, albumId: row.id });
        if (isPlay) onPlayAlbum(row);
        else onSelectAlbum(row);
      };
      const artist = (name: string, albumCount: number) => {
        if (libraryServerId) onOpened({ kind: "artist", serverId: libraryServerId, artistName: name });
        if (isPlay) onStartArtistRadio(name);
        else onSelectArtist(name, albumCount);
      };
      if (item.kind === "pin") {
        const { pin } = item;
        if (pin.kind === "album") album(pin.album);
        else artist(pin.artist.name, pin.artist.album_count);
      } else if (item.kind === "nav") {
        onNavigate(item.view);
      } else if (item.kind === "action") {
        item.run();
      } else if (item.kind === "album") {
        album({
          id: item.id,
          // From the row, never the selected server: stamping the current
          // selection onto a row is what silently builds URLs against the
          // wrong host (see known-issues.md).
          server_id: item.server_id,
          name: item.name,
          artist: item.artist,
          year: null,
          artwork_url: item.artwork_url,
        });
      } else if (item.kind === "track") {
        onOpened({ kind: "track", serverId: item.server_id, trackId: item.id });
        if (isPlay || item.album_id === null) onPlayTrack(item.id);
        else onOpenTrack({ albumId: item.album_id, trackId: item.id });
      } else if (item.kind === "artist") {
        artist(item.name, item.album_count);
      }
      onClose();
      // No serverWithCredential dep: the album branch deliberately reads item.server_id, so a
      // replaced server object would only churn this callback's identity.
    },
    [
      onNavigate,
      onSelectAlbum,
      onSelectArtist,
      onPlayTrack,
      onOpenTrack,
      onPlayAlbum,
      onStartArtistRadio,
      onSearchAll,
      onOpened,
      libraryServerId,
      onClose,
    ],
  );

  useEffect(() => {
    if (open) {
      setRaw("");
      // Reset the debounced value too, or the palette re-opens showing the
      // previous session's results for the 150ms until the timer catches up.
      setDeferred("");
      setFocusedKey(null);
      setExpandedShelfRows([]);
      setPinMenu(null);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setFocusedKey(null);
  }, [deferred]);

  // .cp-results scrolls and can hold more rows than fit, so arrowing down past the fold
  // otherwise moves a selection the user can't see.
  useEffect(() => {
    focusedRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusedIdx]);

  // Read through a ref, so the listener is armed once per open rather than torn down and
  // re-added for every keystroke, every arrow press and every result set that arrives - all of
  // which rebuild `items`. Same pattern as useSearchShortcuts.
  const dismiss = useOverlayDismiss(onClose);

  // The tile's neighbour in its row takes the focus, so Delete can be pressed again in place.
  const unpin = (pin: PinnedItem) => {
    const row = shelf.filter((entry) => entry.row === pin.kind);
    const at = row.findIndex((entry) => entry.kind === "pin" && entry.pin.key === pin.key);
    const neighbour = row[at + 1] ?? row[at - 1];
    setFocusedKey(neighbour ? itemKey(neighbour) : null);
    onUnpin(pin);
  };

  const keys = {
    items,
    rows,
    focusedIdx,
    activate,
    unpin,
    isMenuOpen: pinMenu !== null,
    onClose,
    trimmedRaw,
    deferred,
  };
  const keysRef = useRef(keys);
  keysRef.current = keys;

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      const { items, rows, focusedIdx, activate, unpin, isMenuOpen, onClose, trimmedRaw, deferred } = keysRef.current;
      if (isMenuOpen) return;
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Until the debounce catches up the rows answer the previous text, so keys stay with the field
      // and Enter searches what was typed.
      if (trimmedRaw !== deferred) {
        if (e.key === "Enter" && trimmedRaw) {
          e.preventDefault();
          activate({ kind: "all", id: "all", query: trimmedRaw }, intentOf(e));
        }
        return;
      }
      if (arrowTarget(rows, focusedIdx, e.key) !== null) {
        e.preventDefault();
        const { key } = e;
        // Derived from the previous key rather than the render-time index: this is a native
        // listener, so two presses arriving in one task are batched and both would read the
        // same snapshot and move a single row between them.
        setFocusedKey((current) => {
          const from = Math.max(
            0,
            items.findIndex((item) => itemKey(item) === current),
          );
          const to = items[arrowTarget(rows, from, key) ?? from];
          return to ? itemKey(to) : current;
        });
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = items[focusedIdx];
        if (item) activate(item, intentOf(e));
      } else if (e.key === "Delete") {
        const item = items[focusedIdx];
        if (item?.kind !== "pin") return;
        e.preventDefault();
        unpin(item.pin);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useOwnKeyboard(open);

  if (!open) return null;

  const isSearching = Boolean(deferred) && !isError && !results;
  const isEmpty = Boolean(library) && !hasLibraryResults && searchCommands.length === 0;

  const optionProps = (item: Item, idx: number, className: string) => ({
    ref: idx === focusedIdx ? focusedRef : null,
    id: optionId(idx),
    role: "option",
    "aria-selected": idx === focusedIdx,
    className: `${className}${idx === focusedIdx ? " cp-item--focused" : ""}`,
    onMouseEnter: () => setFocusedKey(itemKey(item)),
    onMouseDown: (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      activate(item, intentOf(e));
    },
  });

  const coverUrl = (artworkUrl: string | null, size: number) =>
    serverWithCredential && artworkUrl
      ? getCoverArtUrl(
          serverWithCredential.server.url,
          serverWithCredential.server.username,
          serverWithCredential.credential,
          artworkUrl,
          size,
        )
      : null;

  const artOf = (result: LibraryResult, size: number) => {
    if (result.kind === "artist") {
      return {
        url: resolveArtistImageUrl(artistImageMap, result.name, resolvePortraitUrl(result)),
        isRound: true,
        fallback: <User size={16} />,
      };
    }
    return { url: coverUrl(result.artwork_url, size), isRound: false, fallback: <Music size={16} /> };
  };

  const nameOf = (result: LibraryResult) =>
    result.kind === "album" ? albumDisplayName(result.name) : result.kind === "track" ? result.title : result.name;

  const detailOf = (result: LibraryResult) =>
    result.kind === "artist"
      ? `${result.album_count} ${plural(result.album_count, "album")}`
      : [result.artist, result.kind === "track" ? result.album_name : null].filter(Boolean).join(" · ");

  // Rows outside a kind's own section (the top result, recents) say which kind they are.
  const renderResultRow = (result: LibraryResult, idx: number, variant: "row" | "top" | "mixed" = "row") => {
    const isTop = variant === "top";
    const art = artOf(result, isTop ? TOP_ART_SIZE : ROW_ART_SIZE);
    const artClass = `cp-art${isTop ? " cp-art--large" : ""}${art.isRound ? " cp-art--artist" : ""}`;
    const detail =
      variant === "row" ? detailOf(result) : [KIND_LABEL[result.kind], detailOf(result)].filter(Boolean).join(" · ");
    return (
      <button key={itemKey(result)} {...optionProps(result, idx, `cp-result-row${isTop ? " cp-top-row" : ""}`)}>
        {art.url ? (
          <CoverImg className={artClass} src={art.url} alt="" decoding="async" />
        ) : (
          <span className={`${artClass} cp-art--placeholder`}>{art.fallback}</span>
        )}
        <span className="cp-result-text">
          <span className="cp-result-primary">
            <MatchedText text={nameOf(result)} tokens={tokens} />
          </span>
          {detail && <span className="cp-result-detail">{detail}</span>}
        </span>
      </button>
    );
  };

  const renderCommandRow = (command: Command, idx: number) => (
    <button key={itemKey(command)} {...optionProps(command, idx, "cp-result-row")}>
      <span className="cp-row-icon">{command.icon}</span>
      <span className="cp-result-primary">{command.label}</span>
    </button>
  );

  const resultSection = (label: string, rows: LibraryResult[], offset: number) =>
    rows.length > 0 && (
      <div className="cp-section" role="group" aria-label={label}>
        <p className="cp-section-label">{label}</p>
        {rows.map((row, i) => renderResultRow(row, offset + i))}
      </div>
    );

  const seeAll = items[seeAllOffset];

  return (
    <div className="cp-backdrop" {...dismiss}>
      <div className="cp-modal" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="cp-input-row">
          <input
            ref={inputRef}
            className="cp-input"
            placeholder="Search albums, tracks, artists…"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={focusedItem ? optionId(focusedIdx) : undefined}
          />
          <kbd className="cp-esc-hint">esc</kbd>
        </div>

        <div className="cp-results" id={listboxId} role="listbox" aria-label="Results" aria-busy={isSearching}>
          {serverWithCredential && shelf.length > 0 && (
            <div className="cp-section" role="group" aria-label="Pinned">
              <p className="cp-section-label">Pinned</p>
              <PinShelf
                entries={shelf}
                serverWithCredential={serverWithCredential}
                focusedId={isShelfItem(focusedItem) ? focusedItem.id : null}
                focusedRef={focusedRef}
                optionIdOf={(entry) => optionId(shelf.indexOf(entry))}
                onHover={(entry) => setFocusedKey(itemKey(entry))}
                onActivate={activate}
                onPinMenu={(pin, x, y) => setPinMenu({ x, y, pin })}
              />
            </div>
          )}

          {recentRows.length > 0 && (
            <div className="cp-section" role="group" aria-label="Recent">
              <p className="cp-section-label">Recent</p>
              {recentRows.map((row, i) => renderResultRow(row, recentOffset + i, "mixed"))}
            </div>
          )}

          {!deferred && (
            <div className="cp-section" role="group" aria-label="Go to">
              <p className="cp-section-label">Go to</p>
              <div className="cp-nav-grid" style={{ "--cp-nav-columns": NAV_GRID_COLUMNS } as React.CSSProperties}>
                {NAV_COMMANDS.map((cmd, i) => (
                  <button key={cmd.id} {...optionProps(cmd, navOffset + i, "cp-nav-item")}>
                    <span className="cp-nav-icon">{cmd.icon}</span>
                    <span className="cp-nav-label">{cmd.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {searchCommands.length > 0 && (
            <div className="cp-section" role="group" aria-label="Commands">
              <p className="cp-section-label">Commands</p>
              {searchCommands.map(renderCommandRow)}
            </div>
          )}

          {deferred && isError && <p className="cp-empty">Search failed. The library database could not be read.</p>}

          {isSearching && (
            <div className="cp-section" aria-hidden="true">
              {Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <div key={i} className="cp-skeleton-row">
                  <span className="cp-art cp-skeleton-block" />
                  <span className="cp-result-text">
                    <span className="cp-skeleton-bar" />
                    <span className="cp-skeleton-bar cp-skeleton-bar--short" />
                  </span>
                </div>
              ))}
            </div>
          )}

          {isEmpty && <p className="cp-empty">No results for "{deferred}"</p>}

          {topResult && (
            <div className="cp-section" role="group" aria-label="Top result">
              <p className="cp-section-label">Top result</p>
              {renderResultRow(topResult, topOffset, "top")}
            </div>
          )}

          {resultSection("Artists", searchArtists, artistOffset)}
          {resultSection("Albums", searchAlbums, albumOffset)}
          {resultSection("Tracks", searchTracks, trackOffset)}

          {seeAll?.kind === "all" && (
            <div className="cp-section">
              <button {...optionProps(seeAll, seeAllOffset, "cp-result-row")}>
                <span className="cp-row-icon">
                  <Search size={16} />
                </span>
                <span className="cp-see-all-label">See all results for "{seeAll.query}"</span>
              </button>
            </div>
          )}
        </div>

        <div className="cp-footer">
          <span>
            <kbd>↑↓</kbd> navigate
          </span>
          {focusedHint && (
            <span>
              <kbd>↵</kbd> {focusedHint.open}
            </span>
          )}
          {focusedHint?.play && (
            <span>
              <kbd>⇧↵</kbd> {focusedHint.play}
            </span>
          )}
          {focusedItem?.kind === "pin" && (
            <span>
              <kbd>del</kbd> unpin
            </span>
          )}
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
      {pinMenu && (
        <ContextMenu x={pinMenu.x} y={pinMenu.y} onClose={() => setPinMenu(null)}>
          <button
            onClick={() => {
              unpin(pinMenu.pin);
              setPinMenu(null);
            }}
          >
            Unpin
          </button>
        </ContextMenu>
      )}
    </div>
  );
}
