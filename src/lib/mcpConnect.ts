/**
 * The "Connect an AI agent" snippets of Settings → Access tokens (TAS-412):
 * what a reader pastes into Claude Code or Cursor to reach Taska's MCP server
 * (TAS-403) as themselves.
 *
 * Both use the agent's **user-level** configuration — Claude Code's
 * `--scope user`, Cursor's `~/.cursor/mcp.json` — and never a project file:
 * a token in a file that is shared or committed is a token given away.
 *
 * Settings → Connected apps' "Connect an AI app" (TAS-414) reads the same
 * address for the apps that sign in through OAuth instead — Claude, ChatGPT
 * and Cursor — and no token is involved there.
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

/** Cursor's user-level `~/.cursor/mcp.json` with Taska's one entry, pretty-printed. */
function cursorConfig(server: { url: string; headers?: Record<string, string> }): string {
  return JSON.stringify({ mcpServers: { taska: server } }, null, 2);
}

/** The snippet for one client, with `token` — a fresh secret, or `TOKEN_PLACEHOLDER`. */
export function mcpSnippet(client: McpClient, url: string, token: string): string {
  if (client === "claude-code") {
    return `claude mcp add --transport http --scope user taska ${url} --header "Authorization: Bearer ${token}"`;
  }
  return cursorConfig({ url, headers: { Authorization: `Bearer ${token}` } });
}

/** Where the snippet goes, said above it. */
export function mcpSnippetPlace(client: McpClient): string {
  return client === "claude-code" ? "Run this in a terminal." : "Add this to ~/.cursor/mcp.json.";
}

/**
 * Cursor's entry for signing in by OAuth (TAS-414): the address alone. A remote
 * entry with no headers makes Cursor register itself and ask Taska to sign in
 * (cursor.com/docs/mcp), so no token is written anywhere.
 */
export function cursorOAuthSnippet(url: string): string {
  return cursorConfig({ url });
}

/** The apps "Connect an AI app" walks through, in the order its picker shows them. */
export type OAuthApp = "claude" | "chatgpt" | "cursor";

export const OAUTH_APPS: readonly { id: OAuthApp; label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "cursor", label: "Cursor" },
];

/*
 * Each app's own guide, linked from its steps in "Connect an AI app"
 * (TAS-414): an app's screens are its maker's to describe, so the steps name
 * one path through them and point here for the rest.
 */
export const CLAUDE_CONNECTOR_HELP_URL =
  "https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp";
export const CHATGPT_MCP_HELP_URL = "https://developers.openai.com/plugins/deploy/connect-chatgpt";
export const CURSOR_MCP_HELP_URL = "https://cursor.com/docs/mcp";
