import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { API_URL, SUPABASE_ANON_KEY, SUPABASE_URL, api, sleep } from '../lib/config';
import { newId, readJSON, safeLocal, safeSession, writeJSON, writeRaw } from '../lib/storage';
import { setRememberSession, supabase } from '../lib/supabase';
import type { User } from '../lib/types';
import { seedDemoAccount } from './demoSeed';

export type Provider = 'github' | 'google';
export type Backend = 'supabase' | 'api' | 'local';

export class AuthError extends Error {
  field?: 'username' | 'email' | 'password';
  code?: 'unconfirmed';
  constructor(message: string, field?: AuthError['field'], code?: AuthError['code']) {
    super(message);
    this.field = field;
    this.code = code;
  }
}

export interface SignUpResult {
  user: User | null;
  /** True when the account exists but the email address still has to be confirmed. */
  needsConfirmation: boolean;
}

interface AuthValue {
  user: User | null;
  ready: boolean;
  backend: Backend;
  /** Local, browser-only accounts (no server connected). */
  demoMode: boolean;
  /** Which social sign-ins are switched on. Null while unknown. */
  providers: Record<Provider, boolean> | null;
  canCreateProblems: boolean;
  signIn(email: string, password: string, remember: boolean): Promise<User | null>;
  signUp(username: string, email: string, password: string): Promise<SignUpResult>;
  signInWithProvider(provider: Provider): Promise<User | void>;
  signInDemo(): Promise<User>;
  signOut(): Promise<void>;
  usernameAvailable(username: string): Promise<boolean | null>;
  resendConfirmation(email: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
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

const redirectTo = (path: string) => `${window.location.origin}${path}`;

/* ---------------- Local (demo mode) auth backend ----------------
 * Everything here stays in this browser. It exists so the frontend can be
 * explored without a server. */

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
  return { id: u.id, username: u.username, email: u.email, provider: u.provider, role: u.role ?? 'user', createdAt: u.createdAt };
}

function readSession(): User | null {
  const u = readJSON<User | null>(SESSION_KEY, null, safeLocal()) ?? readJSON<User | null>(SESSION_KEY, null, safeSession());
  return u ? publicUser(u) : null;
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
      role: 'user',
      createdAt: Date.now(),
      salt,
      hash: await digest(salt, password),
    };
    local.save([...users, user]);
    return publicUser(user);
  },
  async provider(provider: Provider): Promise<User> {
    await sleep(600);
    return { id: `${provider}-demo`, username: `${provider}_coder`, email: `${provider}_coder@example.com`, provider, role: 'user', createdAt: Date.now() };
  },
  async demo(): Promise<User> {
    await sleep(500);
    const user: User = { id: 'demo-ada', username: 'ada_l', email: 'ada@example.com', provider: 'demo', role: 'user', createdAt: Date.now() };
    seedDemoAccount(user.id);
    return user;
  },
};

/* ---------------- Supabase helpers ---------------- */

function supabaseError(message: string, code?: string): AuthError {
  switch (code) {
    case 'invalid_credentials':
      return new AuthError('Email or password is incorrect.', 'password');
    case 'email_not_confirmed':
      return new AuthError('Confirm your email address first. Use the link we sent when you signed up.', 'email', 'unconfirmed');
    case 'user_already_exists':
    case 'email_exists':
      return new AuthError('An account already uses that email. Sign in instead.', 'email');
    case 'weak_password':
      return new AuthError('Choose a stronger password: at least 8 characters with letters and numbers.', 'password');
    case 'email_address_invalid':
      return new AuthError('That email address cannot receive mail.', 'email');
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return new AuthError('Too many attempts. Wait a minute and try again.');
    case 'email_address_not_authorized':
      return new AuthError('Code+ cannot send email to this address yet. The site owner needs to set up outgoing email in Supabase.');
    case 'signup_disabled':
      return new AuthError('New sign-ups are turned off right now.');
    default:
      return new AuthError(message || 'Something went wrong. Try again.');
  }
}

interface Profile {
  id: string;
  username: string;
  role: 'user' | 'admin';
}

