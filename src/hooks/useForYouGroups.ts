import { useCallback, useMemo } from "react";
import { useSetting } from "./useSetting";
import { buildForYouGroups, FOR_YOU_PER_TAB_DEFAULT, parseForYouPerTab, type ForYouCategoryConfig } from "../lib/forYouGroups";
import type { AlbumRow } from "../types/library";

export function useForYouGroups(
  spotlightIds: string[],
  sources: Record<string, AlbumRow[]>,
  config: ForYouCategoryConfig[],
  seed: number,
) {
  const [rawPerTab, setRawPerTab] = useSetting("for_you_per_tab", String(FOR_YOU_PER_TAB_DEFAULT));
  const perTab = parseForYouPerTab(rawPerTab);
  const groups = useMemo(
    () => buildForYouGroups(spotlightIds, sources, config, seed, perTab),
    [spotlightIds, sources, config, seed, perTab]
  );
  const setPerTab = useCallback(
    (count: number) => setRawPerTab(String(parseForYouPerTab(String(count)))),
    [setRawPerTab]
  );
  return { groups, perTab, setPerTab };
}
