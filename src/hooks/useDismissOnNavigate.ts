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
 * This is the *second* of the two mechanisms that dismiss them, and the narrower one.
 * `useAppNavigation` dismisses on the intent to navigate, which covers every navigation the app
 * offers the user, including the ones that move the router nowhere and so cannot be seen here.
 * What is left for this hook is a route navigating on its own - AppRoutes sending the user back
 * to /playlists after deleting one - which never passes through that hook at all.
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
