import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useCopied } from "../../hooks/useCopied";
import {
  CHATGPT_MCP_HELP_URL,
  CLAUDE_CONNECTOR_HELP_URL,
  CURSOR_MCP_HELP_URL,
  MCP_CLIENTS,
  OAUTH_APPS,
  TOKEN_PLACEHOLDER,
  cursorOAuthSnippet,
  mcpServerUrl,
  mcpSnippet,
  mcpSnippetPlace,
  type McpClient,
  type OAuthApp,
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
 * "Connect an AI app" (TAS-414), under Settings → Connected apps' list: how an
 * app comes to be in that list. Claude, ChatGPT and Cursor add Taska's MCP
 * server and connect through Taska's own sign-in and consent — no token
 * changes hands, which is why Claude Code and scripts, which do take one, are
 * sent on to Access tokens (TAS-412) in the last line.
 *
 * One app's steps at a time, chosen as "Connect an AI agent" chooses its
 * snippet. The steps say the intended path and nothing else (AGENTS.md, no
 * compensations for the backend). Without a server address there is nothing
 * to connect to, and everything under the lead is one line.
 */
export function ConnectAiApp() {
  const url = mcpServerUrl();
  const [app, setApp] = useState<OAuthApp>("claude");
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="mcp-connect">
      <h2 className="mcp-connect-title" id={headingId}>
        Connect an AI app
      </h2>
      <p className="settings-lead">
        Claude, ChatGPT and Cursor can work in Taska as you through Taska’s MCP server. You sign in to Taska and choose
        what to allow, and the app then appears in this list.
      </p>
      {url ? (
        <>
          {/* §4.2 with `aria-pressed`, as "Connect an AI agent" picks its
              agent (TAS-299); pressing the chosen one does nothing. */}
          <div aria-label="App" className="segmented fit mcp-clients" role="group">
            {OAUTH_APPS.map((option) => (
              <button
                aria-pressed={app === option.id}
                className={app === option.id ? "is-active" : ""}
                key={option.id}
                onClick={() => {
                  if (app !== option.id) setApp(option.id);
                }}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          {/* Keyed by the app, so a "Copied" said under one app's steps is not
              left standing under another's. */}
          <AppSteps app={app} key={app} url={url} />
          <p className="mcp-note">
            For Claude Code or a script,{" "}
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

/** One app's numbered steps, from opening its MCP settings to Taska's consent. */
function AppSteps({ app, url }: { app: OAuthApp; url: string }) {
  const placeId = useId();

  if (app === "claude") {
    return (
      <ol className="mcp-steps">
        <li>
          <p className="mcp-step-text">In Claude, open Customize → Connectors, choose Add, then Add custom connector.</p>
          <HelpLink href={CLAUDE_CONNECTOR_HELP_URL}>How to add a custom connector</HelpLink>
        </li>
        <li>
          <div className="mcp-snippet-wrap">
            <p className="mcp-step-text" id={placeId}>
              Name it Taska and paste this server address:
            </p>
            <McpCopyBox describedBy={placeId} label="Copy the server address" text={url} what="address" />
          </div>
        </li>
        <li>
          <p className="mcp-step-text">Choose Connect, sign in to Taska and allow access.</p>
        </li>
      </ol>
    );
  }

  if (app === "chatgpt") {
    return (
      <ol className="mcp-steps">
        <li>
          <p className="mcp-step-text">In ChatGPT, open Plugins, choose Add, then Add custom MCP server.</p>
          <HelpLink href={CHATGPT_MCP_HELP_URL}>How to add a custom MCP server</HelpLink>
        </li>
        <li>
          <div className="mcp-snippet-wrap">
            <p className="mcp-step-text" id={placeId}>
              Name it Taska, choose Public endpoint and paste this server address:
            </p>
            <McpCopyBox describedBy={placeId} label="Copy the server address" text={url} what="address" />
          </div>
        </li>
        <li>
          <p className="mcp-step-text">
            Set authentication to OAuth and create the plugin, then sign in to Taska and allow access.
          </p>
        </li>
      </ol>
    );
  }

  return (
    <ol className="mcp-steps">
      <li>
        <div className="mcp-snippet-wrap">
          <p className="mcp-step-text" id={placeId}>
            Add this to ~/.cursor/mcp.json:
          </p>
          <McpCopyBox
            describedBy={placeId}
            label="Copy the Cursor configuration"
            text={cursorOAuthSnippet(url)}
            what="configuration"
          />
        </div>
        <HelpLink href={CURSOR_MCP_HELP_URL}>Cursor’s MCP guide</HelpLink>
      </li>
      <li>
        <p className="mcp-step-text">
          Open Cursor’s MCP settings, sign in next to Taska, then sign in to Taska and allow access.
        </p>
      </li>
    </ol>
  );
}

/**
 * The app maker's own guide, on a line of its own under a step. Away from
 * Taska the way Settings already leaves it ("Open Telegram bot", §5.9): a new
 * tab, `ExternalLink` after the words.
 */
function HelpLink({ href, children }: { href: string; children: string }) {
  return (
    <a className="admin-note-link mcp-help-link" href={href} rel="noopener noreferrer" target="_blank">
      {children}
      <ExternalLink aria-hidden="true" size={13} strokeWidth={1.5} />
    </a>
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
