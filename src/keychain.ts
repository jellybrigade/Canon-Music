import { invoke } from "@tauri-apps/api/core";

export const keychain = {
  set: (service: string, account: string, secret: string): Promise<void> =>
    invoke("set_credential", { service, account, secret }),

  get: (service: string, account: string): Promise<string> =>
    invoke("get_credential", { service, account }),

  delete: (service: string, account: string): Promise<void> =>
    invoke("delete_credential", { service, account }),
};
