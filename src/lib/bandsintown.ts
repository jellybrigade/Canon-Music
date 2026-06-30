import { invoke } from "@tauri-apps/api/core";

interface RawBandsintownEvent {
  datetime: string;
  venue_name: string;
  venue_city: string;
  venue_region: string;
  venue_country: string;
  url: string;
  lineup: string[];
}

export interface BandsintownEvent {
  datetime: string;
  venueName: string;
  venueCity: string;
  venueRegion: string;
  venueCountry: string;
  url: string;
  lineup: string[];
}

const cache = new Map<string, BandsintownEvent[]>();
const inflight = new Map<string, Promise<BandsintownEvent[]>>();

function cacheKey(name: string): string {
  return name.trim().toLowerCase();
}

export async function fetchBandsintownEvents(artistName: string): Promise<BandsintownEvent[]> {
  const key = cacheKey(artistName);
  if (!key) return [];
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const raw = await invoke<RawBandsintownEvent[]>("fetch_bandsintown_events", { artistName });
      const events: BandsintownEvent[] = (raw ?? []).map((r) => ({
        datetime: r.datetime,
        venueName: r.venue_name,
        venueCity: r.venue_city,
        venueRegion: r.venue_region,
        venueCountry: r.venue_country,
        url: r.url,
        lineup: r.lineup ?? [],
      }));
      cache.set(key, events);
      return events;
    } catch {
      cache.set(key, []);
      return [];
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}
