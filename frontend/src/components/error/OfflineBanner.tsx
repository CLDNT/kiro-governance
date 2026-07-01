import { useEffect, useState } from 'react';
import { WifiIcon } from '@heroicons/react/24/outline';

/**
 * Fixed bottom banner shown while the browser reports it is offline.
 * Auto-dismisses when connectivity returns.
 */
function OfflineBanner(): JSX.Element | null {
  const [offline, setOffline] = useState<boolean>(() => !navigator.onLine);

  useEffect(() => {
    const handleOnline = (): void => setOffline(false);
    const handleOffline = (): void => setOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="ds-animate-slide-up fixed inset-x-0 bottom-0 z-[60] flex items-center justify-center gap-2 border-t border-[var(--color-warning)] bg-[var(--color-warning-light)] px-4 py-2 text-sm font-medium text-[var(--color-warning)]"
    >
      <WifiIcon className="h-4 w-4" aria-hidden="true" />
      <span>You are offline. Some features may not work.</span>
    </div>
  );
}

export default OfflineBanner;
