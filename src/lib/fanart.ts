import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { keychain } from "../keychain";

interface FanartArtistResponse {
  artistthumb?: { url: string }[];
  artistbackground?: { url: string }[];
}

export async function getFanartApiKey(): Promise<string | null> {
  try {
    return await keychain.get("canon.fanart", "api_key") ?? null;
  } catch {
    return null;
  }
}

export async function setFanartApiKey(key: string): Promise<void> {
  if (key.trim()) {
    await keychain.set("canon.fanart", "api_key", key.trim());
  } else {
    try { await keychain.delete("canon.fanart", "api_key"); } catch { /* ok */ }
  }
}

export async function fetchFanartTvImageByMbid(mbid: string, apiKey: string): Promise<string | null> {
  try {
    const res = await tauriFetch(`https://webservice.fanart.tv/v3/music/${mbid}?api_key=${encodeURIComponent(apiKey)}`, {
      method: "GET",
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as FanartArtistResponse;
    return data.artistthumb?.[0]?.url ?? data.artistbackground?.[0]?.url ?? null;
  } catch {
    return null;
  }
}
