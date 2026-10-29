// Request errors (reqwest's especially) quote the whole URL, and logs ride along with feedback
// reports: Subsonic's `t`/`s`/`p`/`apiKey`, Last.fm's and fanart.tv's `api_key`.
const CREDENTIAL_PARAM = /([?&](?:t|s|p|apiKey|api_key)=)[^&\s)"']+/g;

export function redactCredentials(text: string): string {
  return text.replace(CREDENTIAL_PARAM, "$1[redacted]");
}
