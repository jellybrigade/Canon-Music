import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ServerWithCredential } from "../../../hooks/useServer";
import { errorMessage } from "../../../lib/errorMessage";
import { plural } from "../../../lib/plural";
import { QK } from "../../../lib/queryKeys";
import {
  getMissingWaveformCount,
  startWaveformBackfill,
  stopWaveformBackfill,
  useWaveformBackfillStore,
} from "../../playback/store/waveformBackfill";
import { SettingRow } from "./SettingRow";

function countText(isPending: boolean, isError: boolean, missingCount: number | undefined): string | null {
  if (isError) return "Couldn't count the tracks without a waveform";
  if (isPending || missingCount === undefined) return null;
  return missingCount > 0
    ? `${missingCount} ${plural(missingCount, "track")} without a waveform`
    : "Every track has a waveform";
}

export function WaveformBackfillRow({
  serverWithCredential,
}: {
  serverWithCredential: ServerWithCredential | undefined;
}) {
  const queryClient = useQueryClient();
  const progress = useWaveformBackfillStore((s) => s.progress);
  const serverId = serverWithCredential?.server.id;
  const {
    data: missingCount,
    isPending,
    isError,
  } = useQuery({
    queryKey: QK.waveformsMissingCount(serverId),
    queryFn: () => (serverId ? getMissingWaveformCount(serverId) : Promise.resolve(0)),
    enabled: serverId !== undefined,
  });

  const [startError, setStartError] = useState<string | null>(null);

  const start = (swc: ServerWithCredential) => {
    setStartError(null);
    void startWaveformBackfill(swc).then(
      () => queryClient.invalidateQueries({ queryKey: QK.waveformsMissingCount(swc.server.id) }),
      (err: unknown) => setStartError(`Couldn't start extracting: ${errorMessage(err)}`),
    );
  };

  const hint = progress
    ? `Extracting… ${progress.done} / ${progress.total}`
    : (startError ?? countText(isPending, isError, missingCount));

  return (
    <SettingRow
      title="Extract all waveforms"
      description="Extracts the waveform of every track that doesn't have one yet, in the background. Stops when something starts playing."
    >
      <div className="settings-field settings-field--row">
        {hint && <span className="settings-hint">{hint}</span>}
        {progress ? (
          <button className="settings-btn" onClick={stopWaveformBackfill}>
            Stop
          </button>
        ) : (
          <button
            className="settings-btn"
            disabled={!serverWithCredential || !missingCount}
            onClick={() => {
              if (serverWithCredential) start(serverWithCredential);
            }}
          >
            Extract all
          </button>
        )}
      </div>
    </SettingRow>
  );
}
