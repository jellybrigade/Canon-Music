export function stripServerPrefix(id: string, serverId: string): string {
  const prefix = `${serverId}:`;
  if (!id.startsWith(prefix)) {
    throw new Error(`id "${id}" missing expected server prefix "${prefix}"`);
  }
  return id.slice(prefix.length);
}

// Whether a prefixed id belongs to a server the library still holds. Playback state lives
// in global `settings` rows while the ids inside it are server-scoped, so a removed server
// leaves ids nothing can resolve and every stripServerPrefix call site throws on them.
export function isOwnedByServer(id: string, serverIds: readonly string[]): boolean {
  return serverIds.some((serverId) => id.startsWith(`${serverId}:`));
}
