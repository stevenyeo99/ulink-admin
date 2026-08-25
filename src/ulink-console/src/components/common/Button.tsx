import type { ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost';
}

export function Button({ variant = 'primary', className, children, ...rest }: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all duration-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60',
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
}
