import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { Logo } from '../common/Logo';
import { NAV_SECTIONS } from './navigation';

interface SidebarProps {
  reviewCount?: number;
  /** Small screens: the sidebar is a drawer, open or closed. Always shown from lg up. */
  open: boolean;
  onClose: () => void;
}

const itemClass = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'group relative flex items-center gap-3 rounded-lg py-2 pl-4 pr-3 text-sm font-medium outline-none transition-colors',
    'focus-visible:ring-2 focus-visible:ring-ulink-teal/60',
    isActive ? 'bg-ulink-teal/10 text-ulink-teal-dark' : 'text-slate-600 hover:bg-slate-900/[0.04] hover:text-slate-900'
  );

/**
 * Left navigation in the SB Admin pattern: brand at the top, pages grouped by who uses them.
 * On small screens it slides in over the page (opened from the top bar's menu button).
 */
export function Sidebar({ reviewCount, open, onClose }: SidebarProps) {
  return (
    <>
      {open && <div aria-hidden className="fixed inset-0 z-30 bg-slate-900/20 lg:hidden" onClick={onClose} />}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-slate-900/5 bg-white/85 backdrop-blur-xl',
          'motion-safe:transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
        aria-label="Main navigation"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-4">
          <div className="flex items-center gap-2.5">
            <Logo size={32} />
            <div className="leading-tight">
              <p className="text-[14px] font-semibold tracking-tight text-slate-900">ULINK Claims</p>
              <p className="text-xs text-slate-500">Ulink Assist</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ulink-teal/60 lg:hidden"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6 pt-2">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title}>
              <p className="mb-1.5 px-4 text-xs font-medium text-slate-400">{section.title}</p>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.to}>
                    <NavLink to={item.to} className={itemClass} onClick={onClose}>
                      {({ isActive }) => (
                        <>
                          <span
                            aria-hidden
                            className={clsx('absolute inset-y-1.5 left-0 w-1 rounded-full', isActive ? 'bg-ulink-teal' : 'bg-transparent')}
                          />
                          <item.icon size={17} className={isActive ? 'text-ulink-teal-dark' : 'text-slate-400 group-hover:text-slate-600'} />
                          <span className="flex-1">{item.label}</span>
                          {item.showReviewCount && typeof reviewCount === 'number' && reviewCount > 0 && (
                            <span
                              className="rounded-full bg-ulink-orange px-1.5 py-0.5 text-[10px] font-semibold text-white"
                              aria-label={`${reviewCount} need review`}
                            >
                              {reviewCount}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
