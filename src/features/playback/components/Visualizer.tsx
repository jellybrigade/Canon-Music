import { useDevicePixelRatio } from "../../../hooks/useDevicePixelRatio";
import { useIsDocumentVisible } from "../../../hooks/useIsDocumentVisible";
import { useMeasuredElement } from "../../../hooks/useMeasuredElement";
import type { VisualizerFrame } from "../hooks/useVisualizerLoop";
import { useVisualizerLoop } from "../hooks/useVisualizerLoop";
import { useVisualizerTap } from "../hooks/useVisualizerTap";
import type { Bars } from "../lib/visualizerMotion";
import { usePlayerStore } from "../store/player";
import "./Visualizer.css";

export const VISUALIZER_BAR_COUNT = 24;
const BAR_FILL = 0.7;
const BASELINE_AT = 0.72;
const HEADROOM = 0.92;
const SIDE_INSET = 0.08;
const MIN_BAR_PX = 2;
const PEAK_CAP_PX = 2;
const PEAK_CAP_GAP_PX = 2;
const PEAK_CAP_ALPHA = 0.85;
const REFLECTION_GAP_PX = 3;
const REFLECTION_SCALE = 0.4;
const REFLECTION_ALPHA = 0.25;

function drawBars(context: CanvasRenderingContext2D, bars: Bars, { width, height, color }: VisualizerFrame) {
  context.clearRect(0, 0, width, height);
  const inset = width * SIDE_INSET;
  const slot = (width - inset * 2) / bars.levels.length;
  const barWidth = slot * BAR_FILL;
  const baseline = height * BASELINE_AT;
  const tallest = baseline * HEADROOM;
  const reflectionTop = baseline + REFLECTION_GAP_PX;

  const reflection = context.createLinearGradient(0, reflectionTop, 0, height);
  reflection.addColorStop(0, color);
  reflection.addColorStop(1, "transparent");

  bars.levels.forEach((level, i) => {
    const x = inset + i * slot + (slot - barWidth) / 2;
    const barHeight = Math.max(MIN_BAR_PX, level * tallest);
    context.globalAlpha = 1;
    context.fillStyle = color;
    context.fillRect(x, baseline - barHeight, barWidth, barHeight);

    const peak = bars.peaks[i] ?? 0;
    if (peak * tallest > barHeight + PEAK_CAP_GAP_PX) {
      context.globalAlpha = PEAK_CAP_ALPHA;
      context.fillRect(x, baseline - peak * tallest - PEAK_CAP_PX, barWidth, PEAK_CAP_PX);
    }

    context.globalAlpha = REFLECTION_ALPHA;
    context.fillStyle = reflection;
    context.fillRect(x, reflectionTop, barWidth, barHeight * REFLECTION_SCALE);
  });
  context.globalAlpha = 1;
}

export function Visualizer() {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const accentColor = usePlayerStore((s) => s.accentColor);
  const isDocumentVisible = useIsDocumentVisible();
  const pixelRatio = useDevicePixelRatio();
  const canvas = useMeasuredElement<HTMLCanvasElement>();
  const isOnScreen = isDocumentVisible && canvas.width > 0 && canvas.height > 0;

  useVisualizerTap(isOnScreen);
  useVisualizerLoop({
    canvasRef: canvas.ref,
    width: canvas.width,
    height: canvas.height,
    pixelRatio,
    barCount: VISUALIZER_BAR_COUNT,
    isOnScreen,
    isPlaying,
    colorKey: accentColor,
    draw: drawBars,
  });

  return <canvas ref={canvas.attach} className="now-playing-visualizer" />;
}
