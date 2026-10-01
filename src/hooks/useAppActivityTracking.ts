import { useEffect } from "react";

/**
 * Sets `data-app-blurred` on <html> while unfocused so CSS pauses heavy animations, reducing
 * WebKitGTK compositor load during focus loss/regain (the freeze/thaw crash trigger, see known-issues.md).
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
