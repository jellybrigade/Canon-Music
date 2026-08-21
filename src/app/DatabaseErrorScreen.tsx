import { SchemaTooNewError } from "../db/migrations";

interface Props {
  error: unknown;
  onRetry: () => void;
}

/**
 * A database from a newer build and an unreadable one are different failures: the first is
 * permanent until the user updates, so offering "Try again" would be a button that cannot work.
 */
export function DatabaseErrorScreen({ error, onRetry }: Props) {
  const tooNew = error instanceof SchemaTooNewError ? error : null;

  if (tooNew) {
    return (
      <div className="app-fatal">
        <h1 className="app-fatal-title">This library needs a newer Canon</h1>
        <p className="app-fatal-message">
          Your library was last opened by Canon with database version {tooNew.found}. This build
          only understands version {tooNew.supported}, and there is no way back down.
        </p>
        <p className="app-fatal-hint">
          Nothing has been changed on disk. Update Canon to the version you were using and your
          library opens as before.
        </p>
      </div>
    );
  }

  return (
    <div className="app-fatal">
      <h1 className="app-fatal-title">Canon could not read its database</h1>
      <p className="app-fatal-message">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <p className="app-fatal-hint">
        Your server settings and library are still on disk. This is usually a locked or
        in-use database file, so closing any other running copy of Canon and trying again
        is the first thing to check.
      </p>
      <button className="app-fatal-btn" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
