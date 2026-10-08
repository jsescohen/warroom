import { apiFetch } from '../auth/account';

/**
 * Sends uncaught errors from the player's browser to the server, where the admin panel lists them
 * (grouped, with a count). At most a handful per visit, each different error only once.
 */

const MAX_PER_VISIT = 8;
const sent = new Set<string>();
let context: () => Record<string, unknown> = () => ({});

/** What the game is doing right now, attached to each report (era, date, nation…). */
export function setErrorContext(fn: () => Record<string, unknown>) {
  context = fn;
}

export function reportError(err: unknown, where = 'error') {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err) ?? String(err));
  const message = `${e.name}: ${e.message}`.slice(0, 500);
  if (sent.has(message) || sent.size >= MAX_PER_VISIT) return;
  // noise from browser extensions and aborted loads is not ours to fix
  if (/extension:\/\/|ResizeObserver loop|AbortError|Load failed|NetworkError|Failed to fetch/.test(`${message} ${e.stack ?? ''}`)) return;
  sent.add(message);
  let ctx: Record<string, unknown> = {};
  try { ctx = context(); } catch { /* the context itself is broken: send without it */ }
  void apiFetch('/api/errors', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, stack: (e.stack ?? '').slice(0, 4000), context: { where, page: location.pathname + location.search, browser: navigator.userAgent, ...ctx } }),
    keepalive: true,
  }).catch(() => undefined);
}

/** Catches everything the game does not catch itself. */
export function installErrorReports() {
  if (import.meta.env.DEV) return; // during development errors show in the console
  window.addEventListener('error', (e) => reportError(e.error ?? e.message, 'error'));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'promise'));
}
