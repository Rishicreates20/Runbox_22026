import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { API_URL, api, sleep } from '../lib/config';
import { newId, readJSON, safeLocal, safeSession, writeJSON, writeRaw } from '../lib/storage';
import type { User } from '../lib/types';
import { seedDemoAccount } from './demoSeed';

export type Provider = 'github' | 'google';

export class AuthError extends Error {
  field?: 'username' | 'email' | 'password';
  constructor(message: string, field?: AuthError['field']) {
    super(message);
    this.field = field;
  }
}

interface AuthValue {
  user: User | null;
  ready: boolean;
  demoMode: boolean;
  signIn(email: string, password: string, remember: boolean): Promise<User>;
  signUp(username: string, email: string, password: string): Promise<User>;
  signInWithProvider(provider: Provider): Promise<User | void>;
  signInDemo(): Promise<User>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export function validateEmail(email: string): string | null {
  if (!email.trim()) return 'Enter your email address.';
  if (!EMAIL_RE.test(email.trim())) return 'That email address looks incomplete.';
  return null;
}

export function validatePassword(password: string, isNew: boolean): string | null {
  if (!password) return 'Enter your password.';
  if (isNew && password.length < 8) return 'Use at least 8 characters.';
  return null;
}

export function validateUsername(username: string): string | null {
  if (!username.trim()) return 'Pick a username.';
  if (!USERNAME_RE.test(username.trim())) return 'Use 3–20 letters, numbers or underscores.';
  return null;
}

/* ---------------- Local (demo mode) auth backend ----------------
 * Everything here stays in this browser. It exists so the frontend can be
 * explored without a server. Real deployments set VITE_API_URL and the
 * server owns accounts, password hashing and sessions. */

interface StoredUser extends User {
  salt: string;
  hash: string;
}

const USERS_KEY = 'codeplus.users';
const SESSION_KEY = 'codeplus.session';

async function digest(salt: string, password: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  try {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    let h = 2166136261;
    for (const b of data) h = Math.imul(h ^ b, 16777619);
    return (h >>> 0).toString(16);
  }
}

function publicUser(u: StoredUser | User): User {
  return { id: u.id, username: u.username, email: u.email, provider: u.provider, createdAt: u.createdAt };
}

function readSession(): User | null {
  return readJSON<User | null>(SESSION_KEY, null, safeLocal()) ?? readJSON<User | null>(SESSION_KEY, null, safeSession());
}

function writeSession(user: User | null, remember = true) {
  writeRaw(SESSION_KEY, null, safeLocal());
  writeRaw(SESSION_KEY, null, safeSession());
  if (user) writeJSON(SESSION_KEY, user, remember ? safeLocal() : safeSession());
}

const local = {
  users(): StoredUser[] {
    return readJSON<StoredUser[]>(USERS_KEY, []);
  },
  save(users: StoredUser[]) {
    writeJSON(USERS_KEY, users);
  },
  async signIn(email: string, password: string): Promise<User> {
    await sleep(650);
    const u = local.users().find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
    if (!u) throw new AuthError('No account uses that email. Create one instead?', 'email');
    if ((await digest(u.salt, password)) !== u.hash) throw new AuthError('That password is not right.', 'password');
    return publicUser(u);
  },
  async signUp(username: string, email: string, password: string): Promise<User> {
    await sleep(750);
    const users = local.users();
    if (users.some((x) => x.email.toLowerCase() === email.trim().toLowerCase()))
      throw new AuthError('An account already uses that email.', 'email');
    if (users.some((x) => x.username.toLowerCase() === username.trim().toLowerCase()))
      throw new AuthError('That username is taken.', 'username');
    const salt = newId();
    const user: StoredUser = {
      id: newId(),
      username: username.trim(),
      email: email.trim(),
      provider: 'password',
      createdAt: Date.now(),
      salt,
      hash: await digest(salt, password),
    };
    local.save([...users, user]);
    return publicUser(user);
  },
  async provider(provider: Provider): Promise<User> {
    await sleep(600);
    const id = `${provider}-demo`;
    return { id, username: `${provider}_coder`, email: `${provider}_coder@example.com`, provider, createdAt: Date.now() };
  },
  async demo(): Promise<User> {
    await sleep(500);
    const user: User = { id: 'demo-ada', username: 'ada_l', email: 'ada@example.com', provider: 'demo', createdAt: Date.now() };
    seedDemoAccount(user.id);
    return user;
  },
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const demoMode = API_URL === '';
  const [user, setUser] = useState<User | null>(() => (demoMode ? readSession() : null));
  const [ready, setReady] = useState(demoMode);

  useEffect(() => {
    if (demoMode) return;
    let alive = true;
    api<{ user: User | null }>('/auth/me')
      .then((r) => alive && setUser(r.user))
      .catch(() => alive && setUser(null))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [demoMode]);

  const signIn = useCallback(
    async (email: string, password: string, remember: boolean) => {
      const u = demoMode
        ? await local.signIn(email, password)
        : (await api<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, remember }) })).user;
      if (demoMode) writeSession(u, remember);
      setUser(u);
      return u;
    },
    [demoMode],
  );

  const signUp = useCallback(
    async (username: string, email: string, password: string) => {
      const u = demoMode
        ? await local.signUp(username, email, password)
        : (await api<{ user: User }>('/auth/signup', { method: 'POST', body: JSON.stringify({ username, email, password }) })).user;
      if (demoMode) writeSession(u, true);
      setUser(u);
      return u;
    },
    [demoMode],
  );

  const signInWithProvider = useCallback(
    async (provider: Provider) => {
      if (!demoMode) {
        window.location.assign(`${API_URL}/auth/${provider}?redirect=${encodeURIComponent(window.location.origin + '/problems')}`);
        return;
      }
      const u = await local.provider(provider);
      writeSession(u, true);
      setUser(u);
      return u;
    },
    [demoMode],
  );

  const signInDemo = useCallback(async () => {
    const u = await local.demo();
    writeSession(u, true);
    setUser(u);
    return u;
  }, []);

  const signOut = useCallback(async () => {
    if (!demoMode) await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    writeSession(null);
    setUser(null);
  }, [demoMode]);

  const value = useMemo<AuthValue>(
    () => ({ user, ready, demoMode, signIn, signUp, signInWithProvider, signInDemo, signOut }),
    [user, ready, demoMode, signIn, signUp, signInWithProvider, signInDemo, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
