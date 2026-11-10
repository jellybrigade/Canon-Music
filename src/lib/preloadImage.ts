import { markCoverDecoded } from "./decodedCovers";

/** Resolves once `url` is fetched and decoded, so an `<img>` switched to it paints at once. */
export async function preloadImage(url: string): Promise<void> {
  const image = new Image();
  image.src = url;
  await image.decode();
  markCoverDecoded(url);
}
