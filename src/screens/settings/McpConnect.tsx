import { Check, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useCopied } from "../../hooks/useCopied";
import {
  MCP_CLIENTS,
  TOKEN_PLACEHOLDER,
  mcpServerUrl,
  mcpSnippet,
  mcpSnippetPlace,
  type McpClient,
} from "../../lib/mcpConnect";

/**
 * "Connect an AI agent" (TAS-412): the Claude Code and Cursor snippets for
 * Taska's MCP server. Drawn twice — on the page, where the token is the
 * literal `YOUR_TOKEN`, and in the creating dialog right after a token was
 * issued, where it is that token's value. Nowhere else does a secret reach a
 * snippet, and it leaves with the dialog.
 *
 * The address comes from the build (`VITE_TASKA_MCP_URL`); without one there is
 * nothing to connect to, and the block says so in one line instead of offering
 * a snippet that points nowhere.
 */
export function McpConnect({ token, headingLevel }: { token: string | null; headingLevel: 2 | 3 }) {
  const url = mcpServerUrl();
  const [client, setClient] = useState<McpClient>("claude-code");
  const headingId = useId();
  const Heading = headingLevel === 2 ? "h2" : "h3";

  return (
    <section aria-labelledby={headingId} className="mcp-connect">
      <Heading className="mcp-connect-title" id={headingId}>
        Connect an AI agent
      </Heading>
      <p className="settings-lead">
        {token
          ? "Taska’s MCP server lets an agent read and change your issues with this token."
          : "Taska’s MCP server lets an agent read and change your issues with one of these tokens."}
      </p>
      {url ? (
        <>
          {/* §4.2 with `aria-pressed`, the product's segmented convention
              (TAS-299); pressing the chosen one does nothing. */}
          <div aria-label="Agent" className="segmented fit mcp-clients" role="group">
            {MCP_CLIENTS.map((option) => (
              <button
                aria-pressed={client === option.id}
                className={client === option.id ? "is-active" : ""}
                key={option.id}
                onClick={() => {
                  if (client !== option.id) setClient(option.id);
                }}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          {/* Keyed by the client, so a "Copied" said about one snippet is not
              left standing under the other. */}
          <McpSnippet client={client} key={client} text={mcpSnippet(client, url, token ?? TOKEN_PLACEHOLDER)} />
          <p className="mcp-note">Keep tokens out of project files that are shared or committed.</p>
        </>
      ) : (
        <p className="mcp-unavailable">The MCP server is not available yet.</p>
      )}
    </section>
  );
}

/**
 * One snippet: where it goes, the text in a mono block, and Copy with its
 * answer in a persistent polite region. The block wraps rather than scrolls —
 * a scroller would be a Tab stop of its own, and the copy is exact either way.
 * A refused clipboard selects the text, so the reader's own copy is one key
 * away (the honesty rule `useCopied` states).
 */
function McpSnippet({ client, text }: { client: McpClient; text: string }) {
  const [copyState, copy] = useCopied();
  const codeRef = useRef<HTMLPreElement>(null);
  const placeId = useId();
  const what = client === "claude-code" ? "command" : "configuration";

  useEffect(() => {
    if (copyState !== "failed" || !codeRef.current) return;
    window.getSelection()?.selectAllChildren(codeRef.current);
  }, [copyState]);

  const coarse = typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches ?? false);
  const status =
    copyState === "copied"
      ? client === "claude-code"
        ? "Command copied."
        : "Configuration copied."
      : copyState === "failed"
        ? coarse
          ? `Couldn’t copy the ${what} automatically. Touch and hold the text to copy it.`
          : `Couldn’t copy the ${what} automatically. It’s selected — press Ctrl+C or ⌘C to copy it.`
        : "";

  return (
    <div className="mcp-snippet-wrap">
      <p className="mcp-snippet-place" id={placeId}>
        {mcpSnippetPlace(client)}
      </p>
      <div className="mcp-snippet">
        <pre aria-describedby={placeId} className="mcp-snippet-code" ref={codeRef}>
          <code>{text}</code>
        </pre>
        <button
          aria-label={client === "claude-code" ? "Copy the Claude Code command" : "Copy the Cursor configuration"}
          className="secondary-button compact-button"
          onClick={() => copy(text)}
          type="button"
        >
          {copyState === "copied" ? <Check aria-hidden="true" size={13} /> : <Copy aria-hidden="true" size={13} />}
          Copy
        </button>
      </div>
      <p className="mcp-copy-status" data-outcome={copyState === "failed" ? "failed" : undefined} role="status">
        {status}
      </p>
    </div>
  );
}
