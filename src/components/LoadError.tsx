import { errorMessage } from "../lib/errorMessage";

interface LoadErrorProps {
  title: string;
  error: unknown;
  onRetry: () => void;
}

/** A read that failed, said apart from an empty one, with a way to read again. */
export function LoadError({ title, error, onRetry }: LoadErrorProps) {
  return (
    <div className="empty-state" role="alert">
      <p className="empty-state-title">{title}</p>
      <p className="empty-state-hint">{errorMessage(error)}</p>
      <button type="button" className="empty-state-action" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
