import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  ACCESS_TOKEN_EXPIRY_DAYS,
  ACCESS_TOKEN_NAME_MAX_LENGTH,
  DEFAULT_ACCESS_TOKEN_EXPIRY_DAYS,
  isAccessTokenGone,
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

/** A token's name, or what stands for one the answer left blank — so no sentence prints empty quotes. */
const tokenLabel = (token: Pick<AccessToken, "name">) => (token.name.trim() ? token.name : "Unnamed token");

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
 * `Esc` is the one way out that waits: until the value or a snippet carrying it
 * has been copied, the field holds it as text-work (§4.11), and Done, ✕ and the
 * scrim are how to leave without copying.
 * Closed by ✕ or the scrim while the create is still out (Cancel and `Esc`
 * wait for it, §4.1 and §4.11), the answer finds no dialog: the value is
 * dropped unseen, the section's status says the token exists and how to be rid
 * of it, and its row says the same for as long as it is listed — the id is
 * kept in memory here, never stored.
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
  /** The last sentence for the section's one persistent status region (§5.6): a revoke's, or a create nobody saw. */
  const [said, setSaid] = useState<{ text: string; seq: number } | null>(null);
  const say = (text: string) => setSaid((current) => ({ text, seq: (current?.seq ?? 0) + 1 }));
  /**
   * The tokens whose create answered after the dialog was closed, by id: their
   * value was never shown, and their rows say so. Memory only — gone on a
   * reload — and each id leaves once its token has left the list.
   */
  const [unseen, setUnseen] = useState<ReadonlySet<string>>(() => new Set());
  const forgetUnseen = useCallback(
    (ids: readonly string[]) =>
      setUnseen((current) => {
        if (!ids.some((id) => current.has(id))) return current;
        const next = new Set(current);
        for (const id of ids) next.delete(id);
        return next;
      }),
    [],
  );

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
            <AccessTokens
              key={user.id}
              onCreate={() => setCreating(true)}
              onUnseenGone={forgetUnseen}
              say={say}
              unseen={unseen}
              userId={user.id}
            />
          ) : meQuery.isError ? (
            <ReadFailure error={meQuery.error} onRetry={() => void meQuery.refetch()} retrying={meQuery.isFetching} />
          ) : (
            <TokensLoading />
          )}
          {/* Mounted for as long as the section is, so a screen reader is
              already watching it when a revoke or a create answers; keyed by
              its sentence's number, so the same sentence twice is said twice
              (§5.6). */}
          <div className="visually-hidden" role="status">
            {said ? <span key={said.seq}>{said.text}</span> : null}
          </div>
          <hr className="settings-divider" />
          <McpConnect headingLevel={2} token={null} />
        </div>
      </div>
      {/* Beside the plane, not inside it, as the admin sections mount theirs:
          inside the plane's scroller a wheel over the scrim scrolled the page
          behind the dialog. */}
      {creating && user ? (
        <CreateTokenModal
          onClose={() => setCreating(false)}
          onCreatedUnseen={(token) => {
            setUnseen((current) => new Set(current).add(token.id));
            say(
              `The token “${tokenLabel(token)}” was created, but the dialog closed before its value was shown. Revoke it and create another.`,
            );
          }}
          userId={user.id}
        />
      ) : null}
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
function AccessTokens({
  userId,
  unseen,
  onCreate,
  onUnseenGone,
  say,
}: {
  userId: string;
  /** Tokens whose value was never shown: their rows say so. */
  unseen: ReadonlySet<string>;
  onCreate: () => void;
  /** Those of `unseen` that have left the list. */
  onUnseenGone: (ids: readonly string[]) => void;
  say: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const read = accessTokensOptions(userId);
  const query = useQuery(read);
  const undeployed = query.isError && isUndeployedRoute(query.error, UNDEPLOYED_ROUTE_MESSAGE);
  const tokens = useMemo(() => sortAccessTokens(query.data ?? []), [query.data]);
  const confirmPrefix = useId();
  const revokeKey = ["access-tokens", "revoke", userId] as const;
  const revoking = useIsMutating({ mutationKey: revokeKey }) > 0;

  /**
   * An unseen token's id goes once its token has left the list: revoked, or
   * gone from a re-read. Not on the optimistic removal of a revoke still out —
   * a refusal brings the row back, and the token still exists unseen — and not
   * before its row was ever drawn: the create answers before the list is read
   * again.
   */
  const listed = useRef(new Set<string>());
  useEffect(() => {
    const present = new Set(tokens.map((token) => token.id));
    for (const id of present) listed.current.add(id);
    if (revoking) return;
    const gone = [...unseen].filter((id) => listed.current.has(id) && !present.has(id));
    if (gone.length) onUnseenGone(gone);
  });

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  /** A revoke the server refused, by token: the note under the row that came back. */
  const [refusals, setRefusals] = useState<Readonly<Record<string, unknown>>>({});

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
      if (isAccessTokenGone(error)) {
        // Not a refusal to revoke: this account has no such token (a list read
        // before it went), so the row stays gone and the re-read below is the
        // server's word on what is left.
        say(`The token “${tokenLabel(token)}” is already gone.`);
        return;
      }
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
              unseen={unseen.has(token.id)}
            />
          ))}
        </ul>
      ) : null}
    </>
  );
}

