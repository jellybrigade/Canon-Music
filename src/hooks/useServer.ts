import { useQuery } from "@tanstack/react-query";
import { getDb } from "../db";
import { SchemaTooNewError } from "../db/migrations";
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
    // A library written by a newer build stays too new however often it is read, and `getDb()`
    // caches the one rejected promise, so the default three retries only delay the message.
    retry: (failureCount, error) =>
      !(error instanceof SchemaTooNewError) && failureCount < 3,
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
    // A missing keychain entry, a locked keyring and a corrupt payload are all
    // permanent until the user acts, so retrying only delays the message telling
    // them to. And the credential is written in exactly one place, which
    // invalidates this key itself, so refetching it re-round-trips to the OS
    // Secret Service over D-Bus for a value that cannot have changed.
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async (): Promise<ServerWithCredential> => {
      const db = await getDb();
      const rows = await db.select<Server[]>(
        "SELECT * FROM servers WHERE id = ?",
        [serverId]
      );
      const server = rows[0];
      if (!server) throw new Error(`Server ${serverId} not found`);
      // `get_credential` rejects when the entry is absent rather than resolving
      // to an empty string, so a falsy-check here would never fire and the raw
      // keyring string ("No matching entry found in secure storage") would be
      // what the user sees.
      let credJson: string;
      try {
        credJson = await keychain.get(`canon.server.${server.id}`, "credential");
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`Could not read the stored credential: ${detail}`);
      }
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
