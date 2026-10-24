import { afterEach, describe, expect, it, vi } from "vitest";
import { TOKEN_PLACEHOLDER, mcpServerUrl, mcpSnippet } from "./mcpConnect";

afterEach(() => vi.unstubAllEnvs());

describe("the MCP connect snippets (TAS-412)", () => {
  const url = "https://mcp.taska.example/mcp";

  it("adds the server to Claude Code at user scope, with the token in the header", () => {
    expect(mcpSnippet("claude-code", url, "tsk_pat_secret")).toBe(
      'claude mcp add --transport http --scope user taska https://mcp.taska.example/mcp --header "Authorization: Bearer tsk_pat_secret"',
    );
  });

  it("writes Cursor's user-level mcp.json, pretty-printed", () => {
    const snippet = mcpSnippet("cursor", url, TOKEN_PLACEHOLDER);
    expect(JSON.parse(snippet)).toEqual({
      mcpServers: { taska: { url, headers: { Authorization: "Bearer YOUR_TOKEN" } } },
    });
    expect(snippet.split("\n")).toHaveLength(10);
  });

  it("takes the address from the build, and has none when it is unset or blank", () => {
    vi.stubEnv("VITE_TASKA_MCP_URL", " http://localhost:8087/mcp ");
    expect(mcpServerUrl()).toBe("http://localhost:8087/mcp");
    vi.stubEnv("VITE_TASKA_MCP_URL", "   ");
    expect(mcpServerUrl()).toBeNull();
    vi.stubEnv("VITE_TASKA_MCP_URL", "");
    expect(mcpServerUrl()).toBeNull();
  });
});
