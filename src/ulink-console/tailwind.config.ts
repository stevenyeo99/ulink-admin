import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ulink: {
          teal: '#2FBFCC',
          'teal-light': '#8AD3D9',
          'teal-dark': '#1D8E98',
          orange: '#F36D21',
          'orange-light': '#FBB05D',
          'orange-dark': '#C94F13',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"SF Pro Display"',
          '"Segoe UI"',
          'Inter',
          'sans-serif',
        ],
      },
      boxShadow: {
        glass: '0 1px 2px rgba(15, 23, 42, 0.04), 0 12px 32px -12px rgba(15, 23, 42, 0.12)',
        node: '0 1px 3px rgba(15, 23, 42, 0.06), 0 6px 16px -6px rgba(15, 23, 42, 0.10)',
        'glow-orange': '0 0 0 4px rgba(243, 109, 33, 0.14), 0 0 24px rgba(243, 109, 33, 0.35)',
        'glow-teal': '0 0 0 4px rgba(47, 191, 204, 0.14), 0 0 24px rgba(47, 191, 204, 0.25)',
      },
      borderRadius: {
        xl2: '1.25rem',
      },
      keyframes: {
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 0 4px rgba(243, 109, 33, 0.14), 0 0 18px rgba(243, 109, 33, 0.30)' },
          '50%': { boxShadow: '0 0 0 7px rgba(243, 109, 33, 0.10), 0 0 30px rgba(243, 109, 33, 0.45)' },
        },
      },
      animation: {
        'pulse-glow': 'pulseGlow 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
