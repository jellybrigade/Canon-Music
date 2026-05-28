export interface SidecarHealth {
  status: string;
  version: string;
}

export interface TagDiff {
  field: string;
  old_value: string | null;
  new_value: string | null;
}

export interface WriteDryRunResult {
  resolved_path: string;
  diff: TagDiff[];
}

export interface WriteTagsParams {
  filePath: string;
  tags: Record<string, string | null>;
  dryRun?: boolean;
}

function applyPathRemap(filePath: string, from: string | null, to: string | null): string {
  if (!from || !to) return filePath;
  if (filePath.startsWith(from)) {
    return to + filePath.slice(from.length);
  }
  return filePath;
}

const SIDECAR_PROBE_PORTS = [8765, 4533, 3000];

export async function probeSidecar(host: string): Promise<{ url: string; health: SidecarHealth }> {
  for (const port of SIDECAR_PROBE_PORTS) {
    const url = `http://${host}:${port}`;
    try {
      const health = await checkSidecarHealth(url, "");
      return { url, health };
    } catch {
      // try next port
    }
  }
  throw new Error(`No sidecar found on ${host} (tried ports ${SIDECAR_PROBE_PORTS.join(", ")})`);
}

export async function checkSidecarHealth(url: string, secret: string): Promise<SidecarHealth> {
  const res = await fetch(`${url}/health`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sidecar health check failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<SidecarHealth>;
}

export async function writeTags(
  url: string,
  secret: string,
  params: WriteTagsParams,
  pathPrefixFrom: string | null = null,
  pathPrefixTo: string | null = null
): Promise<WriteDryRunResult | void> {
  const remappedPath = applyPathRemap(params.filePath, pathPrefixFrom, pathPrefixTo);
  const endpoint = params.dryRun ? `${url}/write?dry_run=true` : `${url}/write`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ file_path: remappedPath, tags: params.tags }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sidecar write failed (${res.status}): ${text}`);
  }
  if (params.dryRun) {
    return res.json() as Promise<WriteDryRunResult>;
  }
}
