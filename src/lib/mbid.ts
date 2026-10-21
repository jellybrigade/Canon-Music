const MBID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isMbid(value: string | null | undefined): value is string {
  return !!value && MBID_PATTERN.test(value);
}
