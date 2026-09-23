export interface RemoteNotice {
  id: string;
  message: string;
  url?: string;
}

const NOTICE_URL =
  "https://raw.githubusercontent.com/jellybrigade/Canon-Music/main/notice.json";

export async function fetchRemoteNotice(): Promise<RemoteNotice | null> {
  try {
    const resp = await fetch(NOTICE_URL, { cache: "no-store" });
    if (!resp.ok) return null;
    const data = (await resp.json()) as Partial<RemoteNotice>;
    if (!data.id || !data.message) return null;
    return { id: data.id, message: data.message, url: data.url };
  } catch {
    return null;
  }
}
