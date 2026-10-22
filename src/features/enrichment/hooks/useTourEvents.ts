import { useQuery } from "@tanstack/react-query";
import { type BandsintownEvent, fetchBandsintownEvents } from "../../../clients/bandsintown";
import { QK } from "../../../lib/queryKeys";

const NO_EVENTS: BandsintownEvent[] = [];

// Keyed per artist so a new artist never shows the last one's dates, while loading or after a failure.
export function useTourEvents(artistName: string | null, enabled: boolean) {
  const isEnabled = enabled && !!artistName;
  const { data, isPending } = useQuery({
    queryKey: QK.tourEvents(artistName ?? ""),
    queryFn: () => fetchBandsintownEvents(artistName ?? ""),
    enabled: isEnabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return { events: data ?? NO_EVENTS, isLoading: isEnabled && isPending };
}
