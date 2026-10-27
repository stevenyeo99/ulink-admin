import { forwardRef, type ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost';
  /** sm: a review action on one finding (SYSTEM_5 review actions): smaller, but still a clear button. */
  size?: 'md' | 'sm';
}

// forwardRef is required here, not stylistic — Radix's `asChild` pattern (AlertDialog.Trigger,
// Dialog.Close, etc.) clones this element and attaches its own ref to it for focus
// management; a plain function component drops that ref and React warns at runtime
// ("Function components cannot be given refs"). Confirmed via that exact warning when this
// was first wired into CaseDetailPage.tsx's AlertDialog.
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      className={clsx(
        'inline-flex items-center rounded-full font-semibold transition-all duration-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60',
        size === 'md' ? 'gap-2 px-5 py-2.5 text-sm' : 'gap-1.5 px-3.5 py-1.5 text-[13px]',
        variant === 'primary' &&
          'bg-gradient-to-r from-ulink-orange to-ulink-orange-light text-white shadow-node hover:shadow-glow-orange',
        variant === 'ghost' && 'bg-white/70 text-slate-700 shadow-glass hover:bg-white',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