function toUser(session: Session, profile: Profile | null): User {
  const u = session.user;
  const provider = (u.app_metadata?.provider as User['provider'] | undefined) ?? 'email';
  return {
    id: u.id,
    username: profile?.username ?? (u.user_metadata?.username as string | undefined) ?? (u.email?.split('@')[0] ?? 'coder'),
    email: u.email ?? '',
    provider,
    role: profile?.role ?? 'user',
    createdAt: Date.parse(u.created_at),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const backend: Backend = supabase ? 'supabase' : API_URL ? 'api' : 'local';
  const demoMode = backend === 'local';

  const [localUser, setLocalUser] = useState<User | null>(() => (demoMode ? readSession() : null));
  const [apiReady, setApiReady] = useState(backend !== 'api');

  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(backend !== 'supabase');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [providers, setProviders] = useState<Record<Provider, boolean> | null>(
    backend === 'supabase' ? null : { github: true, google: true },
  );

  // Supabase: restore the session and follow sign-in / sign-out events.
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setSessionReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setSessionReady(true);
    });
    fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { external?: Record<string, boolean> } | null) => {
        if (alive) setProviders({ github: Boolean(s?.external?.github), google: Boolean(s?.external?.google) });
      })
      .catch(() => alive && setProviders({ github: false, google: false }));
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  // Supabase: load the profile (username, role) for the signed-in user.
  const sessionUserId = session?.user.id ?? null;
  useEffect(() => {
    if (!supabase || !sessionUserId) {
      setProfile(null);
      return;
    }
    let alive = true;
    supabase
      .from('profiles')
      .select('id, username, role')
      .eq('id', sessionUserId)
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setProfile((data as Profile | null) ?? { id: sessionUserId, username: '', role: 'user' });
      });
    return () => {
      alive = false;
    };
  }, [sessionUserId]);

  // API backend: ask the server who is signed in.
  useEffect(() => {
    if (backend !== 'api') return;
    let alive = true;
    api<{ user: User | null }>('/auth/me')
      .then((r) => alive && setLocalUser(r.user))
      .catch(() => alive && setLocalUser(null))
      .finally(() => alive && setApiReady(true));
    return () => {
      alive = false;
    };
  }, [backend]);

  const profileReady = !sessionUserId || profile?.id === sessionUserId;
  const user = useMemo<User | null>(() => {
    if (backend === 'supabase') {
      if (!session || !profileReady) return null;
      const p = profile && profile.username ? profile : null;
      return toUser(session, p);
    }
    return localUser;
  }, [backend, session, profile, profileReady, localUser]);
  const ready = backend === 'supabase' ? sessionReady && profileReady : apiReady;

  const signIn = useCallback(
    async (email: string, password: string, remember: boolean) => {
      if (supabase) {
        setRememberSession(remember);
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw supabaseError(error.message, error.code);
        return null;
      }
      const u = demoMode
        ? await local.signIn(email, password)
        : (await api<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, remember }) })).user;
      if (demoMode) writeSession(u, remember);
      setLocalUser(u);
      return u;
    },
    [demoMode],
  );

  const usernameAvailable = useCallback(async (username: string) => {
    if (!supabase) return null;
    const { data, error } = await supabase.rpc('username_available', { name: username.trim() });
    return error ? null : Boolean(data);
  }, []);

  const signUp = useCallback(
    async (username: string, email: string, password: string): Promise<SignUpResult> => {
      if (supabase) {
        if ((await usernameAvailable(username)) === false) throw new AuthError('That username is taken.', 'username');
        setRememberSession(true);
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { username: username.trim() }, emailRedirectTo: redirectTo('/problems') },
        });
        if (error) throw supabaseError(error.message, error.code);
        // With confirmations on, an address that already has an account comes back with no identities.
        if (data.user && data.user.identities && data.user.identities.length === 0) {
          throw new AuthError('An account already uses that email. Sign in instead.', 'email');
        }
        return { user: null, needsConfirmation: !data.session };
      }
      const u = demoMode
        ? await local.signUp(username, email, password)
        : (await api<{ user: User }>('/auth/signup', { method: 'POST', body: JSON.stringify({ username, email, password }) })).user;
      if (demoMode) writeSession(u, true);
      setLocalUser(u);
      return { user: u, needsConfirmation: false };
    },
    [demoMode, usernameAvailable],
  );

  const signInWithProvider = useCallback(
    async (provider: Provider) => {
      const name = provider === 'github' ? 'GitHub' : 'Google';
      if (supabase) {
        if (providers && !providers[provider]) {
          throw new AuthError(`${name} sign-in isn't switched on for Code+ yet. Use your email and password for now.`);
        }
        setRememberSession(true);
        const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo('/problems') } });
        if (error) throw supabaseError(error.message, error.code);
        return;
      }
      if (!demoMode) {
        window.location.assign(`${API_URL}/auth/${provider}?redirect=${encodeURIComponent(redirectTo('/problems'))}`);
        return;
      }
      const u = await local.provider(provider);
      writeSession(u, true);
      setLocalUser(u);
      return u;
    },
    [demoMode, providers],
  );

  const signInDemo = useCallback(async () => {
    const u = await local.demo();
    writeSession(u, true);
    setLocalUser(u);
    return u;
  }, []);

  const signOut = useCallback(async () => {
    if (supabase) {
      await supabase.auth.signOut();
      return;
    }
    if (!demoMode) await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    writeSession(null);
    setLocalUser(null);
  }, [demoMode]);

  const resendConfirmation = useCallback(async (email: string) => {
    if (!supabase) return;
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: redirectTo('/problems') } });
    if (error) throw supabaseError(error.message, error.code);
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!supabase) return;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectTo('/reset-password') });
    if (error) throw supabaseError(error.message, error.code);
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) throw new AuthError('Password changes need the Code+ server.');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw supabaseError(error.message, error.code);
  }, []);

  const canCreateProblems = Boolean(user) && (demoMode || user?.role === 'admin');

  const value = useMemo<AuthValue>(
    () => ({
      user,
      ready,
      backend,
      demoMode,
      providers,
      canCreateProblems,
      signIn,
      signUp,
      signInWithProvider,
      signInDemo,
      signOut,
      usernameAvailable,
      resendConfirmation,
      requestPasswordReset,
      updatePassword,
    }),
    [user, ready, backend, demoMode, providers, canCreateProblems, signIn, signUp, signInWithProvider, signInDemo, signOut, usernameAvailable, resendConfirmation, requestPasswordReset, updatePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
