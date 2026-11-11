import { Search, X } from "lucide-react";
import { useRef } from "react";

interface HomeSearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  onOpenCommandPalette: () => void;
}

// Home's own search surface, separate from /search: it owns its Escape here, and Ctrl+F still
// means the app's search route. App holds the query so it survives opening an album and back.
export function HomeSearchBox({ value, onChange, onOpenCommandPalette }: HomeSearchBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Escape") return;
    if (value) onChange("");
    else inputRef.current?.blur();
  };

  return (
    <div className="home-search-bar">
      <Search size={13} className="search-bar-icon" />
      <input
        ref={inputRef}
        type="text"
        className="search-bar-input"
        placeholder="Search…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {value ? (
        <button
          className="search-bar-clear"
          onClick={(e) => {
            inputRef.current?.blur();
            e.currentTarget.blur();
            onChange("");
          }}
          title="Clear"
        >
          <X size={13} />
        </button>
      ) : (
        <button
          className="home-search-palette-hint"
          onClick={onOpenCommandPalette}
          title="Command palette: search tracks, artists, albums, and navigate anywhere"
        >
          <kbd>⌘K</kbd>
        </button>
      )}
    </div>
  );
}
