// Canvas-based vibrant color extraction from cover art.
// Tries a direct <img crossOrigin="anonymous"> load first, works for the local
// cover-art server and any host that sends Access-Control-Allow-Origin. Only
// falls back to fetching bytes via Tauri's Rust-backed fetch and drawing from a
// same-origin blob: URL when that taints the canvas, external hosts
// (Wikidata/Fanart/TheAudioDB portrait CDNs) rarely send CORS headers.

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

const CANVAS_SIZE = 32;
// Small values (a color string or null) but keyed per distinct album/artist artwork
// URL browsed, so cap it to bound RSS growth over a long session, same as the
// Rust-side cover/prefetch caches.
const MAX_ACCENT_CACHE_ENTRIES = 500;
const accentCache = new Map<string, string | null>();
const MIN_SATURATION = 0.25;
const MIN_BRIGHTNESS = 0.15;
const MAX_BRIGHTNESS = 0.92;
const OKLAB_MIN_L = 0.55;

// OKLab color math, perceptually uniform, so the L floor is consistent across
// all hues (blues/greens don't need as much lifting as HSL-based floor did).
// Ported from ratune/src/color.rs.

function srgbToLinear(x: number): number {
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function linearToSrgb(x: number): number {
  const c = Math.max(0, x);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbToLinear(r / 255);
  const gl = srgbToLinear(g / 255);
  const bl = srgbToLinear(b / 255);
  const l = Math.cbrt(0.41222148 * rl + 0.53633254 * gl + 0.05144599 * bl);
  const m = Math.cbrt(0.21190350 * rl + 0.68069955 * gl + 0.10739696 * bl);
  const s = Math.cbrt(0.08830246 * rl + 0.28171884 * gl + 0.62997870 * bl);
  return [
    0.21045426 * l + 0.79361778 * m - 0.00407205 * s,
    1.97799850 * l - 2.42859220 * m + 0.45059370 * s,
    0.02590403 * l + 0.78277177 * m - 0.80867577 * s,
  ];
}

function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l = L + 0.39633778 * a + 0.21580376 * b;
  const m = L - 0.10556135 * a - 0.06385417 * b;
  const s = L - 0.08948418 * a - 1.29148555 * b;
  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;
  return [
    Math.round(Math.min(255, Math.max(0, linearToSrgb(+4.07674166 * l3 - 3.30771159 * m3 + 0.23096993 * s3) * 255))),
    Math.round(Math.min(255, Math.max(0, linearToSrgb(-1.26843800 * l3 + 2.60975740 * m3 - 0.34131940 * s3) * 255))),
    Math.round(Math.min(255, Math.max(0, linearToSrgb(-0.00419609 * l3 - 0.70341861 * m3 + 1.70761470 * s3) * 255))),
  ];
}

function ensureReadable(r: number, g: number, b: number): [number, number, number] {
  const [L, a, ob] = rgbToOklab(r, g, b);
  if (L >= OKLAB_MIN_L) return [r, g, b];
  return oklabToRgb(OKLAB_MIN_L, a, ob);
}

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

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function scoreFromImage(img: HTMLImageElement): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
  const { data } = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  let bestScore = -1;
  let bestR = 0;
  let bestG = 0;
  let bestB = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = (data[i] ?? 0) / 255;
    const g = (data[i + 1] ?? 0) / 255;
    const b = (data[i + 2] ?? 0) / 255;

    const { s, l } = rgbToHsl(r, g, b);

    if (s < MIN_SATURATION) continue;
    if (l < MIN_BRIGHTNESS || l > MAX_BRIGHTNESS) continue;

    const score = s * (1 - Math.abs(l - 0.5) * 1.4);
    if (score > bestScore) {
      bestScore = score;
      bestR = data[i] ?? 0;
      bestG = data[i + 1] ?? 0;
      bestB = data[i + 2] ?? 0;
    }
  }

  if (bestScore < 0) return null;
  const [fr, fg, fb] = ensureReadable(bestR, bestG, bestB);
  return `rgb(${fr}, ${fg}, ${fb})`;
}

function loadImageAnonymous(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function extractViaProxyFetch(imageUrl: string): Promise<string | null> {
  let objectUrl: string | null = null;
  try {
    const res = await tauriFetch(imageUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    objectUrl = URL.createObjectURL(blob);

    const img = await loadImage(objectUrl);
    if (!img) return null;

    return scoreFromImage(img);
  } catch {
    return null;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export async function extractAccent(imageUrl: string): Promise<string | null> {
  if (accentCache.has(imageUrl)) return accentCache.get(imageUrl)!;

  let color: string | null = null;
  const img = await loadImageAnonymous(imageUrl);
  if (img) {
    try {
      color = scoreFromImage(img);
    } catch {
      // Canvas tainted by a CORS-less host (e.g. Wikidata/Fanart/TheAudioDB
      // portraits), fall back to fetching bytes through Tauri's Rust-backed
      // fetch and reading from a same-origin blob: URL.
      color = await extractViaProxyFetch(imageUrl);
    }
  } else {
    color = await extractViaProxyFetch(imageUrl);
  }

  if (accentCache.size >= MAX_ACCENT_CACHE_ENTRIES) {
    const oldestKey = accentCache.keys().next().value;
    if (oldestKey !== undefined) accentCache.delete(oldestKey);
  }
  accentCache.set(imageUrl, color);
  return color;
}

