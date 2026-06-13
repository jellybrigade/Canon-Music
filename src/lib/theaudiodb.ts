import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

interface TheAudioDbArtist {
  strBiographyEN?: string;
  strArtistThumb?: string;
}

interface TheAudioDbResponse {
  artists: TheAudioDbArtist[] | null;
}

async function searchTheAudioDb(name: string): Promise<TheAudioDbArtist | null> {
  const res = await tauriFetch(
    `https://www.theaudiodb.com/api/v1/json/2/search.php?s=${encodeURIComponent(name)}`,
    { method: "GET", connectTimeout: 8000 }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as TheAudioDbResponse;
  return data?.artists?.[0] ?? null;
}

export async function fetchTheAudioDbArtist(
  name: string
): Promise<{ bio: string | null; thumbUrl: string | null }> {
  let artist = await searchTheAudioDb(name);
  // Strip leading "The " if no result
  if (!artist && name.toLowerCase().startsWith("the ")) {
    artist = await searchTheAudioDb(name.slice(4));
  }
  return {
    bio: artist?.strBiographyEN?.trim() || null,
    thumbUrl: artist?.strArtistThumb?.trim() || null,
  };
}

export async function fetchWikipediaBio(name: string): Promise<string | null> {
  try {
    const res = await tauriFetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`,
      { method: "GET", connectTimeout: 8000 }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { extract?: string };
    return data?.extract?.trim() || null;
  } catch {
    return null;
  }
}
