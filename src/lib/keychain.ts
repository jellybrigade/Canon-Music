import { invoke } from "@tauri-apps/api/core";

/**
 * Mirrors `SECRET_STORE_UNAVAILABLE` in `src-tauri/src/keychain.rs`; marks failures that
 * clear on their own (secret store not up yet, collection still locked) and is stripped before display.
 */
export const SECRET_STORE_UNAVAILABLE = "secret-store-unavailable: ";

export const keychain = {
  set: (service: string, account: string, secret: string): Promise<void> =>
    invoke("set_credential", { service, account, secret }),

  get: (service: string, account: string): Promise<string> => invoke("get_credential", { service, account }),

  delete: (service: string, account: string): Promise<void> => invoke("delete_credential", { service, account }),
};
