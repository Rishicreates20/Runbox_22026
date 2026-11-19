import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { PlusLoader } from './components/PlusLoader';
import { GuestOnly, RequireAuth } from './components/RequireAuth';
import { AuthPage } from './pages/AuthPage';
import { NotFound } from './pages/NotFound';
import { ProblemsPage } from './pages/Problems';
import { SubmissionsPage } from './pages/Submissions';

// The editor (CodeMirror) is most of the bundle, so it loads only when a problem opens.
const WorkspacePage = lazy(() => import('./pages/Workspace').then((m) => ({ default: m.WorkspacePage })));

function Home() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  return <Navigate to={user ? '/problems' : '/login'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route
        path="/login"
        element={
          <GuestOnly>
            <AuthPage mode="signin" />
          </GuestOnly>
        }
      />
      <Route
        path="/signup"
        element={
          <GuestOnly>
            <AuthPage mode="signup" />
          </GuestOnly>
        }
      />
      <Route
        path="/problems"
        element={
          <RequireAuth>
            <ProblemsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/problems/:id"
        element={
          <RequireAuth>
            <Suspense fallback={<PlusLoader label="Opening the editor" />}>
              <WorkspacePage />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route
        path="/submissions"
        element={
          <RequireAuth>
            <SubmissionsPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
