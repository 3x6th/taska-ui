import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  ACCESS_TOKEN_EXPIRY_DAYS,
  ACCESS_TOKEN_NAME_MAX_LENGTH,
  DEFAULT_ACCESS_TOKEN_EXPIRY_DAYS,
  type AccessTokenExpiryDays,
  type AccessTokenScopes,
} from "../../api/accessTokens";
import { taskaApi } from "../../api/client";
import { apiErrorFacts, isUndeployedRoute } from "../../api/errors";
import { UNDEPLOYED_ROUTE_MESSAGE } from "../../api/TaskaApi";
import { ApiNotice } from "../../components/ApiNotice";
import { ErrorNote } from "../../components/ErrorNote";
import { Modal } from "../../components/Modal";
import type { AccessToken, IssuedAccessToken } from "../../domain/types";
import { useCopied } from "../../hooks/useCopied";
import { ME_QUERY_KEY } from "../../lib/ownAvatarLink";
import { accessTokensKey, accessTokensOptions } from "./accessTokensQuery";
import {
  accessTokenAccessLabel,
  accessTokenDatesText,
  accessTokenExpiryText,
  createRefusalText,
  expiryDayFromNow,
  expiryLabel,
  revokeRefusalWords,
  sortAccessTokens,
} from "./accessTokenText";
import { McpConnect } from "./McpConnect";

type Access = "read" | "read-write";

/** A token's name, or what stands for one the answer left blank. */
const tokenLabel = (token: Pick<AccessToken, "name">) => token.name || "Unnamed token";

const ACCESS_OPTIONS: readonly { value: Access; label: string; description: string; scopes: AccessTokenScopes }[] = [
  { value: "read", label: "Read", description: "See projects, issues, comments and work logs.", scopes: ["read"] },
  {
    value: "read-write",
    label: "Read and write",
    description: "Also create and change issues, comment, move issues through the workflow and log time.",
    scopes: ["read", "write"],
  },
];

/**
 * Settings → Access tokens (TAS-412, epic TAS-399): the reader's personal
 * access tokens, for an AI agent or a script to work in Taska as them — the
 * list, creating one (its value shown once), revoking one, and the snippets
 * that connect Claude Code or Cursor to Taska's MCP server.
 *
 * No role gate: these are the reader's own tokens, and a `VIEWER` owns theirs
 * as an `ADMIN` does. The server stays the authority on what a token may do.
 *
 * **The secret.** Creating a token is the one answer in the product that must
 * not outlive the moment it is shown. So the create call is not a
 * `useMutation` — whose result would stay in the mutation cache after the
 * dialog closed — but a plain call whose answer lives only in the dialog's own
 * state; the list is re-read afterwards and carries no value. Closing the
 * dialog, by Done, ✕, `Esc` or the scrim, unmounts that state with it: no
 * cache, no browser storage, no address, no log, no node left in the page.
 *
 * Ships ahead of the gateway, against the mock (AGENTS.md): no gateway serves
 * these routes yet, and there every one answers the static-resource 404, which
 * this section states in one line with nothing to create.
 */
export function SettingsTokensSection() {
  const meQuery = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => taskaApi.getCurrentUser(),
  });
  const user = meQuery.data;
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="settings-plane">
        <div className="settings-column">
          <p className="settings-lead">
            Tokens let an AI agent or a script work in Taska as you. A token never has more access than you do and
            cannot open the admin console.
          </p>
          {user ? (
            // Keyed by account: one account's tokens are never drawn under another's.
            <AccessTokens key={user.id} onCreate={() => setCreating(true)} userId={user.id} />
          ) : meQuery.isError ? (
            <ReadFailure error={meQuery.error} onRetry={() => void meQuery.refetch()} retrying={meQuery.isFetching} />
          ) : (
            <TokensLoading />
          )}
          <hr className="settings-divider" />
          <McpConnect headingLevel={2} token={null} />
        </div>
      </div>
      {/* Beside the plane, not inside it, as the admin sections mount theirs:
          inside the plane's scroller a wheel over the scrim scrolled the page
          behind the dialog. */}
      {creating && user ? <CreateTokenModal onClose={() => setCreating(false)} userId={user.id} /> : null}
    </>
  );
}

