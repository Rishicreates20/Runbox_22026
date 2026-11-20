import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_MODE, SUPABASE_URL } from './config';

const REMEMBER_KEY = 'codeplus.remember';

function remember(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== '0';
  } catch {
    return true;
  }
}

/** "Keep me signed in" decides whether the session lives in localStorage or only this tab. */
export function setRememberSession(value: boolean): void {
  try {
    localStorage.setItem(REMEMBER_KEY, value ? '1' : '0');
  } catch {
    /* storage blocked: Supabase falls back to memory */
  }
}

const sessionStorageAdapter = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key) ?? sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      const keep = remember();
      (keep ? localStorage : sessionStorage).setItem(key, value);
      (keep ? sessionStorage : localStorage).removeItem(key);
    } catch {
      /* ignore */
    }
  },
  removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export const supabase: SupabaseClient | null = SUPABASE_MODE
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: sessionStorageAdapter,
        storageKey: 'codeplus.auth',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
