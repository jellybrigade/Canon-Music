import { useEffect, useRef } from "react";

/**
 * Dismisses the global search overlay whenever the route changes under it.
 *
 * The overlay is rendered *instead of* the router's content (AppShell's
 * renderContent), and its open state is plain component state, not part of the
 * URL. So anything that navigates while a search is active (the command
 * palette, the player bar, a context menu) lands on the new route with the
 * overlay still painted on top, and the click reads as having done nothing.
 * Navigation is the one signal that always means "show me somewhere else", so
 * the dismissal belongs here rather than being repeated at each call site.
 *
 * Skips the first render: mounting is not navigation, and clearing there would
 * fight a search restored alongside an initial route.
 */
export function useClearSearchOnNavigate(pathname: string, clearSearch: () => void) {
  const lastPathname = useRef(pathname);
  // Read through a ref so a caller passing a fresh closure each render doesn't
  // re-run the effect (which would clear on every render, not on navigation).
  const clearRef = useRef(clearSearch);
  clearRef.current = clearSearch;

  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    clearRef.current();
  }, [pathname]);
}