function TokensLoading() {
  return (
    <div aria-busy="true" className="token-list-loading">
      <span className="visually-hidden" role="status">
        Loading access tokens
      </span>
      {[0, 1].map((row) => (
        <div aria-hidden="true" className="token-skeleton-row" key={row}>
          <span className="value-skeleton token-skeleton-name" />
          <span className="value-skeleton token-skeleton-meta" />
        </div>
      ))}
    </div>
  );
}

/** A first read that failed: a state found on arrival, so not announced (§5.6). */
function ReadFailure({ error, retrying, onRetry }: { error: unknown; retrying: boolean; onRetry: () => void }) {
  return (
    <div className="token-read-failure">
      <ApiNotice error={error} live="off">
        Your access tokens could not be loaded.
      </ApiNotice>
      <button
        aria-disabled={retrying || undefined}
        className="secondary-button"
        onClick={() => {
          if (!retrying) onRetry();
        }}
        type="button"
      >
        Try again
      </button>
    </div>
  );
}

/** The list and its revoke, for one account; creating is the dialog's, opened from here. */
function AccessTokens({ userId, onCreate }: { userId: string; onCreate: () => void }) {
  const queryClient = useQueryClient();
  const read = accessTokensOptions(userId);
  const query = useQuery(read);
  const undeployed = query.isError && isUndeployedRoute(query.error, UNDEPLOYED_ROUTE_MESSAGE);
  const tokens = useMemo(() => sortAccessTokens(query.data ?? []), [query.data]);
  const confirmPrefix = useId();

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  /** A revoke the server refused, by token: the note under the row that came back. */
  const [refusals, setRefusals] = useState<Readonly<Record<string, unknown>>>({});
  /** The last revoke's sentence, for the section's one persistent status region (§5.6). */
  const [said, setSaid] = useState<{ text: string; seq: number } | null>(null);
  const say = (text: string) => setSaid((current) => ({ text, seq: (current?.seq ?? 0) + 1 }));

  /**
   * Where focus goes after the next render: back to a row's Revoke once its
   * question closes, to the Revoke of the row that took a revoked one's place
   * (else the one before it, else Create token) — the order §4.11 gives a
   * project card that leaves `/projects`.
   */
  const createButton = useRef<HTMLButtonElement>(null);
  const revokeButtons = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    (target === "create" ? createButton.current : revokeButtons.current.get(target))?.focus();
  });

  const revokeKey = ["access-tokens", "revoke", userId] as const;
  const revoke = useMutation({
    mutationKey: revokeKey,
    mutationFn: (token: AccessToken) => taskaApi.revokeAccessToken(token.id),
    // Optimistic: the row leaves at once (§1, §5.6).
    onMutate: async (token) => {
      await queryClient.cancelQueries({ queryKey: read.queryKey });
      queryClient.setQueryData<AccessToken[]>(read.queryKey, (current) =>
        current?.filter((item) => item.id !== token.id),
      );
    },
    // And comes back on a refusal, with a note under it. Only this row: another
    // revoke still out keeps its own row gone.
    onError: (error, token) => {
      queryClient.setQueryData<AccessToken[]>(read.queryKey, (current) =>
        current && !current.some((item) => item.id === token.id) ? [...current, token] : current,
      );
      setRefusals((current) => ({ ...current, [token.id]: error }));
      say(`The token “${tokenLabel(token)}” was not revoked.`);
    },
    onSuccess: (_answer, token) => say(`The token “${tokenLabel(token)}” was revoked.`),
    // A re-read landing between two revokes would put the second one's row back.
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: revokeKey }) > 1) return;
      void queryClient.invalidateQueries({ queryKey: read.queryKey });
    },
  });

  const forget = (tokenId: string) =>
    setRefusals((current) => {
      if (!(tokenId in current)) return current;
      const next = { ...current };
      delete next[tokenId];
      return next;
    });
  const openConfirm = (token: AccessToken) => {
    forget(token.id);
    setConfirmingId((current) => (current === token.id ? null : token.id));
  };
  const cancelConfirm = (tokenId: string) => {
    setConfirmingId(null);
    pendingFocus.current = tokenId;
  };
  const acceptConfirm = (token: AccessToken) => {
    const index = tokens.findIndex((item) => item.id === token.id);
    const next = tokens[index + 1] ?? tokens[index - 1];
    pendingFocus.current = next ? next.id : "create";
    setConfirmingId(null);
    forget(token.id);
    revoke.mutate(token);
  };

  if (undeployed) {
    // Not an error and not an empty list: the gateway has no token routes yet
    // (TAS-402), so there is nothing to show and nothing to create.
    return <p className="tokens-unavailable">Access tokens are not on this gateway yet, so they cannot be shown here.</p>;
  }
  if (query.isPending) return <TokensLoading />;

  return (
    <>
      <div className="tokens-actions">
        <button className="primary-button" onClick={onCreate} ref={createButton} type="button">
          Create token
        </button>
      </div>

      {query.isError && !query.data ? (
        <ReadFailure error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : null}
      {query.isError && query.data ? (
        <div className="token-read-failure">
          <ApiNotice error={query.error} live="off">
            Your access tokens could not be refreshed. The last loaded tokens are shown.
          </ApiNotice>
        </div>
      ) : null}

      {query.data && tokens.length === 0 ? <p className="tokens-empty">No tokens yet.</p> : null}
      {tokens.length ? (
        <ul aria-label="Your access tokens" className="token-list">
          {tokens.map((token) => (
            <TokenRow
              confirmId={`${confirmPrefix}-${token.id}`}
              confirming={confirmingId === token.id}
              key={token.id}
              onAccept={() => acceptConfirm(token)}
              onCancel={() => cancelConfirm(token.id)}
              onOpen={() => openConfirm(token)}
              refusal={refusals[token.id]}
              registerRevoke={(node) => {
                if (node) revokeButtons.current.set(token.id, node);
                else revokeButtons.current.delete(token.id);
              }}
              token={token}
            />
          ))}
        </ul>
      ) : null}

      {/* Mounted for as long as the section is, so a screen reader is already
          watching it when a revoke answers; keyed by its sentence's number, so
          the same sentence twice is said twice (§5.6). */}
      <div className="visually-hidden" role="status">
        {said ? <span key={said.seq}>{said.text}</span> : null}
      </div>

    </>
  );
}