function TokenRow({
  token,
  unseen,
  confirming,
  confirmId,
  refusal,
  registerRevoke,
  onOpen,
  onCancel,
  onAccept,
}: {
  token: AccessToken;
  unseen: boolean;
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
      {/* Its create answered after the dialog was closed (§5.9): a fact about
          this token, under the row's own content, for as long as it is listed. */}
      {unseen ? <p className="token-unseen">Its value was never shown. Revoke this token and create another.</p> : null}
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
 * which goes when the dialog closes — there is no way back to it. A create
 * that answers after the dialog closed is handed to `onCreatedUnseen` without
 * its value, which goes nowhere.
 */
function CreateTokenModal({
  userId,
  onClose,
  onCreatedUnseen,
}: {
  userId: string;
  onClose: () => void;
  onCreatedUnseen: (token: AccessToken) => void;
}) {
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
  /** Whether the dialog is still on screen when the create answers: ✕ and the scrim close it mid-flight (§4.11). */
  const open = useRef(true);
  const nameRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

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
      const answer = await taskaApi.createAccessToken({ name: trimmed, scopes, expiresInDays: days });
      // Closed while it was out: nobody saw the value and nobody will, so it
      // goes no further than this line, and the section says the token exists.
      if (open.current) setIssued(answer);
      else onCreatedUnseen(answer.token);
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
          {/* §4.1's in-flight recipe, as Esc waits too (§4.11): a Cancel during
              the create would look like it cancelled a create still going. */}
          <button
            aria-disabled={sending || undefined}
            className="secondary-button token-create-cancel"
            onClick={() => {
              if (!sendingRef.current) onClose();
            }}
            type="button"
          >
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
 *
 * Until "Copy token" or a snippet's Copy has reached the clipboard, the field
 * marks itself `data-unsaved-text`, and `Modal` does not close on `Esc` (§4.11):
 * the one showing of a value nobody can get back is text-work too. A refused
 * write keeps the hold. Done, ✕ and the scrim close whatever was copied.
 */
function TokenSecret({ issued }: { issued: IssuedAccessToken }) {
  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  /** Whether the value has reached the clipboard once, by either copy. */
  const [taken, setTaken] = useState(false);
  const markTaken = useCallback(() => setTaken(true), []);
  const [copyState, copy] = useCopied(markTaken);
  const { token, secret } = issued;
  const name = tokenLabel(token);

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
        Taska created “{name}” but did not send its value. Revoke it and create another.
      </p>
    );
  }

  return (
    <div className="token-secret">
      <p className="token-secret-warning">Copy this token now. Taska shows it only once.</p>
      <div className="token-secret-field">
        <label htmlFor={fieldId}>{name}</label>
        <div className="token-secret-row">
          <input
            autoComplete="off"
            className="token-secret-input"
            data-unsaved-text={taken ? undefined : "true"}
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
      <McpConnect headingLevel={3} onSecretCopied={markTaken} token={secret} />
    </div>
  );
}
