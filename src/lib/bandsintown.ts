import { cappedSet } from "./boundedCache";

const APP_ID = "js_app_id";
const BASE_URL = "https://rest.bandsintown.com";

export interface BandsintownEvent {
  datetime: string;
  venueName: string;
  venueCity: string;
  venueRegion: string;
  venueCountry: string;
  url: string;
  lineup: string[];
}

const MAX_CACHE_ENTRIES = 2000;
const cache = new Map<string, BandsintownEvent[]>();
const inflight = new Map<string, Promise<BandsintownEvent[]>>();

function setCached(key: string, events: BandsintownEvent[]): void {
  cappedSet(cache, key, events, MAX_CACHE_ENTRIES);
}

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
      const encoded = encodeURIComponent(artistName.trim());
      const res = await fetch(`${BASE_URL}/artists/${encoded}/events?app_id=${APP_ID}`);
      if (!res.ok) {
        setCached(key, []);
        return [];
      }
      const raw = (await res.json()) as Array<Record<string, unknown>>;
      if (!Array.isArray(raw)) {
        setCached(key, []);
        return [];
      }
      const events: BandsintownEvent[] = raw.slice(0, 20).map((item) => {
        const venue = (item.venue ?? {}) as Record<string, unknown>;
        const lineup = Array.isArray(item.lineup)
          ? (item.lineup as unknown[]).filter((s): s is string => typeof s === "string")
          : [];
        return {
          datetime: typeof item.datetime === "string" ? item.datetime : "",
          venueName: typeof venue.name === "string" ? venue.name : "",
          venueCity: typeof venue.city === "string" ? venue.city : "",
          venueRegion: typeof venue.region === "string" ? venue.region : "",
          venueCountry: typeof venue.country === "string" ? venue.country : "",
          url: typeof item.url === "string" ? item.url : "",
          lineup,
        };
      });
      setCached(key, events);
      return events;
    } catch {
      setCached(key, []);
      return [];
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}
