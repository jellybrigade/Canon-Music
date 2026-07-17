import { useEffect } from "react";

/**
 * Sets `data-app-blurred` on <html> while the window is unfocused, so CSS can
 * pause heavy infinite animations (spinners, pulses). Reduces WebKitGTK GPU
 * compositor load during focus loss/regain - the exact trigger condition for
 * the freeze/thaw crash documented in known-issues.md. Ported from psysonic.
 */
export function useAppActivityTracking() {
  useEffect(() => {
    const root = document.documentElement;
    const onBlur = () => root.setAttribute("data-app-blurred", "true");
    const onFocus = () => root.removeAttribute("data-app-blurred");
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      root.removeAttribute("data-app-blurred");
    };
  }, []);
}
