import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useCopied } from "../../hooks/useCopied";
import {
  CLAUDE_CONNECTOR_HELP_URL,
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
 *
 * `onSecretCopied` hears a snippet copy that reached the clipboard while the
 * snippet carried a real value — never the page's `YOUR_TOKEN` — so the
 * dialog knows the value is saved somewhere and stops holding `Esc` (§5.9).
 */
export function McpConnect({
  token,
  headingLevel,
  onSecretCopied,
}: {
  token: string | null;
  headingLevel: 2 | 3;
  onSecretCopied?: () => void;
}) {
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
          <McpSnippet
            client={client}
            key={client}
            onCopied={token ? onSecretCopied : undefined}
            text={mcpSnippet(client, url, token ?? TOKEN_PLACEHOLDER)}
          />
          <p className="mcp-note">Keep tokens out of project files that are shared or committed.</p>
        </>
      ) : (
        <p className="mcp-unavailable">The MCP server is not available yet.</p>
      )}
    </section>
  );
}

/**
 * "Connect Claude" (TAS-414), under Settings → Connected apps' list: how an app
 * comes to be in that list. claude.ai adds Taska's MCP server as a custom
 * connector, and connecting it is Taska's own sign-in and consent — no token
 * changes hands, which is why the agents that do take one are sent on to
 * Access tokens (TAS-412) in the last line.
 *
 * Only Claude is named: its return address is the one the OAuth server lets
 * through. The steps say the intended path and nothing else (AGENTS.md, no
 * compensations for the backend). Without a server address there is nothing
 * to connect to, and everything under the lead is one line, as in
 * "Connect an AI agent".
 */
export function ConnectClaude() {
  const url = mcpServerUrl();
  const headingId = useId();
  const addressId = useId();

  return (
    <section aria-labelledby={headingId} className="mcp-connect">
      <h2 className="mcp-connect-title" id={headingId}>
        Connect Claude
      </h2>
      <p className="settings-lead">
        Claude can work in Taska as you through Taska’s MCP server. You sign in to Taska and choose what to allow, and
        Claude then appears in this list.
      </p>
      {url ? (
        <>
          <ol className="mcp-steps">
            <li>
              <p className="mcp-step-text">
                In Claude, open Customize → Connectors, choose Add, then Add custom connector.
              </p>
              {/* Away from Taska the way Settings already leaves it ("Open
                  Telegram bot", §5.9): a new tab, `ExternalLink` after the words. */}
              <a
                className="admin-note-link mcp-help-link"
                href={CLAUDE_CONNECTOR_HELP_URL}
                rel="noopener noreferrer"
                target="_blank"
              >
                How to add a custom connector
                <ExternalLink aria-hidden="true" size={13} strokeWidth={1.5} />
              </a>
            </li>
            <li>
              <div className="mcp-snippet-wrap">
                <p className="mcp-step-text" id={addressId}>
                  Name it Taska and paste this server address:
                </p>
                <McpCopyBox describedBy={addressId} label="Copy the server address" text={url} what="address" />
              </div>
            </li>
            <li>
              <p className="mcp-step-text">Choose Connect, sign in to Taska and allow access.</p>
            </li>
          </ol>
          <p className="mcp-note">
            For Claude Code, Cursor or a script,{" "}
            <Link className="admin-note-link" to="/settings/tokens">
              create an access token
            </Link>{" "}
            instead.
          </p>
        </>
      ) : (
        <p className="mcp-unavailable">The MCP server is not available yet.</p>
      )}
    </section>
  );
}

/** One snippet: where it goes, said above it, and the text with its Copy. */
function McpSnippet({ client, text, onCopied }: { client: McpClient; text: string; onCopied?: () => void }) {
  const placeId = useId();

  return (
    <div className="mcp-snippet-wrap">
      <p className="mcp-snippet-place" id={placeId}>
        {mcpSnippetPlace(client)}
      </p>
      <McpCopyBox
        describedBy={placeId}
        label={client === "claude-code" ? "Copy the Claude Code command" : "Copy the Cursor configuration"}
        onCopied={onCopied}
        text={text}
        what={client === "claude-code" ? "command" : "configuration"}
      />
    </div>
  );
}

type CopiedText = "command" | "configuration" | "address";

const COPIED: Record<CopiedText, string> = {
  command: "Command copied.",
  configuration: "Configuration copied.",
  address: "Address copied.",
};

/**
 * The text in a mono block, and Copy with its answer in a persistent polite
 * region. The block wraps rather than scrolls — a scroller would be a Tab stop
 * of its own, and the copy is exact either way. A refused clipboard selects
 * the text, so the reader's own copy is one key away (the honesty rule
 * `useCopied` states).
 *
 * A fragment, drawn inside the caller's `.mcp-snippet-wrap` under the line
 * that says where the text goes; `describedBy` is that line's id.
 */
function McpCopyBox({
  text,
  what,
  label,
  describedBy,
  onCopied,
}: {
  text: string;
  what: CopiedText;
  label: string;
  describedBy: string;
  onCopied?: () => void;
}) {
  const [copyState, copy] = useCopied(onCopied);
  const codeRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (copyState !== "failed" || !codeRef.current) return;
    window.getSelection()?.selectAllChildren(codeRef.current);
  }, [copyState]);

  const coarse = typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches ?? false);
  const status =
    copyState === "copied"
      ? COPIED[what]
      : copyState === "failed"
        ? coarse
          ? `Couldn’t copy the ${what} automatically. Touch and hold the text to copy it.`
          : `Couldn’t copy the ${what} automatically. It’s selected — press Ctrl+C or ⌘C to copy it.`
        : "";

  return (
    <>
      <div className="mcp-snippet">
        <pre aria-describedby={describedBy} className="mcp-snippet-code" ref={codeRef}>
          <code>{text}</code>
        </pre>
        <button aria-label={label} className="secondary-button compact-button" onClick={() => copy(text)} type="button">
          {copyState === "copied" ? <Check aria-hidden="true" size={13} /> : <Copy aria-hidden="true" size={13} />}
          Copy
        </button>
      </div>
      <p className="mcp-copy-status" data-outcome={copyState === "failed" ? "failed" : undefined} role="status">
        {status}
      </p>
    </>
  );
}
