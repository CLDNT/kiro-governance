import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from '@/components/layout/ProtectedRoute';
import ErrorBoundary from '@/components/error/ErrorBoundary';
import OfflineBanner from '@/components/error/OfflineBanner';
import LoginPage from '@/pages/LoginPage';
import ProjectsPage from '@/pages/ProjectsPage';
import ProjectDetailPage from '@/pages/ProjectDetailPage';
import DashboardPage from '@/pages/DashboardPage';
import NotFoundPage from '@/pages/NotFoundPage';

function App(): JSX.Element {
  return (
    <ErrorBoundary>
      <OfflineBanner />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
        </Route>
        <Route path="/404" element={<NotFoundPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ErrorBoundary>
  );
}

export default App;
