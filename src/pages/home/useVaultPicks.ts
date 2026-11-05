import { useCallback, useMemo, useState } from "react";
import type { AlbumStatRow } from "../../hooks/useListeningStats";
import { sampleFromHead } from "../../lib/shuffle";

const VAULT_COUNT = 20;
/** Oldest-played albums the vault draws from, so every pick stays long-forgotten. */
const VAULT_POOL_SIZE = 100;
const SEED_RANGE = 1_000_000;

// Module scope so the picks survive Home remounts; only a new seed (launch or Refresh) replaces them.
let vaultSeed = Math.floor(Math.random() * SEED_RANGE);
let storedPicks: { seed: number; picks: AlbumStatRow[] } = { seed: Number.NaN, picks: [] };

/** Picks once per launch and per refresh; `oldestFirst` is sorted by last played, ascending. */
export function useVaultPicks(oldestFirst: AlbumStatRow[]): { items: AlbumStatRow[]; refresh: () => void } {
  const [seed, setSeed] = useState(vaultSeed);
  const refresh = useCallback(() => {
    vaultSeed += 1;
    setSeed(vaultSeed);
  }, []);
  // Writing the module cache during render is safe: the result depends only on the first history seen per seed.
  const items = useMemo(() => {
    // Empty while play history loads: keep the stored picks for when it arrives.
    if (oldestFirst.length === 0) return [];
    const latest = new Map(oldestFirst.map((album) => [album.id, album]));
    const kept = storedPicks.seed === seed ? storedPicks.picks.flatMap((album) => latest.get(album.id) ?? []) : [];
    if (kept.length > 0) return kept;
    const picks = sampleFromHead(oldestFirst, seed, VAULT_COUNT, VAULT_POOL_SIZE);
    storedPicks = { seed, picks };
    return picks;
  }, [oldestFirst, seed]);
  return { items, refresh };
}
