/** Shared so every route keeps the pending/error states in step. */
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
