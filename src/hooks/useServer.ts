import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import { keychain } from "../keychain";
import type { Server } from "../types/server";
import type { NavidromeCredential } from "../lib/navidrome";
import { QK } from "../lib/query-keys";

export interface ServerWithCredential {
  server: Server;
  credential: NavidromeCredential;
}

export function useServers() {
  return useQuery({
    queryKey: QK.servers(),
    queryFn: async () => {
      const db = await getDb();
      return db.select<Server[]>("SELECT * FROM servers ORDER BY created_at ASC");
    },
  });
}

export function useServerWithCredential(serverId: string | undefined) {
  return useQuery({
    queryKey: QK.serverCredential(serverId),
    enabled: !!serverId,
    queryFn: async (): Promise<ServerWithCredential> => {
      const db = await getDb();
      const rows = await db.select<Server[]>(
        "SELECT * FROM servers WHERE id = ?",
        [serverId]
      );
      const server = rows[0];
      if (!server) throw new Error(`Server ${serverId} not found`);
      const credJson = await keychain.get(
        `canon.server.${server.id}`,
        "credential"
      );
      if (!credJson) {
        throw new Error(`No credentials found for server ${server.id}. Re-enter in Settings.`);
      }
      let credential: NavidromeCredential;
      try {
        const parsed = JSON.parse(credJson) as Record<string, unknown>;
        // Migrate legacy credentials stored without a type field
        if (!parsed.type && typeof parsed.token === "string" && typeof parsed.salt === "string") {
          credential = { type: "md5", token: parsed.token, salt: parsed.salt };
        } else {
          credential = parsed as NavidromeCredential;
        }
      } catch {
        throw new Error(`Corrupt credentials for server ${server.id}. Re-enter in Settings.`);
      }
      return { server, credential };
    },
  });
}
