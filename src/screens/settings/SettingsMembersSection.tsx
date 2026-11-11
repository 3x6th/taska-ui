import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import { taskaApi } from "../../api/client";
import { apiErrorFacts, isWorkspaceClosed } from "../../api/errors";
import {
  isKnownMembershipRole,
  isSendableVersion,
  seatsOf,
  type Invitation,
  type KnownMembershipRole,
  type KnownProjectGrantRole,
  type Membership,
} from "../../api/tenantMembers";
import type { TenantOperation } from "../../api/tenants";
import { ApiNotice } from "../../components/ApiNotice";
import { Avatar } from "../../components/Avatar";
import { ErrorNote } from "../../components/ErrorNote";
import { useCompanies, useCompanyName } from "../../hooks/useCompanies";
import { useMutation } from "../../hooks/useMutation";
import { COMPANIES_ROUTE, TENANTS_QUERY_KEY } from "../../lib/companies";
import { useAccountQueryClient, useCompanyAddress } from "../../lib/companyAddress";
import { ME_QUERY_KEY } from "../../lib/ownAvatarLink";
import type { CompaniesRouteState } from "../CompaniesScreen";
import { POLL_STEPS_MS, POLL_STEADY_MS } from "../companySetupText";
import {
  earliestPendingExpiry,
  groupRows,
  invitationsSentBy,
  memberControls,
  memberSubject,
  readerAccess,
  type MemberSubject,
  type ReaderAccess,
} from "./companyMembers";
import { isIndefinite, keyFor, type SentIntent } from "../../lib/intentKey";
import {
  COMPANY_INVITATIONS_KEY,
  COMPANY_MEMBERS_KEY,
  COMPANY_QUOTAS_KEY,
  companyInvitationsOptions,
  companyMembersOptions,
  companyQuotasOptions,
} from "./companyMembersQuery";
import {
  INVITATIONS_READ_FAILED,
  LOADING_TEXT,
  MEMBERS_READ_FAILED,
  MEMBERS_REFRESH_FAILED,
  SEATS_FULL_HINT,
  SEATS_READ_FAILED,
  UNCHECKED_TEXT,
  demoteQuestion,
  expiredLine,
  expiredStatus,
  invitedStatus,
  leadText,
  leaveQuestion,
  leaveRefusalWords,
  leaveZoneText,
  memberRefusalWords,
  operationDetail,
  ownerCannotLeaveText,
  pendingLine,
  reactivatedStatus,
  removeQuestion,
  removedStatus,
  resentStatus,
  revokeQuestion,
  revokedStatus,
  roleChangedStatus,
  roleWord,
  seatLineText,
  suspendQuestion,
  suspendedStatus,
  type MemberAction,
  type RefusalWords,
} from "./companyMembersText";
import { InviteMemberModal, type InviteDraft } from "./InviteMemberModal";

/**
 * Settings › Members (TAS-502, DESIGN.md §4.38) — the B2B build only: the
 * tab's company's directory, and for its admins the invitations, the seats
 * and the writes on both.
 *
 * Against the B2B blueprint on the mock (docs/ai/API-DIVERGENCE.md
 * «TAS-502», api-contract-guard's design with the orchestrator's rulings):
 *
 * - **Who may change what** comes from the reader's own row of the list,
 *   found by `me.id` — its role and `isOwner` — and from nothing else: no
 *   capability names, no count of admins, no seat arithmetic beyond the
 *   server's snapshot. The owner and the last admin are the server's answers.
 * - **No write is optimistic**, the exception to DESIGN.md §6 the story's
 *   criterion asks for: a row's controls are in flight from the press until
 *   the list read again after the answer has come back; a mutation's answer is
 *   never put into a row. A refusal re-reads; a 412 never retries by itself.
 * - **One key per confirmed intent**, held by the row: the same intent
 *   retried after an answer that never came (or a 429, or a 5xx) sends the
 *   same key, body and `If-Match`; anything else is a new intent.
 * - **The reader's own change** — a 200 on their own row — re-enters the
 *   company: a new session, a new context, nothing said (ruling 3).
 */
export function SettingsMembersSection() {
  const address = useCompanyAddress();
  if (address?.companyId == null) return null;
  return <CompanyMembers companyId={address.companyId} />;
}

/** A question strip open under a row (§4.22's recipe). */
type AskKind = "demote" | "suspend" | "remove" | "revoke" | "leave";
interface Asking {
  rowKey: string;
  kind: AskKind;
}

/** The one refusal the section shows, under the row it is about (§4.38 «Отказы»). */
interface RowRefusal {
  rowKey: string;
  text: string;
  words: string | null;
  requestId: string | null;
  /** An operation's own detail line, in place of the request id. */
  detail: string | null;
  seq: number;
}

/** What every row needs from the section. */
interface Section {
  companyId: string;
  company: string | null;
  meId: string | null;
  /** The reader's own colour from `/users/me`, for their own row's circle (art-director X3). */
  meColor: string | undefined;
  access: ReaderAccess;
  invitations: Invitation[] | undefined;
  /** «you», the member's name, or `null` when `createdBy` is not in the list. */
  inviterName: (userId: string | null) => string | null;
  asking: Asking | null;
  ask: (asking: Asking | null) => void;
  refusal: RowRefusal | null;
  refuse: (rowKey: string, words: RefusalWords, error: unknown, detail?: string | null) => void;
  clearRefusal: () => void;
  say: (text: string) => void;
  reread: (what: { members?: boolean; invitations?: boolean; quotas?: boolean }) => Promise<void>;
  reenter: () => Promise<void>;
  focusAfterLeaving: (rowKey: string) => void;
  openInvite: (draft: InviteDraft) => void;
  now: number;
}

/**
 * Set before a change to the reader's own row re-enters the company: the new
 * context's section, mounting, puts focus on the heading (§4.38: «После
 * своего понижения — на h1»). A focus hand-over, not data.
 */
const headingHandOver = { pending: false };

const heading = () => document.querySelector<HTMLElement>(".settings-area .area-section-title");

