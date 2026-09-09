/**
 * What a route paints while it has no credential yet. Every route needs one before it can
 * render anything, and `serverWithCred` is null for the whole keychain round-trip as well as for
 * a read that failed - the same pending-vs-absent collapse the album lookup in `AppRoutes` had,
 * one prerequisite earlier. There is no "no server configured" case to express here: `App`
 * renders the setup wizard when the `servers` table is empty, so a route only mounts with a
 * server row present. The credential query retries only a secret store that is not up yet, and
 * only for 31s, so anything reaching the error branch has stopped resolving itself - which is
 * why it gets a message pointing at the fix, plus a retry, instead of sitting on the loading
 * state forever.
 *
 * Shared rather than written out per route because the two states have to stay in step; the
 * per-route copy drifted for exactly this reason before it was consolidated, and the browse
 * routes drifted further still - two of them told a configured user to go add the server they
 * already had, and one sat on a "Loading…" a failed read never left.
 */
export function CredentialNotice({
  credError,
  credPending,
  retryCredential,
}: {
  credError: Error | null;
  credPending: boolean;
  retryCredential: () => void;
}) {
  if (credError || !credPending) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">Canon could not read the saved credential</p>
        <p className="empty-state-hint">
          {credError ? credError.message : "The stored credential could not be loaded."}
        </p>
        <p className="empty-state-hint">
          A locked or not-yet-started keyring clears on its own; otherwise re-enter your server
          password in Settings.
        </p>
        <button className="empty-state-action" onClick={retryCredential}>Try again</button>
      </div>
    );
  }
  return <p className="empty-state">Connecting to your server…</p>;
}
