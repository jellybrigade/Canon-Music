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
