// The logged-in console user, kept in localStorage: shared by every tab, so a case link from an email
// opens without a new login (SYSTEM_6 item 1, replaces the 2026-09-28 sessionStorage decision). The
// token itself expires after 8 hours on the server.

export interface SessionUser {
  id: string;
  username: string;
  name: string | null;
  role: string;
}

interface Session {
  token: string;
  user: SessionUser;
}

const KEY = 'ulink-console-session';

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Storage blocked (private mode etc.): the user stays logged in until the page reloads.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored to clear.
  }
}

/** Back to the login page, returning here afterwards. */
export function goToLogin(): void {
  clearSession();
  const next = window.location.pathname + window.location.search;
  window.location.assign(`/login${next && next !== '/login' ? `?next=${encodeURIComponent(next)}` : ''}`);
}

/** Admin-only screens and actions (reset, override) — super admins, the only role so far. */
export function isSuperAdmin(): boolean {
  return getSession()?.user.role === 'super_admin';
}
