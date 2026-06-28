const YEAR_MIN = 1900;
const YEAR_MAX = new Date().getFullYear() + 1;
const LIMIT_MAX = 500;

export { YEAR_MIN, YEAR_MAX, LIMIT_MAX };

export type GenreMode = "include" | "exclude";

export interface SmartFilters {
  name: string;
  limit: number;
  sort: string;
  artistContains: string;
  albumContains: string;
  titleContains: string;
  selectedGenres: string[];
  genreMode: GenreMode;
  yearFrom: number | null;
  yearTo: number | null;
  minPlayCount: number;
}

export const DEFAULT_SMART_FILTERS: SmartFilters = {
  name: "",
  limit: 50,
  sort: "+random",
  artistContains: "",
  albumContains: "",
  titleContains: "",
  selectedGenres: [],
  genreMode: "include",
  yearFrom: null,
  yearTo: null,
  minPlayCount: 0,
};

export const SORT_OPTIONS = [
  { value: "+random", label: "Random" },
  { value: "-playcount", label: "Most played" },
  { value: "-year", label: "Newest first" },
  { value: "+year", label: "Oldest first" },
  { value: "+title", label: "Title A→Z" },
  { value: "-title", label: "Title Z→A" },
] as const;

function sortToSql(sort: string): string {
  switch (sort) {
    case "+title": return "t.title ASC";
    case "-title": return "t.title DESC";
    case "-year": return "t.year DESC";
    case "+year": return "t.year ASC";
    case "-playcount": return "t.play_count DESC";
    default: return "RANDOM()";
  }
}

export function buildSmartQuery(
  filters: SmartFilters,
  serverId: string
): { sql: string; params: (string | number)[] } {
  const conditions: string[] = ["t.server_id = ?"];
  const params: (string | number)[] = [serverId];

  if (filters.titleContains.trim()) {
    conditions.push("t.title LIKE ? ESCAPE '\\'");
    params.push(`%${filters.titleContains.trim().replace(/[%_\\]/g, "\\$&")}%`);
  }
  if (filters.artistContains.trim()) {
    conditions.push("t.artist LIKE ? ESCAPE '\\'");
    params.push(`%${filters.artistContains.trim().replace(/[%_\\]/g, "\\$&")}%`);
  }
  if (filters.albumContains.trim()) {
    conditions.push("a.name LIKE ? ESCAPE '\\'");
    params.push(`%${filters.albumContains.trim().replace(/[%_\\]/g, "\\$&")}%`);
  }

  if (filters.yearFrom !== null) {
    conditions.push("t.year >= ?");
    params.push(filters.yearFrom);
  }
  if (filters.yearTo !== null) {
    conditions.push("t.year <= ?");
    params.push(filters.yearTo);
  }

  if (filters.minPlayCount > 0) {
    conditions.push("t.play_count >= ?");
    params.push(filters.minPlayCount);
  }

  if (filters.selectedGenres.length > 0) {
    const placeholders = filters.selectedGenres.map(() => "?").join(", ");
    if (filters.genreMode === "include") {
      conditions.push(
        `t.album_id IN (SELECT album_id FROM album_genres WHERE relation = 'direct' AND canonical_id IN (${placeholders}))`
      );
    } else {
      conditions.push(
        `t.album_id NOT IN (SELECT album_id FROM album_genres WHERE relation = 'direct' AND canonical_id IN (${placeholders}))`
      );
    }
    params.push(...filters.selectedGenres);
  }

  const where = conditions.join(" AND ");
  const order = sortToSql(filters.sort);
  const limit = Math.max(1, Math.min(LIMIT_MAX, filters.limit));

  const needsAlbumJoin = filters.albumContains.trim() !== "";
  const joinClause = needsAlbumJoin
    ? "LEFT JOIN albums a ON t.album_id = a.id"
    : "";

  const sql = `SELECT DISTINCT t.id FROM tracks t ${joinClause} WHERE ${where} ORDER BY ${order} LIMIT ${limit}`;
  return { sql, params };
}
