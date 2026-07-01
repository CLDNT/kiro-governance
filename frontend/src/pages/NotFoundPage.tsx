import { useNavigate } from 'react-router-dom';
import { Home, Compass } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

function NotFoundPage(): JSX.Element {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-md text-center shadow-lg">
        <CardContent className="flex flex-col items-center gap-5 p-10">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Compass className="h-8 w-8" />
          </div>
          <p className="text-7xl font-extrabold tracking-tight text-primary">404</p>
          <div className="space-y-1.5">
            <h1 className="text-xl font-bold text-foreground">Page not found</h1>
            <p className="text-sm text-muted-foreground">
              The page you&rsquo;re looking for doesn&rsquo;t exist or may have been moved.
            </p>
          </div>
          <Button onClick={() => navigate('/projects')} className="gap-2">
            <Home />
            Back to Projects
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default NotFoundPage;
