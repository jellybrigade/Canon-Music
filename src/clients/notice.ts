import { boundedFetch } from "./boundedFetch";

export interface RemoteNotice {
  id: string;
  message: string;
  link?: NoticeLink;
}

export interface NoticeLink {
  href: string;
  host: string;
}

function parseNoticeLink(url: unknown): NoticeLink | undefined {
  if (typeof url !== "string" || !URL.canParse(url)) return undefined;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") return undefined;
  return { href: parsed.href, host: parsed.hostname.replace(/^www\./, "") };
}

const NOTICE_URL = "https://raw.githubusercontent.com/jellybrigade/Canon-Music/main/notice.json";

export async function fetchRemoteNotice(): Promise<RemoteNotice | null> {
  try {
    const resp = await boundedFetch(NOTICE_URL, { cache: "no-store" });
    if (!resp.ok) return null;
    const data: unknown = await resp.json();
    if (typeof data !== "object" || data === null) return null;
    const { id, message, url } = data as Record<string, unknown>;
    if (typeof id !== "string" || typeof message !== "string" || !id || !message) return null;
    const link = parseNoticeLink(url);
    return link ? { id, message, link } : { id, message };
  } catch {
    return null;
  }
}
