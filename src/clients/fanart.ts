import { errorMessage } from "../lib/errorMessage";
import { keychain, SECRET_STORE_UNAVAILABLE } from "../lib/keychain";
import { boundedNativeFetch } from "./boundedFetch";

interface FanartArtistResponse {
  artistthumb?: { url: string }[];
  artistbackground?: { url: string }[];
}

/** Resolves null when no key is stored; rejects when the secret store is locked or not up yet. */
export async function getFanartApiKey(): Promise<string | null> {
  try {
    return (await keychain.get("canon.fanart", "api_key")) ?? null;
  } catch (err) {
    const detail = errorMessage(err);
    if (detail.startsWith(SECRET_STORE_UNAVAILABLE)) throw new Error(detail.slice(SECRET_STORE_UNAVAILABLE.length));
    return null;
  }
}

export async function setFanartApiKey(key: string): Promise<void> {
  if (key.trim()) {
    await keychain.set("canon.fanart", "api_key", key.trim());
  } else {
    try {
      await keychain.delete("canon.fanart", "api_key");
    } catch {
      /* ok */
    }
  }
}

/** Resolves null when fanart.tv answered without an image or refused the key (permanent, like no key);
 * rejects when it didn't answer. */
export async function fetchFanartTvImageByMbid(mbid: string, apiKey: string): Promise<string | null> {
  const res = await boundedNativeFetch(
    `https://webservice.fanart.tv/v3/music/${mbid}?api_key=${encodeURIComponent(apiKey)}`,
    {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "Canon Music Player" },
    },
  );
  if (res.status === 404 || res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`fanart.tv returned ${res.status}`);
  const data = (await res.json()) as FanartArtistResponse;
  return data.artistthumb?.[0]?.url ?? data.artistbackground?.[0]?.url ?? null;
}

export interface FanartAlbumCover {
  id: string;
  fullUrl: string;
  thumbUrl: string;
  likes: number;
}

interface FanartAlbumResponse {
  albums?: Record<string, { albumcover?: { id?: string; url?: string; likes?: string }[] }>;
}

/** Album covers fanart.tv holds for a release group, most liked first; empty when it has none or
 * refused the key, rejects when it didn't answer. */
export async function fetchFanartAlbumCovers(releaseGroupMbid: string, apiKey: string): Promise<FanartAlbumCover[]> {
  const res = await boundedNativeFetch(
    `https://webservice.fanart.tv/v3/music/albums/${releaseGroupMbid}?api_key=${encodeURIComponent(apiKey)}`,
    {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "Canon Music Player" },
    },
  );
  if (res.status === 404 || res.status === 401 || res.status === 403) return [];
  if (!res.ok) throw new Error(`fanart.tv returned ${res.status}`);
  const data = (await res.json()) as FanartAlbumResponse;
  return (data.albums?.[releaseGroupMbid]?.albumcover ?? [])
    .flatMap(({ id, url, likes }) => {
      if (typeof url !== "string" || !url.startsWith("https://")) return [];
      const likeCount = Number.parseInt(likes ?? "", 10);
      return [
        {
          id: id ?? url,
          fullUrl: url,
          // fanart.tv serves a small copy of every asset under /preview/.
          thumbUrl: url.replace("/fanart/", "/preview/"),
          likes: Number.isFinite(likeCount) ? likeCount : 0,
        },
      ];
    })
    .sort((a, b) => b.likes - a.likes);
}
