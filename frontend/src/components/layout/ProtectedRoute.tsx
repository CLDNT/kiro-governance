import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import AppShell from '@/components/layout/AppShell';
import { Skeleton } from '@/components/ui/skeleton';

/** Full-screen skeleton shown while the auth session is being restored. */
function AuthLoadingScreen(): JSX.Element {
  return (
    <div className="flex h-screen w-full bg-background">
      {/* Sidebar skeleton */}
      <div className="hidden w-64 flex-col gap-4 border-r bg-sidebar p-4 md:flex">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg bg-sidebar-accent" />
          <Skeleton className="h-4 w-28 bg-sidebar-accent" />
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full bg-sidebar-accent" />
          ))}
        </div>
        <div className="mt-auto flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-full bg-sidebar-accent" />
          <Skeleton className="h-4 w-24 bg-sidebar-accent" />
        </div>
      </div>

      {/* Content skeleton */}
      <div className="flex flex-1 flex-col">
        <div className="flex h-14 items-center gap-3 border-b px-4">
          <Skeleton className="h-7 w-7" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex-1 space-y-6 p-8">
          <Skeleton className="h-8 w-64" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

function ProtectedRoute(): JSX.Element {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <AuthLoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export default ProtectedRoute;
