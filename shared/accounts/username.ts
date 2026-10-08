/** Usernames: shown to other players instead of real names. Checked on both client and server. */

export const USERNAME_RULES = '3–20 letters, numbers or underscores';

const RESERVED = ['admin', 'administrator', 'moderator', 'mod', 'warroom', 'system', 'server', 'support', 'staff', 'official', 'null', 'undefined'];

/** Why a username is not allowed, or null if it is fine (uniqueness is checked by the server). */
export function usernameError(name: string): string | null {
  const n = name.trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(n)) return `Use ${USERNAME_RULES}.`;
  if (/^_+$|^\d+$/.test(n)) return 'Use at least one letter.';
  if (RESERVED.includes(n.toLowerCase())) return 'That name is reserved.';
  return null;
}
