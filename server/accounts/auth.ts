/**
 * Who is calling: turns the browser's sign-in token into a user. Sign-in itself happens in the
 * browser with Supabase Auth (Google / Discord); the server only checks the token with Supabase
 * and never sees a password.
 */

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
}

export interface Verifier {
  verify(token: string): Promise<AuthUser | null>;
}

const CACHE_MS = 5 * 60_000;
const CACHE_MAX = 2000;

/** Asks Supabase who a token belongs to; remembers the answer for a few minutes. */
export class SupabaseVerifier implements Verifier {
  private cache = new Map<string, { user: AuthUser | null; until: number }>();
  constructor(private url: string, private anonKey: string) {}

  async verify(token: string): Promise<AuthUser | null> {
    const now = Date.now();
    const hit = this.cache.get(token);
    if (hit && hit.until > now) return hit.user;
    let user: AuthUser | null = null;
    try {
      const res = await fetch(`${this.url.replace(/\/$/, '')}/auth/v1/user`, {
        headers: { apikey: this.anonKey, authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const u = (await res.json()) as { id?: string; email?: string; user_metadata?: Record<string, unknown> };
        const meta = u.user_metadata ?? {};
        const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
        if (u.id && u.email) {
          user = {
            id: u.id,
            email: u.email.toLowerCase(),
            name: (str(meta.full_name) ?? str(meta.name) ?? str(meta.user_name) ?? u.email.split('@')[0]).slice(0, 60),
            avatar: str(meta.avatar_url) ?? str(meta.picture),
          };
        }
      } else if (res.status >= 500) {
        return null; // Supabase trouble: do not cache a refusal
      }
    } catch {
      return null;
    }
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(token, { user, until: now + CACHE_MS });
    return user;
  }
}

/**
 * Local development only (never in production): the token "dev:<email>" signs in as that email,
 * so accounts, approval and the admin panel can be tried without a Supabase project.
 */
export class DevVerifier implements Verifier {
  async verify(token: string): Promise<AuthUser | null> {
    const m = /^dev:([^@\s]+@[^@\s]+)$/.exec(token);
    if (!m) return null;
    const email = m[1].toLowerCase();
    return { id: `dev-${email}`, email, name: email.split('@')[0], avatar: null };
  }
}
