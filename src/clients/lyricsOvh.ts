export async function fetchLyricsOvh(
  artist: string | null,
  title: string
): Promise<string | null> {
  if (!artist) return null;
  const enc = (s: string) => encodeURIComponent(s);
  const res = await fetch(`https://api.lyrics.ovh/v1/${enc(artist)}/${enc(title)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`lyrics.ovh returned ${res.status}`);
  const data = (await res.json()) as { lyrics?: string; error?: string };
  if (data.error || !data.lyrics) return null;
  return data.lyrics.trim() || null;
}
