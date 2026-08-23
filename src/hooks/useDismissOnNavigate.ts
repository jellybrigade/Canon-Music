import { useEffect, useRef } from "react";

/**
 * Dismisses every overlay that is painted over the router whenever the route changes under it.
 *
 * Two overlays are drawn outside the URL: the search overlay renders *instead of* the router's
 * content (AppShell's renderContent), and the command palette paints *over* whichever of the two
 * is underneath. Both are plain component state in App.tsx. So anything that navigates while one
 * is up lands on the new route with the overlay still covering it, and the click reads as having
 * done nothing.
 *
 * Navigation is the one signal that always means "show me somewhere else", so the dismissal
 * belongs here rather than being repeated at each call site. That distinction is load-bearing:
 * the palette originally had no mechanism at all, only a hand-written setCommandPaletteOpen(false)
 * in each of the five handlers it owns, so the four window-level navigation sources in
 * useAppNavigation (Alt+Arrow, mouse thumb buttons) - which reach the app straight through the
 * palette's backdrop - left it stranded over the new route. See known-issues.md, "A stacking
 * guard written as a hand-kept list only covers the layers its author could see".
 *
 * Takes one `dismiss` callback rather than a list of overlays: a new overlay is added by
 * composing it into that callback at the single site where the overlays' state already lives,
 * not by extending an enumeration here.
 *
 * Skips the first render: mounting is not navigation, and clearing there would fight a search
 * restored alongside an initial route.
 */
export function useDismissOnNavigate(pathname: string, dismiss: () => void) {
  const lastPathname = useRef(pathname);
  // Read through a ref so a caller passing a fresh closure each render doesn't
  // re-run the effect (which would dismiss on every render, not on navigation).
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    dismissRef.current();
  }, [pathname]);
}
