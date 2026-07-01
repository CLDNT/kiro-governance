import { useNavigate } from 'react-router-dom';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui';

export interface ErrorPageProps {
  /** The caught error, if any (passed by ErrorBoundary). */
  error?: Error;
  /** Optional error code shown beneath the title. */
  code?: string;
  /** Reset handler — re-renders the failed subtree (passed by ErrorBoundary). */
  onRetry?: () => void;
}

/**
 * Generic "something went wrong" screen.
 * Doubles as the ErrorBoundary fallback (receives error + onRetry)
 * and as a standalone route.
 */
function ErrorPage({ error, code, onRetry }: ErrorPageProps): JSX.Element {
  const navigate = useNavigate();

  const handleRetry = (): void => {
    if (onRetry) {
      onRetry();
    } else {
      window.location.reload();
    }
  };

  const handleHome = (): void => {
    if (onRetry) onRetry();
    navigate('/projects');
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[var(--bg-base)] px-4 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--color-danger-light)]">
        <ExclamationTriangleIcon className="h-10 w-10 text-[var(--color-danger)]" />
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Something went wrong</h1>
        <p className="max-w-md text-sm text-[var(--text-secondary)]">
          An unexpected error occurred. You can try again, or head back to your projects.
        </p>
        {code && (
          <p className="text-xs font-mono text-[var(--text-muted)]">Error code: {code}</p>
        )}
        {error?.message && (
          <p className="mx-auto max-w-md break-words rounded-[var(--radius-md)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-mono text-[var(--text-muted)] shadow-[var(--shadow-sm)]">
            {error.message}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button variant="default" onClick={handleRetry}>
          Try Again
        </Button>
        <Button variant="secondary" onClick={handleHome}>
          Go Home
        </Button>
      </div>
    </div>
  );
}

export default ErrorPage;
