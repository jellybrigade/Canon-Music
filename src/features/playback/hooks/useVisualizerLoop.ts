import { invoke } from "@tauri-apps/api/core";
import { type RefObject, useEffect, useRef } from "react";
import { type Bars, emptyBars, isSettled, stepBars } from "../lib/visualizerMotion";

export interface VisualizerFrame {
  width: number;
  height: number;
  color: string;
}

interface Options {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  width: number;
  height: number;
  pixelRatio: number;
  barCount: number;
  isOnScreen: boolean;
  isPlaying: boolean;
  // Re-read when the album art's colour changes; the canvas takes its colour from CSS.
  colorKey: string | null;
  draw: (context: CanvasRenderingContext2D, bars: Bars, frame: VisualizerFrame) => void;
}

/**
 * Animates the bars while on screen. While playing it asks the engine for one set of levels per frame,
 * never more than one in flight; while paused the bars fall and the loop stops once they settle.
 */
export function useVisualizerLoop({
  canvasRef,
  width,
  height,
  pixelRatio,
  barCount,
  isOnScreen,
  isPlaying,
  colorKey,
  draw,
}: Options) {
  // Survives pause and resize, so bars carry on from where they were instead of jumping to zero.
  const barsRef = useRef<Bars>(emptyBars(barCount));
  // Outlives the effect: a resize mid-request must not start a second one.
  const isFetchingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isOnScreen || !canvas || width === 0 || height === 0) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const frame: VisualizerFrame = { width, height, color: getComputedStyle(canvas).color };

    const silence: number[] = [];
    let targets = silence;
    let isStopped = false;
    let lastTime: number | null = null;
    let animationFrame = 0;

    const tick = (time: number) => {
      const elapsed = lastTime === null ? 0 : time - lastTime;
      lastTime = time;
      if (isPlaying && !isFetchingRef.current) {
        isFetchingRef.current = true;
        invoke<number[]>("audio_visualizer_levels", { bandCount: barCount })
          .then((levels) => {
            if (!isStopped) targets = levels;
          })
          .catch(() => {
            targets = silence;
          })
          .finally(() => {
            isFetchingRef.current = false;
          });
      }
      barsRef.current = stepBars(barsRef.current, isPlaying ? targets : silence, elapsed);
      draw(context, barsRef.current, frame);
      if (!isPlaying && isSettled(barsRef.current)) return;
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);

    return () => {
      isStopped = true;
      cancelAnimationFrame(animationFrame);
    };
  }, [canvasRef, width, height, pixelRatio, barCount, isOnScreen, isPlaying, colorKey, draw]);
}
