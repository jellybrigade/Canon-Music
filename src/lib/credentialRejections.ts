import { normalizeUrl } from "../clients/navidromeUrls";

// 40 is Subsonic's wrong-credentials code; OpenSubsonic answers a bad API key with 44.
export const WRONG_CREDENTIALS_CODE = 40;
export const INVALID_API_KEY_CODE = 44;

export interface SubsonicEnvelope {
  status: string;
  error?: { code?: number; message?: string };
}

/** Servers whose last answer refused the saved credential. Only an answer from the same
 *  server can clear it, so a password rotated on the server stays visible until Canon has
 *  a credential it accepts, rather than every request failing behind a healthy card. */
const rejected = new Set<string>();
const listeners = new Set<() => void>();

function isRefusal(envelope: SubsonicEnvelope): boolean {
  const code = envelope.error?.code;
  return code === WRONG_CREDENTIALS_CODE || code === INVALID_API_KEY_CODE;
}

function setRejected(baseUrl: string, isNowRejected: boolean): void {
  const key = normalizeUrl(baseUrl);
  if (rejected.has(key) === isNowRejected) return;
  if (isNowRejected) rejected.add(key);
  else rejected.delete(key);
  for (const listener of listeners) listener();
}

/** Every reply reaches here, so it notifies only when the answer changes. Other failures
 *  say nothing about the credential and leave it as it was. */
export function noteEnvelope(baseUrl: string, envelope: SubsonicEnvelope): void {
  if (envelope.status === "ok") setRejected(baseUrl, false);
  else if (isRefusal(envelope)) setRejected(baseUrl, true);
}

export function clearCredentialRejection(baseUrl: string): void {
  setRejected(baseUrl, false);
}

export function isCredentialRejected(baseUrl: string): boolean {
  return rejected.has(normalizeUrl(baseUrl));
}

export function subscribeCredentialRejections(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetCredentialRejections(): void {
  rejected.clear();
}
