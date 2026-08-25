import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // This project lives under /mnt/c (a Windows-mounted path under WSL2), where native
    // filesystem watching (inotify) is unreliable — Vite's HMR would otherwise silently
    // stop picking up file changes (confirmed: a saved edit kept serving stale content
    // until the dev server was restarted). Polling is slightly more CPU cost but is the
    // standard, reliable fix for WSL2 + DrvFs paths.
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
});
