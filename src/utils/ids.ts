export function stripServerPrefix(id: string, serverId: string): string {
  const prefix = `${serverId}:`;
  if (!id.startsWith(prefix)) {
    throw new Error(`id "${id}" missing expected server prefix "${prefix}"`);
  }
  return id.slice(prefix.length);
}
