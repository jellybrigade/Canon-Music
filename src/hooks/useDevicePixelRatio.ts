import { useSyncExternalStore } from "react";

function currentRatio(): number {
  return window.devicePixelRatio || 1;
}

// A resolution query only reports leaving its own ratio, so each change re-arms one for the new ratio.
function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  let query = window.matchMedia(`(resolution: ${currentRatio()}dppx)`);
  const handleChange = () => {
    query.removeEventListener("change", handleChange);
    query = window.matchMedia(`(resolution: ${currentRatio()}dppx)`);
    query.addEventListener("change", handleChange);
    onChange();
  };
  query.addEventListener("change", handleChange);
  return () => query.removeEventListener("change", handleChange);
}

/** The window's device pixel ratio, updated when it moves to a screen with another one or zooms. */
export function useDevicePixelRatio(): number {
  return useSyncExternalStore(subscribe, currentRatio, currentRatio);
}
