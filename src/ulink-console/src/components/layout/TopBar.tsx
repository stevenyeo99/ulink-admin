import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Menu, Search } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { clearSession, getSession } from '../../lib/session';
import { listCases } from '../../api/casesApi';
import { NAV_SECTIONS } from './navigation';

function titleFor(pathname: string): string {
  if (/^\/cases\/[^/]+/.test(pathname)) return 'Case';
  const item = NAV_SECTIONS.flatMap((section) => section.items).find((i) => pathname.startsWith(i.to));
  return item?.label ?? 'ULINK Claims';
}

const ROLE_LABELS: Record<string, string> = { super_admin: 'Super admin' };

/**
 * Search from any page (SYSTEM_4 E4-22): claim no., TPA case no., claimant name, NRC or case ID, Email and API cases
 * alike. One match opens the case; otherwise the Cases list, on the tab of the first match.
 */
function CaseSearch() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      const { cases, total } = await listCases({ q, limit: 1 });
      if (total === 1) navigate(`/cases/${cases[0].id}`);
      else navigate(`/cases?${new URLSearchParams({ q, ...(cases[0]?.source === 'API' ? { source: 'api' } : {}) })}`);
      setText('');
    } catch {
      navigate(`/cases?${new URLSearchParams({ q })}`); // the list page shows the error
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} role="search" className="relative ml-auto hidden w-full max-w-xs sm:block">
      <label htmlFor="case-search" className="sr-only">Search cases</label>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        id="case-search"
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Claim no., TPA case no., name, NRC"
        aria-busy={busy}
        className="w-full rounded-full border border-slate-900/10 bg-white/80 py-1.5 pl-9 pr-4 text-sm text-slate-800 placeholder:text-slate-400 focus:border-ulink-teal focus:outline-none focus:ring-2 focus:ring-ulink-teal/30"
      />
    </form>
  );
}

/** Top bar in the SB Admin pattern: the page's name, case search, who is logged in and log out; the menu button on small screens. */
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
      <CaseSearch />
      {user && (
        <div className="ml-auto flex items-center gap-3 sm:ml-0">
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
