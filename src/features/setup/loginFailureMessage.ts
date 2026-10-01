import { SubsonicError } from "../../clients/navidromeTransport";
import { INVALID_API_KEY_CODE, WRONG_CREDENTIALS_CODE } from "../../lib/credentialRejections";

export function loginFailureMessage(error: unknown, authMethod: "password" | "apikey"): string {
  if (error instanceof SubsonicError) {
    if (authMethod === "apikey" && (error.code === WRONG_CREDENTIALS_CODE || error.code === INVALID_API_KEY_CODE)) {
      return "The server did not accept this username and API key.";
    }
    if (error.code === WRONG_CREDENTIALS_CODE) {
      return "Wrong username or password. Check both and try again.";
    }
  }
  return error instanceof Error ? error.message : String(error);
}
