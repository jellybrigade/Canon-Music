import { useSyncExternalStore } from "react";
import { isCredentialRejected, subscribeCredentialRejections } from "../lib/credentialRejections";

export function useCredentialRejected(baseUrl: string | undefined): boolean {
  return useSyncExternalStore(subscribeCredentialRejections, () =>
    baseUrl === undefined ? false : isCredentialRejected(baseUrl)
  );
}
