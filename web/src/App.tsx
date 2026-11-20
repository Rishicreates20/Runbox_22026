import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { DataSync } from './components/DataSync';
import { PlusLoader } from './components/PlusLoader';
import { GuestOnly, RequireAuth } from './components/RequireAuth';
import { AuthPage } from './pages/AuthPage';
import { CreateProblemPage } from './pages/CreateProblem';
import { NotFound } from './pages/NotFound';
import { ProblemsPage } from './pages/Problems';
import { ResetPasswordPage } from './pages/ResetPassword';
import { SubmissionsPage } from './pages/Submissions';
import { SubmitPage } from './pages/Submit';

// The editor (CodeMirror) is most of the bundle, so it loads only when a problem opens.
const WorkspacePage = lazy(() => import('./pages/Workspace').then((m) => ({ default: m.WorkspacePage })));

function Home() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  return <Navigate to={user ? '/problems' : '/login'} replace />;
}

export function App() {
  return (
    <>
      <DataSync />
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
      <Route
        path="/submit"
        element={
          <RequireAuth>
            <SubmitPage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin/problems/new"
        element={
          <RequireAuth>
            <CreateProblemPage />
          </RequireAuth>
        }
      />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}
