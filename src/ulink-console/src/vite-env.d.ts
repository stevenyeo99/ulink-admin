/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  /** "false" hides the case page's admin actions (reset / override). On by default until login + roles exist. */
  readonly VITE_ADMIN_TOOLS?: string;
}
