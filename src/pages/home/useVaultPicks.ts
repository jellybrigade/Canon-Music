import { useCallback, useMemo, useState } from "react";
import { sampleFromHead } from "../../lib/shuffle";

const VAULT_COUNT = 20;
/** Oldest-played albums the vault draws from, so every pick stays long-forgotten. */
const VAULT_POOL_SIZE = 100;
const SEED_RANGE = 1_000_000;

function randomSeed(): number {
  return Math.floor(Math.random() * SEED_RANGE);
}

/** Fresh picks per Home mount and per refresh; `oldestFirst` is sorted by last played, ascending. */
export function useVaultPicks<T>(oldestFirst: T[]): { items: T[]; refresh: () => void } {
  const [seed, setSeed] = useState(randomSeed);
  const refresh = useCallback(() => setSeed((s) => s + 1), []);
  const items = useMemo(() => sampleFromHead(oldestFirst, seed, VAULT_COUNT, VAULT_POOL_SIZE), [oldestFirst, seed]);
  return { items, refresh };
}
