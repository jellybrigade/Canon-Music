// Canvas-based vibrant color extraction from cover art.
// Uses a separate hidden image with crossOrigin="anonymous" — independent from the
// display <img> so display always renders even if CORS extraction fails.

const CANVAS_SIZE = 32;
const accentCache = new Map<string, string | null>();
const MIN_SATURATION = 0.25;
const MIN_BRIGHTNESS = 0.15;
const MAX_BRIGHTNESS = 0.92;
const MIN_LIGHTNESS_FOR_UI = 0.4; // lift dark colors so they're readable on dark bg

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d < 0.001) return { h: 0, s: 0, l };

  const s = d / (1 - Math.abs(2 * l - 1));

  let h = 0;
  if (max === r) h = ((g - b) / d + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h / 6) * 360;

  return { h, s, l };
}

export function extractAccent(imageUrl: string): Promise<string | null> {
  if (accentCache.has(imageUrl)) return Promise.resolve(accentCache.get(imageUrl)!);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = CANVAS_SIZE;
        canvas.height = CANVAS_SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) { accentCache.set(imageUrl, null); resolve(null); return; }

        ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
        const { data } = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        let bestScore = -1;
        let bestH = 0;
        let bestS = 0;
        let bestL = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = (data[i] ?? 0) / 255;
          const g = (data[i + 1] ?? 0) / 255;
          const b = (data[i + 2] ?? 0) / 255;

          const { h, s, l } = rgbToHsl(r, g, b);

          if (s < MIN_SATURATION) continue;
          if (l < MIN_BRIGHTNESS || l > MAX_BRIGHTNESS) continue;

          // Score: favor high saturation and mid-range lightness
          const score = s * (1 - Math.abs(l - 0.5) * 1.4);
          if (score > bestScore) {
            bestScore = score;
            bestH = h;
            bestS = s;
            bestL = l;
          }
        }

        if (bestScore < 0) { accentCache.set(imageUrl, null); resolve(null); return; }

        // Lift lightness so result is readable against a dark background
        const finalL = Math.max(bestL, MIN_LIGHTNESS_FOR_UI);
        const color = `hsl(${Math.round(bestH)}, ${Math.round(bestS * 100)}%, ${Math.round(finalL * 100)}%)`;
        accentCache.set(imageUrl, color);
        resolve(color);
      } catch {
        // SecurityError from CORS-tainted canvas, or any other failure — fail silently
        accentCache.set(imageUrl, null);
        resolve(null);
      }
    };

    img.onerror = () => { accentCache.set(imageUrl, null); resolve(null); };
    img.src = imageUrl;
  });
}
