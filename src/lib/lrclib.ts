const LRCLIB_BASE = "https://lrclib.net/api/get";

export interface LrclibResult {
  plain: string | null;
  synced: string | null;
}

export async function fetchLyrics(params: {
  artist: string;
  album: string;
  title: string;
  durationSec: number | null;
}): Promise<LrclibResult | null> {
  const url = new URL(LRCLIB_BASE);
  url.searchParams.set("artist_name", params.artist);
  url.searchParams.set("album_name", params.album);
  url.searchParams.set("track_name", params.title);
  if (params.durationSec != null) {
    url.searchParams.set("duration", String(Math.round(params.durationSec)));
  }

  const res = await fetch(url.toString());
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRClib returned ${res.status}`);

  const data = (await res.json()) as {
    plainLyrics?: string | null;
    syncedLyrics?: string | null;
  };

  return {
    plain: data.plainLyrics ?? null,
    synced: data.syncedLyrics ?? null,
  };
}

// Parse LRC format: "[mm:ss.xx] line text" → array of { timeSec, text }
export interface LrcLine {
  timeSec: number;
  text: string;
}

export function parseLrc(lrc: string): LrcLine[] {
  const lines: LrcLine[] = [];
  for (const raw of lrc.split("\n")) {
    const match = /^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/.exec(raw.trim());
    if (!match) continue;
    const [, mm, ss, cs, text] = match;
    const timeSec =
      parseInt(mm!, 10) * 60 +
      parseInt(ss!, 10) +
      parseInt(cs!.padEnd(3, "0"), 10) / 1000;
    lines.push({ timeSec, text: text!.trim() });
  }
  return lines.sort((a, b) => a.timeSec - b.timeSec);
}
