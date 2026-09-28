import { useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { NAV_SECTIONS } from './navigation';

function titleFor(pathname: string): string {
  if (/^\/cases\/[^/]+/.test(pathname)) return 'Case';
  const item = NAV_SECTIONS.flatMap((section) => section.items).find((i) => pathname.startsWith(i.to));
  return item?.label ?? 'ULINK Claims';
}

/** Top bar in the SB Admin pattern: the current page's name, and the menu button on small screens. */
export function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { pathname } = useLocation();
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
    </header>
  );
}
