/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The Taska MCP server's address, for the connect snippets in Settings →
   * Access tokens (TAS-412). Build-time and public — it is printed on the page.
   * Unset or empty: the page says the MCP server is not available yet.
   */
  readonly VITE_TASKA_MCP_URL?: string;
  /**
   * `"true"` builds companies and per-tab company sessions on the B2B
   * blueprint (TAS-500); anything else is today's build. Read only by
   * `src/lib/tenancy.ts`.
   */
  readonly VITE_TASKA_TENANTS?: string;
}
