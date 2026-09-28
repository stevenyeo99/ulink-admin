import { useLocation } from 'react-router-dom';
import { LogOut, Menu } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { clearSession, getSession } from '../../lib/session';
import { NAV_SECTIONS } from './navigation';

function titleFor(pathname: string): string {
  if (/^\/cases\/[^/]+/.test(pathname)) return 'Case';
  const item = NAV_SECTIONS.flatMap((section) => section.items).find((i) => pathname.startsWith(i.to));
  return item?.label ?? 'ULINK Claims';
}

const ROLE_LABELS: Record<string, string> = { super_admin: 'Super admin' };

/** Top bar in the SB Admin pattern: the page's name, who is logged in and log out; the menu button on small screens. */
export function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const user = getSession()?.user;

  const logOut = () => {
    clearSession();
    queryClient.clear(); // nothing of this user's data stays in memory for the next one
    window.location.assign('/login');
  };

  return (
    <header className="flex items-center gap-3 border-b border-slate-900/5 bg-white/70 px-4 py-3 backdrop-blur-xl sm:px-6">
      <button
        onClick={onOpenMenu}
        className="rounded-md p-1.5 text-slate-600 hover:bg-slate-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ulink-teal/60 lg:hidden"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>
      <h1 className="text-[15px] font-semibold tracking-tight text-slate-900">{titleFor(pathname)}</h1>
      {user && (
        <div className="ml-auto flex items-center gap-3">
          <div className="text-right leading-tight">
            <p className="text-sm font-medium text-slate-800">{user.name || user.username}</p>
            <p className="text-xs text-slate-500">{ROLE_LABELS[user.role] ?? user.role}</p>
          </div>
          <button
            onClick={logOut}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-900/5 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ulink-teal/60"
          >
            <LogOut size={15} />
            Log out
          </button>
        </div>
      )}
    </header>
  );
}
