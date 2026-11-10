/** Covers the webview has already loaded and decoded, so a new image of one needn't hide while it "loads". */
export const DECODED_COVERS_MAX = 2000;

const decodedCovers = new Set<string>();

export function markCoverDecoded(url: string): void {
  // Delete-then-add keeps the most recently shown covers at the end, so eviction drops the stalest.
  decodedCovers.delete(url);
  decodedCovers.add(url);
  if (decodedCovers.size > DECODED_COVERS_MAX) {
    const stalest = decodedCovers.values().next().value;
    if (stalest !== undefined) decodedCovers.delete(stalest);
  }
}

export function isCoverDecoded(url: string): boolean {
  return decodedCovers.has(url);
}

export function forgetDecodedCovers(): void {
  decodedCovers.clear();
}
