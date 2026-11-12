import type { AlbumRow } from "../../types/library";

export type ReleaseGroup = "album" | "ep" | "single" | "compilation";

function classifyRelease(name: string, releaseType?: string | null | undefined): ReleaseGroup {
  if (releaseType) {
    const rt = releaseType.toLowerCase();
    if (rt === "single") return "single";
    if (rt === "ep") return "ep";
    if (rt === "compilation" || rt === "live" || rt === "remix") return "compilation";
    if (rt === "album") return "album";
  }
  // Only a trailing marker names the release type; the same word mid-title ("Single Mothers",
  // "Best of Both Worlds") is just part of an album's name.
  const n = name.toLowerCase().trim();
  if (/(?:-\s*|\(|\[)single[)\]]?$/.test(n)) return "single";
  if (/(?:\s|\(|\[)ep[)\]]?$/.test(n)) return "ep";
  if (/^the (?:very )?best of\b|greatest hits|^anthology\b|box set$|(?:-\s*|\(|\[)compilation[)\]]?$/.test(n)) {
    return "compilation";
  }
  return "album";
}

export function groupAlbums(albums: AlbumRow[]): { group: ReleaseGroup; label: string; items: AlbumRow[] }[] {
  const map: Record<ReleaseGroup, AlbumRow[]> = { album: [], ep: [], single: [], compilation: [] };
  for (const a of albums) map[classifyRelease(a.name, a.release_type)].push(a);
  return (
    [
      { group: "album" as const, label: "Albums" },
      { group: "ep" as const, label: "EPs" },
      { group: "single" as const, label: "Singles" },
      { group: "compilation" as const, label: "Compilations" },
    ] as const
  )
    .map(({ group, label }) => ({ group, label, items: map[group] }))
    .filter(({ items }) => items.length > 0);
}
