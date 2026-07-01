import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import ErrorPage from '@/pages/ErrorPage';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches render-time errors anywhere in the child tree and shows a
 * friendly recovery screen. "Try again" resets the boundary state so
 * the subtree re-renders.
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the console for local debugging; a real monitoring
    // service (Sentry, etc.) would be wired here in production.
    // eslint-disable-next-line no-console
    console.error('Uncaught render error:', error, info.componentStack);
  }

  private readonly handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <ErrorPage
          error={this.state.error ?? undefined}
          code={this.state.error?.name}
          onRetry={this.handleReset}
        />
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
