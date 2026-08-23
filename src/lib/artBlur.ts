// Precomputed blurred backdrop for NowPlayingView.
// CSS `filter: blur()` on a viewport-size layer forces the compositor to
// rasterize the blur on every repaint - expensive on WebKitGTK. Instead blur
// once here at a tiny canvas size (cheap: pixel count is what blur cost
// scales with) and let CSS `background-size: cover` upscale the result,
// which is a plain scale/composite - the part GPUs are actually fast at.

import * as StackBlur from "stackblur-canvas";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

// Small enough that StackBlur runs in well under a millisecond, large enough
// that the result doesn't look pixelated once CSS scales it up to fill the view.
const CANVAS_WIDTH = 160;
const CANVAS_HEIGHT = 100;
const BLUR_RADIUS = 24;

const MAX_CACHE_ENTRIES = 200;
const blurCache = new Map<string, string>();

// Ceiling on HSL lightness, not a flat brightness multiplier. A flat
// multiplier darkens shadows and highlights by the same ratio, so a
// saturated bright red just becomes a dimmer bright red. Clamping lightness
// instead only pulls down pixels above the ceiling, so a bright red becomes
// an actual dark red (same hue/saturation, lower lightness) while already-dark
// pixels are untouched.
const MAX_LIGHTNESS = 0.15;

function clampLightness(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = (data[i] ?? 0) / 255;
    const g = (data[i + 1] ?? 0) / 255;
    const b = (data[i + 2] ?? 0) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (l <= MAX_LIGHTNESS) continue;

    // Scaling all three channels by the same factor keeps their ratios (and
    // therefore hue) intact while pulling lightness down to the ceiling.
    const scale = MAX_LIGHTNESS / l;
    data[i] = r * scale * 255;
    data[i + 1] = g * scale * 255;
    data[i + 2] = b * scale * 255;
  }

  ctx.putImageData(imageData, 0, 0);
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
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

function renderBlurredDataUrl(img: HTMLImageElement): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.filter = "saturate(1.8)";
  ctx.drawImage(img, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.filter = "none";

  clampLightness(canvas, ctx);
  StackBlur.canvasRGB(canvas, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, BLUR_RADIUS);
  return canvas.toDataURL("image/jpeg", 0.7);
}

async function renderViaProxyFetch(imageUrl: string): Promise<string | null> {
  let objectUrl: string | null = null;
  try {
    const res = await tauriFetch(imageUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    objectUrl = URL.createObjectURL(blob);

    const img = await loadImage(objectUrl);
    if (!img) return null;

    return renderBlurredDataUrl(img);
  } catch {
    return null;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export async function getBlurredBackdrop(imageUrl: string): Promise<string | null> {
  if (blurCache.has(imageUrl)) return blurCache.get(imageUrl)!;

  let result: string | null = null;
  const img = await loadImageAnonymous(imageUrl);
  if (img) {
    try {
      result = renderBlurredDataUrl(img);
    } catch {
      // Canvas tainted by a CORS-less host, fall back to fetching bytes
      // through Tauri's Rust-backed fetch and reading from a blob: URL.
      result = await renderViaProxyFetch(imageUrl);
    }
  } else {
    result = await renderViaProxyFetch(imageUrl);
  }

  if (result) {
    if (blurCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = blurCache.keys().next().value;
      if (oldestKey !== undefined) blurCache.delete(oldestKey);
    }
    blurCache.set(imageUrl, result);
  }
  return result;
}
