/**
 * The "Connect an AI agent" snippets of Settings → Access tokens (TAS-412):
 * what a reader pastes into Claude Code or Cursor to reach Taska's MCP server
 * (TAS-403) as themselves.
 *
 * Both use the agent's **user-level** configuration — Claude Code's
 * `--scope user`, Cursor's `~/.cursor/mcp.json` — and never a project file:
 * a token in a file that is shared or committed is a token given away.
 */

/** What stands where the token goes when the page has no fresh one to put there. */
export const TOKEN_PLACEHOLDER = "YOUR_TOKEN";

export type McpClient = "claude-code" | "cursor";

export const MCP_CLIENTS: readonly { id: McpClient; label: string }[] = [
  { id: "claude-code", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
];

/**
 * The MCP server's address from the build (`VITE_TASKA_MCP_URL`), or `null`
 * when the build has none — then there is nothing to connect to and no snippet
 * is offered. Read at call time rather than once at import, so a test can set
 * it per case.
 */
export function mcpServerUrl(): string | null {
  const value = import.meta.env.VITE_TASKA_MCP_URL;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The snippet for one client, with `token` — a fresh secret, or `TOKEN_PLACEHOLDER`. */
export function mcpSnippet(client: McpClient, url: string, token: string): string {
  if (client === "claude-code") {
    return `claude mcp add --transport http --scope user taska ${url} --header "Authorization: Bearer ${token}"`;
  }
  return JSON.stringify({ mcpServers: { taska: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
}

/** Where the snippet goes, said above it. */
export function mcpSnippetPlace(client: McpClient): string {
  return client === "claude-code" ? "Run this in a terminal." : "Add this to ~/.cursor/mcp.json.";
}
