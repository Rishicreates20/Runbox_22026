import { useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { loadCustomProblems } from '../lib/problems';
import { clearSubmissions, loadSubmissions } from '../lib/submissions';

/** Loads the signed-in user's problems and submissions, and clears them on sign-out. */
export function DataSync() {
  const { user, ready } = useAuth();
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!ready) return;
    loadCustomProblems(userId);
    if (userId) loadSubmissions(userId);
    else clearSubmissions();
  }, [ready, userId]);
  return null;
}