/** §4.38's removal cadence: the never-opened card's (§4.37), but stopped after 2 minutes with «Check again». */
const REMOVAL_POLL_LIMIT_MS = 2 * 60_000;
/** After the earliest pending `expiresAt` passes: one re-read, and one more this long after (§4.38 «Истечение»). */
const EXPIRY_SECOND_READ_MS = 60_000;

function CompanyMembers({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const accountClient = useAccountQueryClient();
  const address = useCompanyAddress();
  const company = useCompanyName(companyId);
  const companies = useCompanies();
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: () => taskaApi.getCurrentUser() });
  const meId = me.data?.id ?? null;
  const members = useQuery(companyMembersOptions(companyId));
  const access = readerAccess(members.data, meId);
  const admin = access.admin;
  // Requested only once the reader's own row says TENANT_ADMIN (B8): a member
  // never asks for the invitations, and the seat line is the admins'.
  const invitations = useQuery({ ...companyInvitationsOptions(companyId), enabled: admin });
  const quotas = useQuery({ ...companyQuotasOptions(companyId), enabled: admin });
  const seats = seatsOf(quotas.data);
  const seatLineId = useId();
  const section = useRef<HTMLDivElement>(null);
  const inviteButton = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);

  const [said, setSaid] = useState<{ text: string; seq: number } | null>(null);
  const say = useCallback((text: string) => setSaid((current) => ({ text, seq: (current?.seq ?? 0) + 1 })), []);
  const [refusal, setRefusal] = useState<RowRefusal | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [inviting, setInviting] = useState<{ draft: InviteDraft | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    mounted.current = true;
    if (headingHandOver.pending) {
      headingHandOver.pending = false;
      heading()?.focus();
    }
    return () => {
      mounted.current = false;
    };
  }, []);

  const reread = useCallback(
    async (what: { members?: boolean; invitations?: boolean; quotas?: boolean }) => {
      const keys = [
        ...(what.members ? [COMPANY_MEMBERS_KEY] : []),
        ...(what.invitations ? [COMPANY_INVITATIONS_KEY] : []),
        ...(what.quotas ? [COMPANY_QUOTAS_KEY] : []),
      ];
      await Promise.all(keys.map((queryKey) => queryClient.cancelQueries({ queryKey })));
      await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
    [queryClient],
  );

  const refuse = useCallback(
    (rowKey: string, words: RefusalWords, error: unknown, detail: string | null = null) => {
      setRefusal((current) => ({
        rowKey,
        text: words.text,
        words: words.words,
        requestId: error === null ? null : apiErrorFacts(error).requestId,
        detail,
        seq: (current?.seq ?? 0) + 1,
      }));
      // The box under the row is not live; the section's status says it (§4.38 «Отказы»).
      say(words.text);
    },
    [say],
  );
  const clearRefusal = useCallback(() => setRefusal(null), []);

  /** A change to the reader's own row: a new company session, a new context (ruling 3), focus on the heading. */
  const reenter = useCallback(async () => {
    headingHandOver.pending = true;
    await taskaApi.reenterCompany(companyId);
    // The new context mounts a section of its own, which takes the hand-over.
    // Still here a tick later, the tab kept its session (no answer, or a
    // refusal that closes nothing): this one reads again and takes it.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    if (!headingHandOver.pending) return;
    headingHandOver.pending = false;
    if (!mounted.current) return;
    await reread({ members: true, invitations: true, quotas: true });
    heading()?.focus();
  }, [companyId, reread]);

  /** Focus after a row leaves (§4.38): the next row's first control, else the previous one's, else Invite, else the heading. */
  const focusAfterLeaving = useCallback((rowKey: string) => {
    const rows = [...(section.current?.querySelectorAll<HTMLElement>("[data-row-key]") ?? [])];
    const index = rows.findIndex((row) => row.dataset.rowKey === rowKey);
    const control = (row: HTMLElement) =>
      row.querySelector<HTMLElement>(".company-member-controls select, .company-member-controls button");
    const target =
      rows.slice(index + 1).map(control).find((node) => node !== null) ??
      rows.slice(0, Math.max(index, 0)).reverse().map(control).find((node) => node !== null) ??
      inviteButton.current ??
      heading();
    target?.focus();
  }, []);

  // Expiry on an open page (§4.38): when the local clock passes the earliest
  // pending `expiresAt`, the invitations and the seats are read again once,
  // and once more a minute later; the client never marks EXPIRED itself.
  const earliest = earliestPendingExpiry(invitations.data);
  useEffect(() => {
    if (earliest === null) return;
    const timers: number[] = [];
    const fire = (second: boolean) => {
      setNow(Date.now());
      void reread({ invitations: true, quotas: true });
      if (!second) timers.push(window.setTimeout(() => fire(true), EXPIRY_SECOND_READ_MS));
    };
    const wait = earliest - Date.now();
    // Past the timer's range, it would fire at once: a later page load reads anew anyway.
    if (wait < 2 ** 31 - 1) timers.push(window.setTimeout(() => fire(false), Math.max(wait, 0)));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [earliest, reread]);

  // «The invitation to {email} expired, so its seat is free.» — said when a
  // re-read finds one that was pending now EXPIRED.
  const lastPending = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const rows = invitations.data;
    if (!rows) return;
    const previous = lastPending.current;
    if (previous !== null) {
      for (const row of rows) {
        if (row.state === "EXPIRED" && previous.has(row.id)) say(expiredStatus(previous.get(row.id) ?? row.email ?? ""));
      }
    }
    lastPending.current = new Map(rows.filter((row) => row.state === "PENDING").map((row) => [row.id, row.email ?? ""]));
  }, [invitations.data, say]);

  const inviterName = useCallback(
    (userId: string | null) => {
      if (userId === null) return null;
      if (userId === meId) return "you";
      const row = members.data?.find((member) => member.userId === userId);
      return row ? (row.displayName ?? row.email) : null;
    },
    [members.data, meId],
  );

  // Leaving (§4.38 «Leave company»): the session layer releases the company
  // session on a 202 that is not FAILED, and the tab goes to the picker.
  const leaveIntent = useRef<SentIntent | null>(null);
  const leaveButton = useRef<HTMLButtonElement>(null);
  const [leaveRefusal, setLeaveRefusal] = useState<{ text: string; words: string | null; requestId: string | null; detail: string | null } | null>(null);
  const leave = useMutation({
    mutationFn: (key: string) => taskaApi.leaveTenant(companyId, key),
    onSuccess: (operation: TenantOperation | null) => {
      if (operation !== null && operation.state === "FAILED") {
        setAsking(null);
        setLeaveRefusal({ text: leaveRefusalWords(null, company).text, words: null, requestId: null, detail: operationDetail(operation.failureCode, operation.id) });
        leaveButton.current?.focus();
        return;
      }
      leaveIntent.current = null;
      void accountClient?.invalidateQueries({ queryKey: TENANTS_QUERY_KEY });
      address?.go(COMPANIES_ROUTE, {
        replace: true,
        state: { focusHeading: true, left: { name: company } } satisfies CompaniesRouteState,
      });
    },
    onError: (error) => {
      // A 401 reaching here had its renewal fail for want of an answer, or its
      // re-selection refused with no lost leave to read as left: nothing is
      // known, and the session layer keeps a retry's record (N3) — as unanswered.
      const indefinite = isIndefinite(error) || apiErrorFacts(error).status === 401;
      if (leaveIntent.current && indefinite) leaveIntent.current = { ...leaveIntent.current, open: true };
      setAsking(null);
      const words = leaveRefusalWords(error, company);
      setLeaveRefusal({ ...words, requestId: apiErrorFacts(error).requestId, detail: null });
      say(words.text);
      leaveButton.current?.focus();
      // Not after an answer that never came (api-contract-guard B-1): the leave
      // may have been applied, and a re-read would meet the server's «no longer
      // a member» first. The next press goes with the same key and finds out.
      if (!indefinite) void reread({ members: true, quotas: true });
    },
  });
  const sendLeave = () => {
    if (leave.isPending) return;
    const key = keyFor(leaveIntent.current, "leave");
    leaveIntent.current = { signature: "leave", key, open: false };
    setLeaveRefusal(null);
    leave.mutate(key);
  };

  const onInvited = (invitation: Invitation) => {
    setInviting(null);
    // The 201's row stands first in «Pending invitations» in the same frame
    // (§4.38 «Приглашение»), and the list and the seats are read again.
    queryClient.setQueryData<Invitation[]>(COMPANY_INVITATIONS_KEY, (current) =>
      current ? [invitation, ...current.filter((row) => row.id !== invitation.id)] : current,
    );
    void reread({ invitations: true, quotas: true });
    say(invitedStatus(invitation.email ?? "", invitation.expiresAt));
    inviteButton.current?.focus();
  };

  const ctx: Section = {
    companyId,
    company,
    meId,
    meColor: me.data?.color ?? undefined,
    access,
    invitations: invitations.data,
    inviterName,
    asking,
    ask: setAsking,
    refusal,
    refuse,
    clearRefusal,
    say,
    reread,
    reenter,
    focusAfterLeaving,
    openInvite: (draft) => {
      setRefusal(null);
      setInviting({ draft });
    },
    now,
  };

  // Nothing of the list is drawn until the reader's own row can be found in
  // it (art-director X1): with the profile still out, the page would draw a
  // member's lead, «couldn't check» and a Leave button, then change its mind.
  const ready = members.data !== undefined && !(me.isPending && !me.isError);
  const failed = members.isError && !members.data;
  const loading = !ready && !failed;
  const groups = ready && members.data ? groupRows(members.data, admin ? invitations.data : undefined) : null;
  const ownerByList = companies.data?.find((tenant) => tenant.id === companyId)?.ownerId;
  const isOwner = access.row !== null ? access.owner : meId !== null && ownerByList === meId;
  const seatLine = seats ? seatLineText(seats) : null;

  return (
    <>
      <div className="settings-plane">
        <div className="settings-column company-members" ref={section}>
          {ready ? <p className="settings-lead">{leadText(company, admin)}</p> : null}
          {ready && !access.known ? <p className="company-members-unchecked">{UNCHECKED_TEXT}</p> : null}

          {admin ? (
            <div className="company-seats">
              {quotas.isPending ? (
                <span aria-hidden="true" className="value-skeleton company-seats-skeleton" />
              ) : quotas.isError && !quotas.data ? (
                <ErrorNote requestId={apiErrorFacts(quotas.error).requestId}>{SEATS_READ_FAILED}</ErrorNote>
              ) : seatLine ? (
                <div id={seatLineId}>
                  <p className="company-seats-line">{seatLine.text}</p>
                  {seatLine.full ? (
                    <p className="company-seats-line">
                      {SEATS_FULL_HINT}{" "}
                      {/* The plan's explanation (TAS-512, §4.38 → §4.40). */}
                      <Link className="admin-note-link company-seats-plan-link" to="/settings/plan">
                        See Plan
                      </Link>
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {admin ? (
            <div className="company-invite-action">
              {/* Never disabled by the snapshot: it may be stale, and the server's 422 decides (§4.38). */}
              <button
                aria-describedby={seatLine?.full ? seatLineId : undefined}
                className="primary-button compact-button company-invite-button"
                onClick={() => ctx.openInvite({ email: "", role: "MEMBER", grants: [] })}
                ref={inviteButton}
                type="button"
              >
                <UserPlus aria-hidden="true" size={13} />
                Invite a member
              </button>
            </div>
          ) : null}

          {loading ? <MembersLoading /> : null}
          {failed ? (
            <div className="company-members-failure">
              <ApiNotice error={members.error} live="off">
                {MEMBERS_READ_FAILED}
              </ApiNotice>
              <button
                aria-disabled={members.isFetching || undefined}
                className="secondary-button company-members-retry"
                onClick={() => {
                  if (members.isFetching) return;
                  // The notice and its button go with a list that answered: focus to the heading (art-director N-a).
                  void members.refetch().then((result) => {
                    if (result.isSuccess) heading()?.focus();
                  });
                }}
                type="button"
              >
                Try again
              </button>
            </div>
          ) : null}
          {ready && members.isError && members.data ? (
            <div className="company-members-refresh-failure">
              <ApiNotice error={members.error} live="off">
                {MEMBERS_REFRESH_FAILED}
              </ApiNotice>
            </div>
          ) : null}

          {groups ? (
            <>
              {admin && invitations.isError && !invitations.data ? (
                <div className="company-group">
                  <ErrorNote requestId={apiErrorFacts(invitations.error).requestId}>{INVITATIONS_READ_FAILED}</ErrorNote>
                </div>
              ) : null}
              {groups.pending.length > 0 ? (
                <Group count={groups.pending.length} title="Pending invitations">
                  {groups.pending.map((invitation) => (
                    <PendingRow ctx={ctx} invitation={invitation} key={invitation.id} />
                  ))}
                </Group>
              ) : null}
              <Group count={groups.members.length} title="Members">
                {groups.members.map((member) => (
                  <MemberRow ctx={ctx} key={member.userId} member={member} />
                ))}
              </Group>
              {groups.expired.length > 0 ? (
                <Group count={groups.expired.length} title="Expired invitations">
                  {groups.expired.map((invitation) => (
                    <ExpiredRow ctx={ctx} invitation={invitation} key={invitation.id} />
                  ))}
                </Group>
              ) : null}

              {isOwner ? (
                <p className="company-leave company-leave-owner">{ownerCannotLeaveText(company)}</p>
              ) : (
                <LeaveZone
                  answer={sendLeave}
                  asking={asking?.kind === "leave"}
                  busy={leave.isPending}
                  buttonRef={leaveButton}
                  company={company}
                  onAsk={() => {
                    setLeaveRefusal(null);
                    setRefusal(null);
                    setAsking({ rowKey: "leave", kind: "leave" });
                  }}
                  onCancel={() => {
                    setAsking(null);
                    leaveButton.current?.focus();
                  }}
                  refusal={leaveRefusal}
                  sent={meId === null ? 0 : invitationsSentBy(invitations.data, meId)}
                />
              )}
            </>
          ) : null}

          {/* One persistent region, a node per sentence (§5.6): mounted with the
              section, so a screen reader is already listening when it speaks. */}
          <div className="visually-hidden" role="status">
            {said ? <span key={said.seq}>{said.text}</span> : null}
          </div>
        </div>
      </div>
      {inviting ? (
        <InviteMemberModal
          company={company}
          companyId={companyId}
          draft={inviting.draft}
          onClose={() => setInviting(null)}
          onInvited={onInvited}
          seats={seats}
        />
      ) : null}
    </>
  );
}

function MembersLoading() {
  return (
    <div aria-busy="true" className="company-members-loading">
      <span className="visually-hidden" role="status">
        {LOADING_TEXT}
      </span>
      {[0, 1, 2].map((row) => (
        <div aria-hidden="true" className="company-member-skeleton" key={row}>
          <span className="value-skeleton company-member-skeleton-avatar" />
          <span className="company-member-skeleton-text">
            <span className="value-skeleton company-member-skeleton-name" />
            <span className="value-skeleton company-member-skeleton-line" />
          </span>
        </div>
      ))}
    </div>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const id = useId();
  return (
    <section className="company-group">
      <h2 className="company-group-title" id={id}>
        {title} <span className="company-group-count">{count}</span>
      </h2>
      <ul aria-labelledby={id} className="company-member-list">
        {children}
      </ul>
    </section>
  );
}

/* ----------------------------------------------------------------- rows */

/**
 * A row that leaves while focus is inside it — after «Check again», or any
 * re-read that no longer lists it — hands focus on by the same rule as at the
 * 202 (art-director X2), instead of dropping it to `<body>`. In the layout
 * cleanup, while the row is still in the document, so its neighbours can be
 * found.
 */
function useFocusOnLeave(rowKey: string, focusAfterLeaving: (rowKey: string) => void) {
  const row = useRef<HTMLLIElement>(null);
  const hand = useRef(focusAfterLeaving);
  useEffect(() => {
    hand.current = focusAfterLeaving;
  });
  useLayoutEffect(() => {
    const node = row.current;
    const handOn = hand;
    return () => {
      if (node !== null && node.isConnected && node.contains(document.activeElement)) handOn.current(rowKey);
    };
  }, [rowKey]);
  return row;
}

/** The three right cells (§4.38 «Справа»); a reader without controls sees the role word only. */
function Controls({
  manage,
  role,
  action,
  destructive,
}: {
  manage: boolean;
  role: ReactNode;
  action: ReactNode;
  destructive: ReactNode;
}) {
  return (
    <div className="company-member-controls">
      <div className="company-member-role">{role}</div>
      {manage ? (
        <>
          <div aria-hidden={action ? undefined : true} className="company-member-action">
            {action}
          </div>
          <div aria-hidden={destructive ? undefined : true} className="company-member-destructive">
            {destructive}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** §4.22's strip under a row: the true sentence, Cancel first and focused, the answer edged in `--danger`. */
/** §4.22's strip, Cancel first — shared with Settings › General's pause question (TAS-504). */
export function Strip({
  id,
  sentence,
  answer,
  busy,
  onCancel,
  onAnswer,
  className = "",
}: {
  id: string;
  sentence: string;
  answer: string;
  busy: boolean;
  onCancel: () => void;
  onAnswer: () => void;
  className?: string;
}) {
  return (
    <div className={`member-confirm company-member-confirm ${className}`} id={id}>
      <p className="member-confirm-sentence" id={`${id}-sentence`}>
        {sentence}
      </p>
      <div className="member-confirm-actions">
        <button
          aria-disabled={busy || undefined}
          autoFocus
          className="secondary-button compact-button"
          onClick={() => {
            if (!busy) onCancel();
          }}
          type="button"
        >
          Cancel
        </button>
        <button
          aria-describedby={`${id}-sentence`}
          aria-disabled={busy || undefined}
          className="secondary-button compact-button member-confirm-accept"
          data-busy={busy || undefined}
          onClick={() => {
            if (!busy) onAnswer();
          }}
          type="button"
        >
          {answer}
        </button>
      </div>
    </div>
  );
}

function RefusalNote({ refusal }: { refusal: RowRefusal }) {
  return (
    <ErrorNote key={refusal.seq} requestId={refusal.requestId} serverWords={refusal.detail ?? refusal.words}>
      {refusal.text}
    </ErrorNote>
  );
}

interface RoleIntent {
  role: KnownMembershipRole;
  version: string;
  key: string;
}
interface StateIntent {
  state: "ACTIVE" | "SUSPENDED";
  version: string;
  key: string;
}

/** A removal the server accepted: its operation, read on §4.37's cadence for at most 2 minutes. */
interface Removal {
  operation: TenantOperation;
  startedAt: number;
  stopped: boolean;
}

function MemberRow({ member, ctx }: { member: Membership; ctx: Section }) {
  const rowKey = `member:${member.userId}`;
  const rowRef = useFocusOnLeave(rowKey, ctx.focusAfterLeaving);
  const subject: MemberSubject = memberSubject(member, ctx.meId);
  const controls = memberControls(member, ctx.access, ctx.meId);
  const suspended = member.state === "SUSPENDED";
  const confirmId = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const trashRef = useRef<HTMLButtonElement>(null);
  const intent = useRef<SentIntent | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const asking = ctx.asking?.rowKey === rowKey ? ctx.asking.kind : null;
  const sent = invitationsSentBy(ctx.invitations, member.userId);
  const refusalHere = ctx.refusal?.rowKey === rowKey ? ctx.refusal : null;
  const words = { name: subject.name, self: subject.self, email: member.email ?? "", company: ctx.company };

  const refused = (action: MemberAction, error: unknown, focus: RefObject<HTMLElement | null>) => {
    if (intent.current && isIndefinite(error)) intent.current = { ...intent.current, open: true };
    ctx.ask(null);
    focus.current?.focus();
    ctx.refuse(rowKey, memberRefusalWords(action, error, words), error);
    void ctx.reread({ members: true, invitations: true, quotas: true });
  };

  const roleWrite = useMutation({
    mutationFn: (vars: RoleIntent) => taskaApi.setTenantMemberRole(ctx.companyId, member.userId, vars.role, vars.version, vars.key),
    onSuccess: async (_answer, vars) => {
      intent.current = null;
      if (subject.self) {
        await ctx.reenter();
        return;
      }
      // A demotion revokes the person's pending invitations (L03): their list and the seats move too.
      await ctx.reread({ members: true, invitations: vars.role === "MEMBER", quotas: vars.role === "MEMBER" });
      ctx.ask(null);
      ctx.say(roleChangedStatus(subject.name, vars.role));
    },
    onError: (error) => refused("role", error, selectRef),
  });

  const stateWrite = useMutation({
    mutationFn: (vars: StateIntent) => taskaApi.setTenantMemberState(ctx.companyId, member.userId, vars.state, vars.version, vars.key),
    onSuccess: async (_answer, vars) => {
      intent.current = null;
      await ctx.reread({ members: true, invitations: vars.state === "SUSPENDED", quotas: vars.state === "SUSPENDED" });
      ctx.ask(null);
      // On the action that took the pressed one's place (§4.38).
      actionRef.current?.focus();
      ctx.say(vars.state === "SUSPENDED" ? suspendedStatus(subject.name) : reactivatedStatus(subject.name));
    },
    onError: (error, vars) => refused(vars.state === "SUSPENDED" ? "suspend" : "reactivate", error, actionRef),
  });

  const finishRemoval = async () => {
    await ctx.reread({ members: true, invitations: true, quotas: true });
    ctx.say(removedStatus(subject.name, ctx.company));
  };
  const removalFailed = (operation: TenantOperation) => {
    setRemoval(null);
    ctx.refuse(rowKey, { text: `${subject.name} was not removed.`, words: null }, null, operationDetail(operation.failureCode, operation.id));
  };
  // The poll below reads these through a ref, so a render of the section does
  // not restart it (the section's context is a new object every render).
  const ends = useRef({ finishRemoval, removalFailed });
  useEffect(() => {
    ends.current = { finishRemoval, removalFailed };
  });

  const removeWrite = useMutation({
    mutationFn: (vars: { version: string; key: string }) => taskaApi.removeTenantMember(ctx.companyId, member.userId, vars.version, vars.key),
    onSuccess: async (operation) => {
      intent.current = null;
      ctx.ask(null);
      ctx.focusAfterLeaving(rowKey);
      if (operation.state === "SUCCEEDED") {
        setRemoval({ operation, startedAt: Date.now(), stopped: true });
        await finishRemoval();
        return;
      }
      if (operation.state === "FAILED") {
        removalFailed(operation);
        return;
      }
      setRemoval({ operation, startedAt: Date.now(), stopped: operation.state === "MANUAL_REVIEW" });
    },
    onError: (error) => refused("remove", error, trashRef),
  });

  // The removal's operation, read one request at a time on §4.37's cadence,
  // paused while the tab is hidden, given up after 2 minutes (§4.38). One read
  // at a time across the poll, a return to the tab and «Check again» (`reading`).
  const [checks, setChecks] = useState(0);
  const reading = useRef(false);
  useEffect(() => {
    if (removal === null || removal.stopped || removal.operation.state === "SUCCEEDED") return;
    let current = true;
    let timer: number | undefined;
    let reads = 0;
    const tick = async () => {
      if (!current || reading.current) return;
      if (document.hidden) return;
      if (Date.now() - removal.startedAt >= REMOVAL_POLL_LIMIT_MS) {
        setRemoval((value) => (value ? { ...value, stopped: true } : value));
        return;
      }
      let operation: TenantOperation;
      reading.current = true;
      try {
        operation = await taskaApi.getTenantOperation(ctx.companyId, removal.operation.id);
      } catch (error) {
        if (!current || isWorkspaceClosed(error)) return;
        schedule();
        return;
      } finally {
        reading.current = false;
      }
      if (!current) return;
      if (operation.state === "SUCCEEDED") {
        setRemoval({ ...removal, operation, stopped: true });
        void ends.current.finishRemoval();
        return;
      }
      if (operation.state === "FAILED") {
        ends.current.removalFailed(operation);
        return;
      }
      if (operation.state === "MANUAL_REVIEW") {
        setRemoval({ ...removal, operation, stopped: true });
        return;
      }
      schedule();
    };
    const schedule = () => {
      timer = window.setTimeout(() => void tick(), POLL_STEPS_MS[reads] ?? POLL_STEADY_MS);
      reads += 1;
    };
    const onVisible = () => {
      // Back in the tab: read now — unless a read is already out, whose answer schedules the next.
      if (document.hidden || reading.current) return;
      window.clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    schedule();
    return () => {
      current = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [removal, ctx.companyId, checks]);

  const checkAgain = async () => {
    if (removal === null || reading.current) return;
    reading.current = true;
    try {
      const operation = await taskaApi.getTenantOperation(ctx.companyId, removal.operation.id);
      reading.current = false;
      if (operation.state === "SUCCEEDED") {
        // «Check again» goes with the answer: focus by the 202's rule, while
        // the row — with no controls of its own now — is still there (X2).
        ctx.focusAfterLeaving(rowKey);
        setRemoval({ ...removal, operation, stopped: true });
        await finishRemoval();
      } else if (operation.state === "FAILED") {
        removalFailed(operation);
        // The row's controls come back: focus to its Remove (X2).
        focusRemove.current = true;
      } else {
        // Still under way: polling resumes and «Check again» goes, in a row
        // with no controls — focus by the 202's rule (X2). MANUAL_REVIEW keeps the button.
        if (operation.state !== "MANUAL_REVIEW") ctx.focusAfterLeaving(rowKey);
        setRemoval({ ...removal, operation, startedAt: Date.now(), stopped: operation.state === "MANUAL_REVIEW" });
        setChecks((value) => value + 1);
      }
    } catch {
      // The button stays: nothing is known yet.
    } finally {
      reading.current = false;
    }
  };

  const busy = roleWrite.isPending || stateWrite.isPending || removeWrite.isPending;
  const removing = removal !== null;
  /** Set when a «Check again» answered FAILED: the restored Remove takes focus once it is drawn. */
  const focusRemove = useRef(false);
  useEffect(() => {
    if (!focusRemove.current || removing) return;
    focusRemove.current = false;
    trashRef.current?.focus();
  });
  const manage = ctx.access.admin && ctx.access.known;

  /** The row's version, or a re-read instead of a send when it is not one `If-Match` can carry (§4). */
  const versionOrReread = (): string | null => {
    if (isSendableVersion(member.version)) return member.version;
    void ctx.reread({ members: true });
    return null;
  };

  const sendRole = (role: KnownMembershipRole) => {
    const version = versionOrReread();
    if (version === null) return;
    const signature = `role:${role}:${version}`;
    const key = keyFor(intent.current, signature);
    intent.current = { signature, key, open: false };
    roleWrite.mutate({ role, version, key });
  };
  const sendState = (state: "ACTIVE" | "SUSPENDED") => {
    const version = versionOrReread();
    if (version === null) return;
    const signature = `state:${state}:${version}`;
    const key = keyFor(intent.current, signature);
    intent.current = { signature, key, open: false };
    stateWrite.mutate({ state, version, key });
  };
  const sendRemove = () => {
    const version = versionOrReread();
    if (version === null) return;
    const signature = `remove:${version}`;
    const key = keyFor(intent.current, signature);
    intent.current = { signature, key, open: false };
    removeWrite.mutate({ version, key });
  };

  const onPickRole = (value: string) => {
    if (busy || !isKnownMembershipRole(value)) return;
    ctx.clearRefusal();
    if (value === member.role) {
      if (asking === "demote") ctx.ask(null);
      return;
    }
    if (member.role === "TENANT_ADMIN" && value === "MEMBER") {
      ctx.ask({ rowKey, kind: "demote" });
      return;
    }
    ctx.ask(null);
    sendRole(value);
  };

  const close = () => {
    const kind = asking;
    ctx.ask(null);
    (kind === "demote" ? selectRef : kind === "suspend" ? actionRef : trashRef).current?.focus();
  };

  // The select shows the requested role while it is out, and «Member» while the demotion is asked.
  const shownRole = roleWrite.isPending ? roleWrite.variables.role : asking === "demote" ? "MEMBER" : member.role;
  const offerRole = controls.role && !removing;
  const offerAction = controls.action !== null && !removing;
  const offerRemove = controls.remove && !removing;

  const question: { sentence: string; answer: string } | null =
    asking === "demote"
      ? demoteQuestion(subject.name, subject.self, sent)
      : asking === "suspend"
        ? { sentence: suspendQuestion(subject.name, ctx.company, sent), answer: "Suspend" }
        : asking === "remove"
          ? { sentence: removeQuestion(subject.name, ctx.company, suspended, suspended ? 0 : sent), answer: "Remove" }
          : null;
  const answerQuestion = () => {
    if (asking === "demote") sendRole("MEMBER");
    else if (asking === "suspend") sendState("SUSPENDED");
    else if (asking === "remove") sendRemove();
  };

  const secondLine = suspended ? (
    <>
      <strong>Suspended</strong>
      {member.email ? ` · ${member.email}` : null}
    </>
  ) : member.state !== null && member.state !== "ACTIVE" && member.state !== "SUSPENDED" ? (
    // A state this build does not know, printed as it came (§6).
    [member.state, member.email].filter(Boolean).join(" · ")
  ) : subject.named ? (
    member.email
  ) : (
    member.email ?? <span className="company-member-id">{member.userId}</span>
  );

  return (
    <li
      className={`company-member-row${suspended ? " is-suspended" : ""}`}
      data-row-key={rowKey}
      ref={rowRef}
      onKeyDown={(event) => {
        if (question !== null && event.key === "Escape") {
          event.preventDefault();
          if (!busy) close();
        }
      }}
    >
      <span aria-hidden="true" className="company-member-avatar">
        {/* Initials only (B7, N2): `avatarPath` has no route a picture could be loaded by. */}
        <Avatar
          hideInitials={!subject.named}
          label={subject.title}
          user={
            subject.named
              ? // One's own circle in the colour the rest of the app draws it in (X3); others by the id.
                { id: member.userId, displayName: subject.title, color: subject.self ? ctx.meColor : undefined, avatarUrl: null }
              : null
          }
        />
      </span>
      <div className="company-member-text">
        <p className="company-member-name" title={subject.title}>
          {subject.title}
          {subject.self && subject.named ? <span className="company-member-you"> (you)</span> : null}
        </p>
        <p className="company-member-line">
          {secondLine}
          {removing ? (
            <>
              {secondLine ? " · " : null}
              Being removed
            </>
          ) : null}
        </p>
      </div>
      <Controls
        action={
          offerAction ? (
            <button
              aria-controls={asking === "suspend" ? confirmId : undefined}
              aria-disabled={busy || undefined}
              aria-expanded={controls.action === "suspend" ? asking === "suspend" : undefined}
              aria-label={controls.action === "suspend" ? `Suspend ${subject.name}` : `Reactivate ${subject.name}`}
              className="company-member-ghost"
              onClick={() => {
                if (busy) return;
                ctx.clearRefusal();
                if (controls.action === "suspend") ctx.ask(asking === "suspend" ? null : { rowKey, kind: "suspend" });
                else sendState("ACTIVE");
              }}
              ref={actionRef}
              type="button"
            >
              {controls.action === "suspend" ? "Suspend" : "Reactivate"}
            </button>
          ) : null
        }
        destructive={
          offerRemove ? (
            <button
              aria-controls={asking === "remove" ? confirmId : undefined}
              aria-disabled={busy || undefined}
              aria-expanded={asking === "remove"}
              aria-label={`Remove ${subject.name} from ${ctx.company ?? "this company"}`}
              className="icon-button company-member-trash"
              onClick={() => {
                if (busy) return;
                ctx.clearRefusal();
                ctx.ask(asking === "remove" ? null : { rowKey, kind: "remove" });
              }}
              ref={trashRef}
              title="Remove from company"
              type="button"
            >
              <Trash2 aria-hidden="true" size={14} />
            </button>
          ) : null
        }
        manage={manage}
        role={
          offerRole ? (
            <select
              aria-busy={roleWrite.isPending || undefined}
              aria-controls={asking === "demote" ? confirmId : undefined}
              aria-disabled={busy || undefined}
              aria-label={`Role of ${subject.name}`}
              className="member-role-select"
              onChange={(event) => onPickRole(event.target.value)}
              ref={selectRef}
              value={shownRole ?? ""}
            >
              <option value="TENANT_ADMIN">Admin</option>
              <option value="MEMBER">Member</option>
            </select>
          ) : (
            <span className="company-member-role-word">{roleWord(member.role, member.isOwner)}</span>
          )
        }
      />
      {question ? (
        <Strip answer={question.answer} busy={busy} id={confirmId} onAnswer={answerQuestion} onCancel={close} sentence={question.sentence} />
      ) : null}
      {removal !== null && removal.stopped && removal.operation.state !== "SUCCEEDED" ? (
        <div className="company-member-check">
          <button className="company-member-ghost" onClick={() => void checkAgain()} type="button">
            Check again
          </button>
          {/* A removal Taska is checking by hand: its operation id, for support, as FAILED shows it. */}
          {removal.operation.state === "MANUAL_REVIEW" ? (
            <p className="error-note-detail">
              {operationDetail(removal.operation.state, removal.operation.id)}
            </p>
          ) : null}
        </div>
      ) : null}
      {refusalHere ? <RefusalNote refusal={refusalHere} /> : null}
    </li>
  );
}

function PendingRow({ invitation, ctx }: { invitation: Invitation; ctx: Section }) {
  const rowKey = `invitation:${invitation.id}`;
  const rowRef = useFocusOnLeave(rowKey, ctx.focusAfterLeaving);
  const email = invitation.email ?? "";
  const confirmId = useId();
  const resendRef = useRef<HTMLButtonElement>(null);
  const trashRef = useRef<HTMLButtonElement>(null);
  const intent = useRef<SentIntent | null>(null);
  const asking = ctx.asking?.rowKey === rowKey ? ctx.asking.kind : null;
  const refusalHere = ctx.refusal?.rowKey === rowKey ? ctx.refusal : null;
  const passed = invitation.expiresAt !== null && Date.parse(invitation.expiresAt) <= ctx.now;
  const words = { name: email, self: false, email, company: ctx.company };

  const refused = (action: MemberAction, error: unknown, focus: RefObject<HTMLElement | null>) => {
    if (intent.current && isIndefinite(error)) intent.current = { ...intent.current, open: true };
    ctx.ask(null);
    focus.current?.focus();
    ctx.refuse(rowKey, memberRefusalWords(action, error, words), error);
    void ctx.reread({ members: true, invitations: true, quotas: true });
  };

  const resend = useMutation({
    mutationFn: (key: string) => taskaApi.resendTenantInvitation(ctx.companyId, invitation.id, key),
    onSuccess: async (answer) => {
      intent.current = null;
      // Resend takes no seat: only the list is read again (§4.38).
      await ctx.reread({ invitations: true });
      ctx.say(resentStatus(email, answer.expiresAt ?? invitation.expiresAt));
    },
    onError: (error) => refused("resend", error, resendRef),
  });
  const revoke = useMutation({
    mutationFn: (vars: { version: string; key: string }) =>
      taskaApi.revokeTenantInvitation(ctx.companyId, invitation.id, vars.version, vars.key),
    onSuccess: async () => {
      intent.current = null;
      ctx.ask(null);
      ctx.focusAfterLeaving(rowKey);
      await ctx.reread({ invitations: true, quotas: true });
      ctx.say(revokedStatus(email));
    },
    onError: (error) => refused("revoke", error, trashRef),
  });
  const busy = resend.isPending || revoke.isPending;

  const sendResend = () => {
    if (busy) return;
    ctx.clearRefusal();
    const signature = `resend:${invitation.id}`;
    const key = keyFor(intent.current, signature);
    intent.current = { signature, key, open: false };
    resend.mutate(key);
  };
  const sendRevoke = () => {
    if (!isSendableVersion(invitation.version)) {
      void ctx.reread({ invitations: true });
      return;
    }
    const signature = `revoke:${invitation.version}`;
    const key = keyFor(intent.current, signature);
    intent.current = { signature, key, open: false };
    revoke.mutate({ version: invitation.version, key });
  };
  const close = () => {
    ctx.ask(null);
    trashRef.current?.focus();
  };

  return (
    <li
      className="company-member-row is-invitation"
      data-row-key={rowKey}
      ref={rowRef}
      onKeyDown={(event) => {
        if (asking === "revoke" && event.key === "Escape") {
          event.preventDefault();
          if (!busy) close();
        }
      }}
    >
      <span aria-hidden="true" className="company-member-avatar">
        <Avatar label={email} user={null} />
      </span>
      <div className="company-member-text">
        <p className="company-member-name is-email">{email}</p>
        <p className="company-member-line">{pendingLine(invitation, ctx.inviterName(invitation.createdBy), passed, new Date(ctx.now))}</p>
      </div>
      <Controls
        action={
          <button
            aria-disabled={busy || undefined}
            aria-label={`Resend the invitation to ${email}`}
            className="company-member-ghost"
            data-busy={resend.isPending || undefined}
            onClick={sendResend}
            ref={resendRef}
            type="button"
          >
            Resend
          </button>
        }
        destructive={
          <button
            aria-controls={asking === "revoke" ? confirmId : undefined}
            aria-disabled={busy || undefined}
            aria-expanded={asking === "revoke"}
            aria-label={`Revoke the invitation to ${email}`}
            className="icon-button company-member-trash"
            onClick={() => {
              if (busy) return;
              ctx.clearRefusal();
              ctx.ask(asking === "revoke" ? null : { rowKey, kind: "revoke" });
            }}
            ref={trashRef}
            title="Revoke invitation"
            type="button"
          >
            <Trash2 aria-hidden="true" size={14} />
          </button>
        }
        manage
        role={<span className="company-member-role-word">{roleWord(invitation.role)}</span>}
      />
      {asking === "revoke" ? (
        <Strip answer="Revoke" busy={busy} id={confirmId} onAnswer={sendRevoke} onCancel={close} sentence={revokeQuestion(email)} />
      ) : null}
      {refusalHere ? <RefusalNote refusal={refusalHere} /> : null}
    </li>
  );
}

function ExpiredRow({ invitation, ctx }: { invitation: Invitation; ctx: Section }) {
  const rowKey = `invitation:${invitation.id}`;
  const rowRef = useFocusOnLeave(rowKey, ctx.focusAfterLeaving);
  const email = invitation.email ?? "";
  const refusalHere = ctx.refusal?.rowKey === rowKey ? ctx.refusal : null;
  const role = isKnownMembershipRole(invitation.role) ? invitation.role : null;
  return (
    <li className="company-member-row is-invitation is-expired" data-row-key={rowKey} ref={rowRef}>
      <span aria-hidden="true" className="company-member-avatar">
        <Avatar label={email} user={null} />
      </span>
      <div className="company-member-text">
        <p className="company-member-name is-email">{email}</p>
        <p className="company-member-line">{expiredLine(invitation, ctx.inviterName(invitation.createdBy), new Date(ctx.now))}</p>
      </div>
      <Controls
        action={
          // The same modal, with the address, the role and the grants of the projects that still exist (§4.38).
          role !== null ? (
            <button
              aria-label={`Invite ${email} again`}
              className="company-member-ghost"
              onClick={() =>
                ctx.openInvite({
                  email,
                  role,
                  grants: invitation.projectGrants.flatMap((grant) =>
                    grant.role === "ADMIN" || grant.role === "MEMBER" || grant.role === "VIEWER"
                      ? [{ projectId: grant.projectId, role: grant.role as KnownProjectGrantRole }]
                      : [],
                  ),
                })
              }
              type="button"
            >
              Invite again
            </button>
          ) : null
        }
        destructive={null}
        manage
        role={<span className="company-member-role-word">{roleWord(invitation.role)}</span>}
      />
      {refusalHere ? <RefusalNote refusal={refusalHere} /> : null}
    </li>
  );
}

/* ---------------------------------------------------------------- leave */

function LeaveZone({
  company,
  asking,
  busy,
  sent,
  refusal,
  buttonRef,
  onAsk,
  onCancel,
  answer,
}: {
  company: string | null;
  asking: boolean;
  busy: boolean;
  sent: number;
  refusal: { text: string; words: string | null; requestId: string | null; detail: string | null } | null;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onAsk: () => void;
  onCancel: () => void;
  answer: () => void;
}) {
  const id = useId();
  return (
    <div
      className="company-leave"
      onKeyDown={(event) => {
        if (asking && event.key === "Escape") {
          event.preventDefault();
          if (!busy) onCancel();
        }
      }}
    >
      <div className="company-leave-row">
        <p className="company-leave-text">{leaveZoneText(company)}</p>
        <button
          aria-controls={asking ? id : undefined}
          aria-disabled={busy || undefined}
          aria-expanded={asking}
          className="secondary-button compact-button strip-trigger company-leave-button"
          onClick={() => {
            if (busy) return;
            if (asking) onCancel();
            else onAsk();
          }}
          ref={buttonRef}
          type="button"
        >
          Leave company
        </button>
      </div>
      {asking ? (
        <Strip
          answer="Leave company"
          busy={busy}
          className="company-leave-confirm"
          id={id}
          onAnswer={answer}
          onCancel={onCancel}
          sentence={leaveQuestion(company, sent)}
        />
      ) : null}
      {refusal ? (
        <ErrorNote requestId={refusal.requestId} serverWords={refusal.detail ?? refusal.words}>
          {refusal.text}
        </ErrorNote>
      ) : null}
    </div>
  );
}