function TokenRow({
  token,
  confirming,
  confirmId,
  refusal,
  registerRevoke,
  onOpen,
  onCancel,
  onAccept,
}: {
  token: AccessToken;
  confirming: boolean;
  confirmId: string;
  refusal: unknown;
  registerRevoke: (node: HTMLButtonElement | null) => void;
  onOpen: () => void;
  onCancel: () => void;
  onAccept: () => void;
}) {
  const name = tokenLabel(token);
  const facts = refusal ? apiErrorFacts(refusal) : null;

  return (
    <li
      className="token-row"
      // Esc closes the open question from anywhere in the row — its two
      // answers and the Revoke that asked (§4.22).
      onKeyDown={(event: KeyboardEvent) => {
        if (confirming && event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="token-row-text">
        <p className="token-name">{name}</p>
        <p className="token-meta">
          {token.tokenPrefix ? (
            <>
              <span className="visually-hidden">Starts with </span>
              <span className="token-prefix">{token.tokenPrefix}…</span>
              <span aria-hidden="true"> · </span>
            </>
          ) : null}
          {accessTokenAccessLabel(token.scopes)}
        </p>
        <p className="token-dates">{accessTokenDatesText(token)}</p>
      </div>
      <button
        aria-controls={confirming ? confirmId : undefined}
        aria-expanded={confirming}
        aria-label={`Revoke ${name}`}
        className="token-revoke"
        onClick={onOpen}
        ref={registerRevoke}
        type="button"
      >
        Revoke
      </button>
      {confirming ? (
        // §4.22's inline confirmation, the one recipe for a destructive action
        // in a row: the sentence, Cancel first and focused, and the answer
        // edged in `--danger`.
        <div className="member-confirm token-confirm" id={confirmId}>
          <p className="member-confirm-sentence" id={`${confirmId}-sentence`}>
            The token “{name}” will stop working at once for every agent and script that uses it.
          </p>
          <div className="member-confirm-actions">
            <button autoFocus className="secondary-button compact-button" onClick={onCancel} type="button">
              Cancel
            </button>
            <button
              aria-describedby={`${confirmId}-sentence`}
              className="secondary-button compact-button member-confirm-accept"
              onClick={onAccept}
              type="button"
            >
              Revoke token
            </button>
          </div>
        </div>
      ) : null}
      {facts ? (
        <ErrorNote requestId={facts.requestId} serverWords={revokeRefusalWords(refusal)}>
          The token “{name}” was not revoked.
        </ErrorNote>
      ) : null}
    </li>
  );
}

/**
 * The creating dialog (§4.11), and after a success the same dialog showing the
 * token's value once. Its title changes and takes focus; the value, the copy
 * control and the snippets carrying it live only in this component's state,
 * which goes when the dialog closes — there is no way back to it.
 */
function CreateTokenModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [name, setName] = useState("");
  const [access, setAccess] = useState<Access>("read");
  const [days, setDays] = useState<AccessTokenExpiryDays>(DEFAULT_ACCESS_TOKEN_EXPIRY_DAYS);
  const [attempted, setAttempted] = useState(false);
  const [sending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<unknown>(null);
  const [issued, setIssued] = useState<IssuedAccessToken | null>(null);
  const sendingRef = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // The form became the token's one showing: the new title takes the focus
  // the submit button had, and is what a screen reader says first.
  useEffect(() => {
    if (issued) titleRef.current?.focus();
  }, [issued]);

  const trimmed = name.trim();
  const nameProblem = attempted && !trimmed;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sendingRef.current) return;
    if (!trimmed) {
      setAttempted(true);
      nameRef.current?.focus();
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setRefusal(null);
    try {
      const scopes = ACCESS_OPTIONS.find((option) => option.value === access)!.scopes;
      // Deliberately not a `useMutation`: see `SettingsTokensSection`.
      setIssued(await taskaApi.createAccessToken({ name: trimmed, scopes, expiresInDays: days }));
    } catch (error) {
      setRefusal(error);
    } finally {
      sendingRef.current = false;
      setSending(false);
      // Either way: a refusal whose answer was lost may follow a token the
      // server did make, and the list is the server's word on it. The list
      // never carries the value.
      void queryClient.invalidateQueries({ queryKey: accessTokensKey(userId) });
    }
  };

  if (issued) {
    return (
      <Modal onClose={onClose} title="Token created" titleRef={titleRef}>
        <div className="form-stack">
          <TokenSecret issued={issued} />
          <div className="modal-actions">
            <button className="primary-button" onClick={onClose} type="button">
              Done
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal busy={sending} onClose={onClose} title="New access token">
      <form className="form-stack" noValidate onSubmit={submit}>
        <div className="field">
          <label htmlFor={`${formId}-name`}>Name</label>
          {/* A short value, not text-work (§4.11): Esc still closes. */}
          <input
            aria-describedby={`${formId}-name-note`}
            aria-invalid={nameProblem || undefined}
            autoComplete="off"
            autoFocus
            id={`${formId}-name`}
            maxLength={ACCESS_TOKEN_NAME_MAX_LENGTH}
            onChange={(event) => setName(event.target.value)}
            placeholder="Claude Code on my laptop"
            ref={nameRef}
            spellCheck={false}
            value={name}
          />
          <p className={nameProblem ? "token-name-problem" : "field-note"} id={`${formId}-name-note`}>
            {nameProblem
              ? "Name the token before creating it."
              : "Where the token will be used, so you can tell it apart later."}
          </p>
        </div>

        <fieldset className="token-access">
          <legend>Access</legend>
          <div className="token-access-options">
            {ACCESS_OPTIONS.map((option) => (
              <label className="token-access-option" key={option.value}>
                <input
                  aria-describedby={`${formId}-${option.value}-description`}
                  aria-labelledby={`${formId}-${option.value}-title`}
                  checked={access === option.value}
                  name={`${formId}-access`}
                  onChange={() => setAccess(option.value)}
                  type="radio"
                  value={option.value}
                />
                <span className="token-access-text">
                  <span className="token-access-title" id={`${formId}-${option.value}-title`}>
                    {option.label}
                  </span>
                  <span className="token-access-description" id={`${formId}-${option.value}-description`}>
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="token-expiry">
          <p className="token-expiry-label" id={`${formId}-expires`}>
            Expires
          </p>
          <div
            aria-describedby={`${formId}-expires-on`}
            aria-labelledby={`${formId}-expires`}
            className="segmented fit"
            role="group"
          >
            {ACCESS_TOKEN_EXPIRY_DAYS.map((option) => (
              <button
                aria-pressed={days === option}
                className={days === option ? "is-active" : ""}
                key={option}
                onClick={() => {
                  if (days !== option) setDays(option);
                }}
                type="button"
              >
                {expiryLabel(option)}
              </button>
            ))}
          </div>
          <p className="field-note" id={`${formId}-expires-on`}>
            Expires on {expiryDayFromNow(days)}.
          </p>
        </div>

        {/* The request id under the sentence (§5.6, TAS-397). */}
        {refusal ? (
          <ErrorNote live="alert" requestId={apiErrorFacts(refusal).requestId}>
            {createRefusalText(refusal)}
          </ErrorNote>
        ) : null}

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          {/* §4.1's two `aria-disabled`: in flight (no dimming, the progress
              cursor, `data-busy`) and steadily unavailable until a name is
              typed (dimmed). A press with no name still says what is missing. */}
          <button
            aria-disabled={sending || !trimmed || undefined}
            className="primary-button token-create-submit"
            data-busy={sending || undefined}
            type="submit"
          >
            Create token
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * The value, once: the warning, the value in a read-only mono field with Copy,
 * and the snippets with the value in place of `YOUR_TOKEN`. A refused clipboard
 * selects the field, so the reader's own copy is one key away.
 */
function TokenSecret({ issued }: { issued: IssuedAccessToken }) {
  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [copyState, copy] = useCopied();
  const { token, secret } = issued;

  useEffect(() => {
    if (copyState !== "failed") return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [copyState]);

  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const status =
    copyState === "copied"
      ? "Token copied."
      : copyState === "failed"
        ? coarse
          ? "Couldn’t copy the token automatically. Touch and hold it to copy it."
          : "Couldn’t copy the token automatically. It’s selected — press Ctrl+C or ⌘C to copy it."
        : "";

  if (!secret) {
    // A created token whose value the answer did not carry: nothing to show,
    // and the token exists, so the way out is to revoke it.
    return (
      <p className="token-secret-warning">
        Taska created “{token.name}” but did not send its value. Revoke it and create another.
      </p>
    );
  }

  return (
    <div className="token-secret">
      <p className="token-secret-warning">Copy this token now. Taska shows it only once.</p>
      <div className="token-secret-field">
        <label htmlFor={fieldId}>{token.name}</label>
        <div className="token-secret-row">
          <input
            autoComplete="off"
            className="token-secret-input"
            id={fieldId}
            readOnly
            ref={inputRef}
            spellCheck={false}
            type="text"
            value={secret}
          />
          <button className="secondary-button compact-button" onClick={() => copy(secret)} type="button">
            {copyState === "copied" ? <Check aria-hidden="true" size={13} /> : <Copy aria-hidden="true" size={13} />}
            Copy token
          </button>
        </div>
        <p className="token-secret-meta">
          {[accessTokenAccessLabel(token.scopes), accessTokenExpiryText(token)].filter(Boolean).join(" · ")}
        </p>
        <p className="token-copy-status" data-outcome={copyState === "failed" ? "failed" : undefined} role="status">
          {status}
        </p>
      </div>
      <McpConnect headingLevel={3} token={secret} />
    </div>
  );
}
