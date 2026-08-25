import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { Logo } from '../common/Logo';

interface AppNavProps {
  reviewCount?: number;
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
    isActive ? 'bg-white text-slate-900 shadow-glass' : 'text-slate-500 hover:text-slate-800'
  );

/**
 * Persistent top strip — brand identity + page navigation. Deliberately owns nothing about
 * either page's own controls (Run Automation, Refresh, etc.) — each page renders its own
 * toolbar underneath this instead, since Pipeline and Cases need different actions.
 */
export function AppNav({ reviewCount }: AppNavProps) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-slate-900/5 bg-white/70 px-6 py-3.5 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <Logo size={34} />
        <div className="leading-tight">
          <p className="text-[15px] font-semibold tracking-tight text-slate-900">ULINK Claim Automation</p>
          <p className="text-xs text-slate-500">Ulink Assist</p>
        </div>
      </div>

      <nav className="flex items-center gap-1 rounded-full bg-slate-100/80 p-1">
        <NavLink to="/" end className={linkClass}>
          Pipeline
        </NavLink>
        <NavLink to="/cases" className={linkClass}>
          Cases
          {typeof reviewCount === 'number' && reviewCount > 0 && (
            <span className="ml-1.5 rounded-full bg-ulink-orange px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {reviewCount}
            </span>
          )}
        </NavLink>
      </nav>
    </header>
  );
}
