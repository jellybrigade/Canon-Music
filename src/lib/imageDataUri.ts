// `get_playlists` reads `custom_cover_data` on every refresh tick, so an unscaled photo
// bloats every load; downscale to the largest size the UI renders before it hits the DB.
const COVER_MAX_EDGE = 300;
const COVER_QUALITY = 0.85;

export { COVER_MAX_EDGE };

export async function fileToScaledDataUri(
  file: File,
  maxEdge: number = COVER_MAX_EDGE
): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode the selected image"));
      el.src = objectUrl;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", COVER_QUALITY);
  } finally {
    // The URL keeps the file blob alive for as long as it exists, so it is revoked on
    // the error path too, not only after a successful decode.
    URL.revokeObjectURL(objectUrl);
  }
}
