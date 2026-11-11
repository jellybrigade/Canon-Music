const CREDIT_SEPARATOR = /\s+(?:feat\.?|ft\.?|featuring|with|x)\s+|\s*[&,+]\s*/i;

/**
 * Every artist a credit names, lowercased, plus the whole credit, so "Drake feat. Sampha" and
 * "Drake" share a key while a duo like "Simon & Garfunkel" still matches itself.
 */
export function creditedArtistKeys(credit: string | null | undefined): string[] {
  const whole = credit?.trim().toLowerCase();
  if (!whole) return [];
  const parts = whole
    .split(CREDIT_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return [...new Set([whole, ...parts])];
}
