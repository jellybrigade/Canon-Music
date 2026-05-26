import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import { keychain } from "../keychain";
import type { Server } from "../types/server";
import type { NavidromeCredential } from "../lib/navidrome";

export interface ServerWithCredential {
  server: Server;
  credential: NavidromeCredential;
}

export function useServers() {
  return useQuery({
    queryKey: ["servers"],
    queryFn: async () => {
      const db = await getDb();
      return db.select<Server[]>("SELECT * FROM servers ORDER BY created_at ASC");
    },
  });
}

export function useServerWithCredential(serverId: string | undefined) {
  return useQuery({
    queryKey: ["server-credential", serverId],
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
      const credential = JSON.parse(credJson) as NavidromeCredential;
      return { server, credential };
    },
  });
}
