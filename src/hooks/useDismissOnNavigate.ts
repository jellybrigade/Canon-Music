import { useEffect, useRef } from "react";

/**
 * Dismisses the command palette whenever the route changes under it.
 *
 * The command palette is the one overlay still drawn outside the URL: it paints *over*
 * whichever route is showing, as plain component state in App.tsx. So anything that navigates
 * while it is up lands on the new route with the palette still covering it, and the click reads
 * as having done nothing. Search used to be the other overlay here, rendering *instead of* the
 * router's content; it left this class by becoming the /search route, so a navigation while
 * search is showing is now an ordinary route change and needs no dismissal at all.
 *
 * This is the *second* of the two mechanisms that dismiss the palette, and the narrower one.
 * `useAppNavigation` dismisses on the intent to navigate, which covers every navigation the app
 * offers the user, including the ones that move the router nowhere and so cannot be seen here.
 * What is left for this hook is a route navigating on its own - AppRoutes sending the user back
 * to /playlists after deleting one - which never passes through that hook at all.
 *
 * Takes one `dismiss` callback rather than a list of overlays: a new overlay is added by
 * composing it into that callback at the single site where the overlays' state already lives,
 * not by extending an enumeration here.
 *
 * Keyed on `pathname` alone, never the whole location: a `?q` change while staying on /search
 * must not fire this and close the palette on every keystroke.
 *
 * Skips the first render: mounting is not navigation, and clearing there would fight a palette
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
