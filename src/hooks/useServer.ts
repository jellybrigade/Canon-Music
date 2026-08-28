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

/**
 * Mirrors `SECRET_STORE_UNAVAILABLE` in `src-tauri/src/lib.rs`, the one machine-readable part of a
 * keyring error. It marks the failures that clear without the user doing anything - the secret
 * store not up yet, or its collection still locked - and is stripped before display.
 */
export const SECRET_STORE_UNAVAILABLE = "secret-store-unavailable: ";

/** A keyring read that failed for a reason expected to clear on its own. */
export class CredentialStoreUnavailableError extends Error {}

// Five retries on the ladder below span 31s, which outlasts a secret store that comes up a few
// seconds into the login session. React Query counts failures from zero.
const MAX_CREDENTIAL_RETRIES = 5;

export function credentialReadError(detail: string): Error {
  const message = `Could not read the stored credential: ${detail.startsWith(SECRET_STORE_UNAVAILABLE) ? detail.slice(SECRET_STORE_UNAVAILABLE.length) : detail}`;
  return detail.startsWith(SECRET_STORE_UNAVAILABLE)
    ? new CredentialStoreUnavailableError(message)
    : new Error(message);
}

export function shouldRetryCredentialRead(failureCount: number, error: Error): boolean {
  return error instanceof CredentialStoreUnavailableError && failureCount < MAX_CREDENTIAL_RETRIES;
}

export function credentialRetryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 30_000);
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
    // A missing entry and a corrupt payload are permanent until the user acts, so retrying only
    // delays the message telling them to. A secret store that is not up yet is not: Canon can
    // autostart before gnome-keyring/kwallet, and nothing else invalidates this key, so one such
    // failure would otherwise leave the whole session without a credential - no sync, and the
    // backoff ladder in useLibrarySync never arms because no run ever starts.
    retry: shouldRetryCredentialRead,
    retryDelay: credentialRetryDelay,
    // Written in exactly one place, which invalidates this key itself, so refetching on success
    // re-round-trips to the OS Secret Service over D-Bus for a value that cannot have changed.
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
        throw credentialReadError(err instanceof Error ? err.message : String(err));
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
