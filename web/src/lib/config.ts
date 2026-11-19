/** Base URL of the Code+ API. Empty means demo mode: auth and judging run in the browser. */
export const API_URL: string = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');

/** Supabase project for real accounts, problems, submissions and uploads. */
export const SUPABASE_URL: string = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
export const SUPABASE_ANON_KEY: string = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
export const SUPABASE_MODE = SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== '';

/** No backend at all: accounts and data stay in this browser. */
export const DEMO_MODE = !SUPABASE_MODE && API_URL === '';

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      /* keep the generic message */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
