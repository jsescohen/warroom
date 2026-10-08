import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The player's account in the browser. Three access modes, chosen by the server:
 *   open      local development, nothing to do
 *   beta      a shared tester code (src/ui/betaGate.ts)
 *   accounts  sign in with Google / Discord through Supabase; the admin approves new accounts
 * Every call to our own server goes through apiFetch, which adds the sign-in token.
 */

export interface Access {
  mode: 'open' | 'beta' | 'accounts';
  supabaseUrl?: string | null;
  supabaseAnonKey?: string | null;
  providers?: string[];
  /** Local development: sign in by typing an email (no Supabase project). */
  dev?: boolean;
}

export interface Me {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  status: 'pending' | 'approved' | 'rejected';
  admin: boolean;
}

const DEV_TOKEN_KEY = 'warroom.devToken';

let access: Access = { mode: 'open' };
let supabase: SupabaseClient | null = null;
let me: Me | null = null;

export const getAccess = () => access;
export const currentUser = () => me;
/** Signed in and approved: saves live in the cloud. */
export const cloudSaves = () => access.mode === 'accounts' && me?.status === 'approved';

/** Asks the server how players get in, and restores a sign-in session if there is one. */
export async function initAccess(): Promise<Access> {
  try {
    const res = await fetch('/api/access');
    if (res.ok) access = await res.json();
    else if (res.status === 404) access = { mode: 'open' }; // an older server without accounts
    else throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    // the web dev server can run without the API; a deployed game cannot
    access = import.meta.env.DEV ? { mode: 'open' } : { mode: 'accounts' };
    if (!import.meta.env.DEV) throw e;
  }
  if (access.mode === 'accounts' && access.supabaseUrl && access.supabaseAnonKey) {
    const { createClient } = await import('@supabase/supabase-js');
    // PKCE: after Google/Discord the browser returns with ?code=…, which the client exchanges
    supabase = createClient(access.supabaseUrl, access.supabaseAnonKey, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } });
    await supabase.auth.getSession();
    // tidy the address bar after the sign-in redirect
    if (new URLSearchParams(location.search).has('code')) history.replaceState(null, '', location.pathname);
  }
  return access;
}

async function token(): Promise<string | null> {
  if (access.mode !== 'accounts') return null;
  if (supabase) return (await supabase.auth.getSession()).data.session?.access_token ?? null;
  if (access.dev) {
    try { return localStorage.getItem(DEV_TOKEN_KEY); } catch { return null; }
  }
  return null;
}

/** fetch() for our own server: adds the sign-in token when there is one. */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const t = await token();
  if (!t) return fetch(url, init);
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${t}`);
  return fetch(url, { ...init, headers });
}

/** The signed-in account and its approval status, or null when signed out. */
export async function loadMe(): Promise<Me | null> {
  if (!(await token())) return (me = null);
  const res = await apiFetch('/api/me');
  if (res.status === 401) return (me = null);
  if (!res.ok) throw new Error(`Could not reach the game server (HTTP ${res.status}).`);
  return (me = await res.json());
}

/** Starts sign-in: leaves for Google / Discord and comes back to this page. */
export async function signIn(provider: string, devEmail?: string) {
  if (access.dev && devEmail) {
    try { localStorage.setItem(DEV_TOKEN_KEY, `dev:${devEmail.trim().toLowerCase()}`); } catch { /* private mode */ }
    location.reload();
    return;
  }
  if (!supabase) throw new Error('Sign-in is not configured on the server.');
  const { error } = await supabase.auth.signInWithOAuth({ provider: provider as 'google', options: { redirectTo: `${location.origin}/` } });
  if (error) throw error;
}

export async function signOut() {
  try { localStorage.removeItem(DEV_TOKEN_KEY); } catch { /* ignore */ }
  if (supabase) await supabase.auth.signOut();
  location.href = location.pathname;
}
