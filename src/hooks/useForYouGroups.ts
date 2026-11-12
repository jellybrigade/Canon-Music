import { useCallback, useMemo, useState } from "react";
import {
  buildForYouGroups,
  FOR_YOU_PER_TAB_DEFAULT,
  type ForYouCategoryConfig,
  type ForYouOrders,
  forYouLocksKey,
  parseForYouLocks,
  parseForYouPerTab,
  pickForYouOrders,
} from "../lib/forYouGroups";
import type { AlbumRow } from "../types/library";
import { useSetting } from "./useSetting";

interface ForYouGroupsInput {
  spotlightIds: string[];
  sources: Record<string, AlbumRow[]>;
  /** Every album, so a locked one still shows after it leaves its tab's source. */
  library?: AlbumRow[];
  config: ForYouCategoryConfig[];
  serverId: string;
  seed: number;
  /** False while any source is still loading, so a half-loaded source is never frozen as the pick. */
  isReady: boolean;
}

// Module scope so the picks survive Home remounts; only a new seed (launch or Refresh) replaces them.
let storedPicks: { serverId: string; seed: number; orders: ForYouOrders } = {
  serverId: "",
  seed: Number.NaN,
  orders: {},
};

export function useForYouGroups({
  spotlightIds,
  sources,
  library,
  config,
  serverId,
  seed,
  isReady,
}: ForYouGroupsInput) {
  const [rawPerTab, setRawPerTab] = useSetting("for_you_per_tab", String(FOR_YOU_PER_TAB_DEFAULT));
  const [rawLocks, setRawLocks, isLocksLoaded] = useSetting(forYouLocksKey(serverId), "{}");
  const perTab = parseForYouPerTab(rawPerTab);
  const locks = useMemo(() => parseForYouLocks(rawLocks), [rawLocks]);
  // Unlocking writes the tab's locked albums into the stored pick; this re-reads it.
  const [pickRevision, setPickRevision] = useState(0);
  // Writing the module cache during render is safe: the result depends only on the first inputs seen per seed.
  const orders = useMemo(() => {
    const current = storedPicks.seed === seed && storedPicks.serverId === serverId ? storedPicks.orders : {};
    const next = isReady ? pickForYouOrders(current, { sources, config, seed, excludedIds: spotlightIds }) : current;
    storedPicks = { serverId, seed, orders: next };
    return next;
  }, [serverId, seed, isReady, sources, config, spotlightIds, pickRevision]);
  const groups = useMemo(
    () => buildForYouGroups({ orders, sources, library, config, perTab, locks, excludedIds: spotlightIds }),
    [orders, sources, library, config, perTab, locks, spotlightIds],
  );

  const toggleLock = useCallback(
    (key: string) => {
      const { [key]: lockedIds, ...rest } = locks;
      if (lockedIds) {
        const shown = groups.find((g) => g.key === key)?.albums ?? [];
        const shownIds = new Set(shown.map((a) => a.id));
        const remaining = (storedPicks.orders[key] ?? []).filter((a) => !shownIds.has(a.id));
        storedPicks = { ...storedPicks, orders: { ...storedPicks.orders, [key]: [...shown, ...remaining] } };
        setPickRevision((r) => r + 1);
        void setRawLocks(JSON.stringify(rest));
        return;
      }
      const shownIds = groups.find((g) => g.key === key)?.albums.map((a) => a.id) ?? [];
      if (shownIds.length > 0) void setRawLocks(JSON.stringify({ ...locks, [key]: shownIds }));
    },
    [locks, groups, setRawLocks],
  );

  const setPerTab = useCallback(
    (count: number) => setRawPerTab(String(parseForYouPerTab(String(count)))),
    [setRawPerTab],
  );
  return { groups, perTab, setPerTab, toggleLock, isLoading: !isReady || !isLocksLoaded };
}
