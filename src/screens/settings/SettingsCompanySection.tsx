import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { taskaApi } from "../../api/client";
import { apiErrorFacts, isWorkspaceClosed, refusalCode } from "../../api/errors";
import { isSendableVersion, type Membership } from "../../api/tenantMembers";
import { trimTenantName, withoutControlCharacters, TENANT_NAME_MAX, type Tenant } from "../../api/tenants";
import { ApiNotice } from "../../components/ApiNotice";
import { ErrorNote } from "../../components/ErrorNote";
import { useCompanies, useCompanyName, useWorkspace } from "../../hooks/useCompanies";
import { useMutation } from "../../hooks/useMutation";
import { TENANTS_QUERY_KEY, upsertTenant } from "../../lib/companies";
import { useAccountQueryClient, useCompanyAddress } from "../../lib/companyAddress";
import { ME_QUERY_KEY } from "../../lib/ownAvatarLink";
import {
  COMPANY_SUBSCRIPTION_KEY,
  companySubscriptionOptions,
  companyTenantKey,
  companyTenantOptions,
  handOverOf,
  memberName,
  type CompanyGeneralRouteState,
  type CompanyHandOver,
  type Recipient,
} from "./companyGeneral";
import {
  LOADING_TEXT,
  READ_FAILED_TEXT,
  REFRESH_FAILED_TEXT,
  formatPaidUntil,
  isLostAnswer,
  leadText,
  pauseQuestion,
  pauseRowText,
  pausedStatus,
  renameRefusalWords,
  renamedStatus,
  resumeRowText,
  resumedStatus,
  stateLines,
  transferRefusalWords,
  transferRowText,
  transferredStatus,
  zoneRefusalWords,
  type RefusalWords,
  type TransferOutcome,
  type ZoneAction,
} from "./companyGeneralText";
import { isIndefinite, keyFor } from "./companyMembers";
import { companyMembersOptions } from "./companyMembersQuery";
import { Strip } from "./SettingsMembersSection";
import { TransferOwnershipModal, type TransferRefusal } from "./TransferOwnershipModal";

/**
 * Settings › General (TAS-504, DESIGN.md §4.39) — the B2B build only: the
 * tab's company's name, owner and state for every role, and for its owner the
 * rename, the pause or resume, and the transfer.
 *
 * Against the B2B blueprint on the mock (docs/ai/API-DIVERGENCE.md
 * «TAS-504», api-contract-guard's design B1–B7, art-director's B1–B8):
 *
 * - **Who may change it** is `Tenant.ownerId` = the reader, and nothing else:
 *   no capability is read, nothing is inferred about FREE, paid coverage, a
 *   flag or what a restriction allows (B3). Pause and Transfer are always
 *   offered to the owner; the server's refusal decides, and a static sentence
 *   says the transfer's rule.
 * - **No write is optimistic** (B1): the name, the owner and the state change
 *   on screen only from a server's answer — a 200 `Tenant` goes into the
 *   company's cache and its row of the reader's list in one frame, and the
 *   list is read again.
 * - **One key per confirmed intent**: the same intent sent again after an
 *   answer that never came goes with the same key, body and `If-Match`; a 412
 *   is said and never retried with the new version.
 * - **The owner's subscription** is read only while the reader is the owner
 *   (B5) and dropped from the cache whenever the owner changes.
 * - **A transfer** ends in a re-entry of the company (the reader's own role
 *   in it changed, as TAS-502's ruling 3): the modal stays in flight through
 *   the 200, the re-entry and the new context's `getTenant`, which then shows
 *   the reader's non-owner view (art-director B6).
 */
export function SettingsCompanySection() {
  const address = useCompanyAddress();
  if (address?.companyId == null) return null;
  return <CompanyGeneral companyId={address.companyId} />;
}

const heading = () => document.querySelector<HTMLElement>(".settings-area .area-section-title");

/** Focus handed back after a write, ring drawn even after a pointer press (§5.9 «Успех»). */
function focusDrawn(node: HTMLElement | null | undefined) {
  if (!node) return;
  try {
    node.focus({ focusVisible: true } as FocusOptions);
  } catch {
    node.focus();
  }
}

/** An intent sent: its key, and the version and body it went with — what a retry after a lost answer repeats. */
interface Sent<T> {
  key: string;
  version: string;
  body: T;
  /** Its answer never came (or was a 429): the same intent goes again with the same key. */
  open: boolean;
}

/** A transfer refused: what the re-reads after it found, so the sentence can say it (§4.39). */
class TransferRefused extends Error {
  constructor(
    readonly outcome: TransferOutcome,
    readonly members: Membership[] | null,
  ) {
    super("");
    this.name = "TransferRefused";
  }
}

interface ShownRefusal extends RefusalWords {
  requestId: string | null;
  seq: number;
}

function CompanyGeneral({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const accountClient = useAccountQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const companies = useCompanies();
  const listedName = useCompanyName(companyId);
  const row = companies.data?.find((tenant) => tenant.id === companyId) ?? null;
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: () => taskaApi.getCurrentUser() });
  const meId = me.data?.id ?? null;
  const tenantQuery = useQuery(companyTenantOptions(companyId));
  const tenant = tenantQuery.data ?? null;
  const handOver = handOverOf(location.state);
  /** A transfer begun by the context before this one, still to be finished here (§4.39 «Успех»). */
  const continued = handOver !== null && workspace !== null && workspace.tenantSessionId !== handOver.fromSession;

  // Ownership: the server's answer; before it, the reader's list row, so the
  // owner's two reads go out together (api-contract-guard §2) — never across a
  // hand-over, where the list may still name the reader.
  const ownerId = tenant !== null ? tenant.ownerId : handOver === null ? (row?.ownerId ?? null) : null;
  const ownerGuess = meId !== null && ownerId === meId;
  const owner = tenant !== null && meId !== null && tenant.ownerId === meId;
  /**
   * Between a transfer's 200 and the re-entry this context is no longer the
   * owner's, though its cache still says so: nothing of the owner's is read
   * again (the subscription is dropped, B5), and the modal stays in flight.
   */
  const [handingOver, setHandingOver] = useState(false);
  const subscription = useQuery({ ...companySubscriptionOptions(companyId), enabled: ownerGuess && !handingOver });
  // The members list as already read (§4.38) — never a read for one name (ask A39).
  const cachedMembers = useQuery({ ...companyMembersOptions(companyId), enabled: false });
  const company = tenant?.name ?? listedName;

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const meIdRef = useRef(meId);
  const companyRef = useRef(company);
  useEffect(() => {
    meIdRef.current = meId;
    companyRef.current = company;
  });

  const [said, setSaid] = useState<{ text: string; seq: number } | null>(null);
  const say = useCallback((text: string) => setSaid((current) => ({ text, seq: (current?.seq ?? 0) + 1 })), []);
  /** The owner named after one's own transfer, once the new context's company confirmed it (§4.39). */
  const [knownOwner, setKnownOwner] = useState<Recipient | null>(null);
  const [transfer, setTransfer] = useState<{ chosenId: string | null; refusal: TransferRefusal | null } | null>(null);
  const transferButton = useRef<HTMLButtonElement>(null);
  const zoneButton = useRef<HTMLButtonElement>(null);

  /** A 200 `Tenant`: the company's cache and its row of the reader's list in one frame, then the list read again (B1, G2). */
  const applyTenant = useCallback(
    (answer: Tenant) => {
      queryClient.setQueryData(companyTenantKey(companyId), answer);
      accountClient?.setQueryData<Tenant[]>(TENANTS_QUERY_KEY, (list) => (list ? upsertTenant(list, answer) : list));
      void accountClient?.invalidateQueries({ queryKey: TENANTS_QUERY_KEY });
    },
    [accountClient, companyId, queryClient],
  );

  /** The company read again; `null` when it could not be (the page then keeps what it had, §4.39). */
  const rereadTenant = useCallback(async (): Promise<Tenant | null> => {
    try {
      return await queryClient.fetchQuery({ ...companyTenantOptions(companyId), staleTime: 0 });
    } catch {
      return null;
    }
  }, [companyId, queryClient]);

  const rereadMembers = useCallback(async (): Promise<Membership[] | null> => {
    try {
      return await queryClient.fetchQuery({ ...companyMembersOptions(companyId), staleTime: 0 });
    } catch {
      return null;
    }
  }, [companyId, queryClient]);

  /** The hand-over done: the owner named if the company confirms it, the status said once, focus on the heading, the entry replaced. */
  const finishHandOver = useCallback(
    (done: CompanyHandOver, answered: Tenant | null) => {
      if (done.recipient !== null && answered !== null && answered.ownerId === done.recipient.userId) setKnownOwner(done.recipient);
      setTransfer(null);
      setHandingOver(false);
      if (done.status !== null) say(done.status);
      heading()?.focus();
      navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
    },
    [location.pathname, location.search, navigate, say],
  );

  /**
   * The reader's place in the company changed — their own transfer, or
   * somebody else's seen through a 403 `OWNER_REQUIRED` (G6): the owner's
   * cache goes, the tab re-enters its company (a new context), and the page of
   * that context finishes. A re-entry that makes no new session keeps this
   * page, which follows the company read again.
   */
  const handOverTo = useCallback(
    async (recipient: Recipient | null, status: string | null, answer: Tenant | null = null) => {
      queryClient.removeQueries({ queryKey: COMPANY_SUBSCRIPTION_KEY });
      const fromSession = taskaApi.currentWorkspace()?.tenantSessionId ?? null;
      const done: CompanyHandOver = { fromSession, recipient, status };
      // A late answer after the reader moved away re-enters all the same, but
      // never pulls them back to this page.
      if (mounted.current) {
        navigate(
          { pathname: location.pathname, search: location.search },
          { replace: true, state: { companyHandOver: done } satisfies CompanyGeneralRouteState },
        );
      }
      try {
        await taskaApi.reenterCompany(companyId);
      } catch {
        // Nothing to add: the page below follows the company either way.
      }
      if (taskaApi.currentWorkspace()?.tenantSessionId !== fromSession) return;
      // Read again; failing that, the transfer's own 200 is what the server last said.
      let answered = await rereadTenant();
      if (answered === null && answer !== null) {
        queryClient.setQueryData(companyTenantKey(companyId), answer);
        answered = answer;
      }
      if (mounted.current) finishHandOver(done, answered);
    },
    [companyId, finishHandOver, location.pathname, location.search, navigate, queryClient, rereadTenant],
  );

  /** After a refusal (not a lost answer): the company read again; one now owned by somebody else is followed (G6). */
  const afterRefusal = useCallback(
    async (error: unknown) => {
      const reread = await rereadTenant();
      const reader = meIdRef.current;
      if (refusalCode(error) === "OWNER_REQUIRED" && reread !== null && reader !== null && reread.ownerId !== null && reread.ownerId !== reader) {
        // The list row follows the answer before the re-entry (G2), as after a command.
        applyTenant(reread);
        await handOverTo(null, null);
      }
    },
    [applyTenant, handOverTo, rereadTenant],
  );

  // The new context finishing a transfer begun before the re-entry: once its
  // page is drawn — the company and the reader answered — the modal goes in
  // the same frame, and the status and focus follow.
  const ready =
    tenant !== null && (!me.isPending || me.isError) && (!owner || handingOver || subscription.isSuccess || subscription.isError);
  const failedRead = tenantQuery.isError && tenant === null;
  const finished = useRef(false);
  useEffect(() => {
    if (!continued || handOver === null || finished.current || (!ready && !failedRead)) return;
    finished.current = true;
    // Read: the status and the owner's name, if the company confirms them. The
    // read failed: the modal goes and the route state is dropped with no status
    // and no name — nothing confirmed them; the failed read speaks instead (it
    // mounts while the hand-over is still the route's, as an alert).
    finishHandOver(ready ? handOver : { ...handOver, recipient: null, status: null }, ready ? tenant : null);
  }, [continued, failedRead, finishHandOver, handOver, ready, tenant]);
  const continuedModal = continued && !ready && !failedRead && handOver?.recipient ? handOver.recipient : null;

  /* ------------------------------------------------------------- rename */

  const renameIntent = useRef<Sent<string> | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [renameRefusal, setRenameRefusal] = useState<(ShownRefusal & { invalid: boolean }) | null>(null);
  const pencil = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const focusPencil = useRef<"plain" | "drawn" | null>(null);
  const rename = useMutation({
    mutationFn: (sent: Sent<string>) => taskaApi.renameTenant(companyId, sent.body, sent.version, sent.key),
    onSuccess: (answer, sent) => {
      renameIntent.current = null;
      applyTenant(answer);
      setRenameRefusal(null);
      focusPencil.current = "drawn";
      setEditing(false);
      say(renamedStatus(answer.name ?? sent.body));
    },
    onError: (error) => {
      const lost = isLostAnswer(error);
      if (renameIntent.current) renameIntent.current = isIndefinite(error) ? { ...renameIntent.current, open: true } : null;
      const words = renameRefusalWords(error, companyRef.current);
      setRenameRefusal((current) => ({
        ...words,
        requestId: apiErrorFacts(error).requestId,
        seq: (current?.seq ?? 0) + 1,
        invalid: refusalCode(error) === "VALIDATION_FAILED",
      }));
      if (!lost) void afterRefusal(error);
    },
  });
  const renaming = rename.isPending;
  const renameProblem = editing && trimTenantName(draft) === "" ? "Enter a company name." : null;

  useEffect(() => {
    if (editing) {
      const node = field.current;
      if (!node) return;
      node.focus();
      // The caret at the end, where a correction usually starts.
      node.setSelectionRange(node.value.length, node.value.length);
      return;
    }
    const how = focusPencil.current;
    focusPencil.current = null;
    if (how === "drawn") focusDrawn(pencil.current);
    else if (how === "plain") pencil.current?.focus();
  }, [editing]);

  const openRename = () => {
    setRenameRefusal(null);
    setDraft(tenant?.name ?? "");
    setEditing(true);
  };
  const closeRename = () => {
    if (renaming) return;
    setRenameRefusal(null);
    focusPencil.current = "plain";
    setEditing(false);
  };
  const submitRename = () => {
    if (renaming || renameProblem || tenant === null) return;
    const name = trimTenantName(draft);
    // An unchanged name sends nothing and closes the form, as Cancel (§4.39).
    if (name === tenant.name) {
      closeRename();
      return;
    }
    const previous = renameIntent.current;
    const again = previous !== null && previous.open && previous.body === name;
    const version = again ? previous.version : (tenant.version ?? "");
    if (!isSendableVersion(version)) {
      void rereadTenant();
      return;
    }
    const sent: Sent<string> = { key: again ? previous.key : keyFor(null, name), version, body: name, open: false };
    renameIntent.current = sent;
    // A new attempt takes the previous refusal away in the frame of the press, as pause and transfer do.
    setRenameRefusal(null);
    rename.mutate(sent);
  };

  /* ------------------------------------------------------ pause and resume */

  const zoneIntent = useRef<Sent<ZoneAction> | null>(null);
  const [asking, setAsking] = useState(false);
  const [zoneRefusal, setZoneRefusal] = useState<ShownRefusal | null>(null);
  const stripId = useId();
  const zone = useMutation({
    mutationFn: (sent: Sent<ZoneAction>) =>
      sent.body === "pause"
        ? taskaApi.pauseTenant(companyId, sent.version, sent.key)
        : taskaApi.resumeTenant(companyId, sent.version, sent.key),
    onSuccess: (answer, sent) => {
      zoneIntent.current = null;
      applyTenant(answer);
      setAsking(false);
      setZoneRefusal(null);
      // The row's button stays the same element (Pause ↔ Resume), so focus stays on it (§4.39).
      focusDrawn(zoneButton.current);
      const name = answer.name ?? companyRef.current;
      say(sent.body === "pause" ? pausedStatus(name) : resumedStatus(name));
    },
    onError: (error, sent) => {
      const lost = isLostAnswer(error);
      if (zoneIntent.current) zoneIntent.current = isIndefinite(error) ? { ...zoneIntent.current, open: true } : null;
      setAsking(false);
      const words = zoneRefusalWords(sent.body, error, companyRef.current);
      setZoneRefusal((current) => ({ ...words, requestId: apiErrorFacts(error).requestId, seq: (current?.seq ?? 0) + 1 }));
      // The box under the row is not live; the page's status says it (§4.39).
      say(words.text);
      zoneButton.current?.focus();
      // Not after an answer that never came: the next press repeats it with the same key (G7).
      if (!lost) void afterRefusal(error);
    },
  });
  const zoneBusy = zone.isPending;
  const sendZone = (action: ZoneAction) => {
    if (zoneBusy || tenant === null) return;
    const previous = zoneIntent.current;
    const again = previous !== null && previous.open && previous.body === action;
    const version = again ? previous.version : (tenant.version ?? "");
    if (!isSendableVersion(version)) {
      void rereadTenant();
      return;
    }
    const sent: Sent<ZoneAction> = { key: again ? previous.key : keyFor(null, action), version, body: action, open: false };
    zoneIntent.current = sent;
    setZoneRefusal(null);
    zone.mutate(sent);
  };

  /* ------------------------------------------------------------ transfer */

  const transferIntent = useRef<Sent<string> | null>(null);
  const transferMutation = useMutation({
    mutationFn: async (sent: Sent<string> & { recipient: Recipient }) => {
      const send = () => taskaApi.transferTenantOwnership(companyId, sent.body, sent.version, sent.key);
      let answer: Tenant | null = null;
      let refused: unknown = null;
      let lost = false;
      try {
        answer = await send();
      } catch (error) {
        if (isWorkspaceClosed(error)) throw error;
        if (isLostAnswer(error)) {
          // A lost answer is sent once more, the same key and body (api-contract-guard B4).
          lost = true;
          try {
            answer = await send();
          } catch (again) {
            if (isWorkspaceClosed(again)) throw again;
            refused = again;
          }
        } else {
          refused = error;
        }
      }
      if (answer === null) {
        // Refused, or lost twice: the company decides. A 403 OWNER_REQUIRED
        // is never by itself the success (ask A33).
        const reread = await rereadTenant();
        const reader = meIdRef.current;
        if (lost && reread !== null && reread.ownerId === sent.recipient.userId) {
          answer = reread;
        } else if (
          refusalCode(refused) === "OWNER_REQUIRED" &&
          reread !== null &&
          reread.ownerId !== null &&
          reader !== null &&
          reread.ownerId !== reader
        ) {
          // Somebody else's transfer (another tab): followed like one's own, without the status (G6);
          // the list row follows the answer first (G2).
          applyTenant(reread);
          await handOverTo(null, null);
          return;
        } else {
          const members = await rereadMembers();
          const state = members?.find((member) => member.userId === sent.recipient.userId)?.state ?? null;
          throw new TransferRefused(
            {
              error: refused,
              // A retry refused OWNER_REQUIRED after a loss says nothing either way (§4.39).
              unconfirmed: lost && (isLostAnswer(refused) || refusalCode(refused) === "OWNER_REQUIRED"),
              stillMine: reread === null ? null : reread.ownerId === reader,
              recipientState: state,
            },
            members,
          );
        }
      }
      // The 200 is the server's: the list row follows it now (G2), and the re-entry does the rest.
      transferIntent.current = null;
      setHandingOver(true);
      accountClient?.setQueryData<Tenant[]>(TENANTS_QUERY_KEY, (list) => (list && answer ? upsertTenant(list, answer) : list));
      void accountClient?.invalidateQueries({ queryKey: TENANTS_QUERY_KEY });
      await handOverTo(sent.recipient, transferredStatus(sent.recipient.name, companyRef.current), answer);
    },
    onError: (error, sent) => {
      const outcome: TransferOutcome =
        error instanceof TransferRefused ? error.outcome : { error, unconfirmed: false, stillMine: null, recipientState: null };
      if (transferIntent.current) {
        // An outcome nobody knows keeps the intent — the same key again; anything else is a new one.
        transferIntent.current = outcome.unconfirmed || isIndefinite(outcome.error) ? { ...transferIntent.current, open: true } : null;
      }
      const words = transferRefusalWords(outcome, sent.recipient.name, companyRef.current);
      const members = error instanceof TransferRefused ? error.members : null;
      const code = refusalCode(outcome.error);
      const gone = members !== null && !members.some((member) => member.userId === sent.recipient.userId);
      const inactive = outcome.recipientState !== null && outcome.recipientState !== "ACTIVE";
      setTransfer((current) =>
        current === null
          ? current
          : {
              chosenId: (code === "RESOURCE_NOT_FOUND" && gone) || (code === "INVALID_STATE" && inactive) ? null : current.chosenId,
              refusal: { ...words, requestId: apiErrorFacts(outcome.error).requestId, seq: (current.refusal?.seq ?? 0) + 1 },
            },
      );
    },
  });
  const transferBusy = transferMutation.isPending;
  const sendTransfer = (recipient: Recipient) => {
    if (transferBusy || tenant === null) return;
    const previous = transferIntent.current;
    const again = previous !== null && previous.open && previous.body === recipient.userId;
    const version = again ? previous.version : (tenant.version ?? "");
    if (!isSendableVersion(version)) {
      void rereadTenant();
      return;
    }
    const sent: Sent<string> = { key: again ? previous.key : keyFor(null, recipient.userId), version, body: recipient.userId, open: false };
    transferIntent.current = sent;
    setTransfer((current) => (current === null ? current : { ...current, refusal: null }));
    transferMutation.mutate({ ...sent, recipient });
  };

  /* --------------------------------------------------------------- render */

  const failed = failedRead;
  const paused = tenant?.restrictions.includes("OWNER_PAUSE") ?? false;
  const paidThrough = owner ? (subscription.data?.paidThrough ?? null) : null;
  const lines = tenant !== null ? stateLines(tenant.restrictions, owner) : [];
  const ownerRow = tenant?.ownerId ? cachedMembers.data?.find((member) => member.userId === tenant.ownerId) : undefined;
  const ownerName =
    knownOwner !== null && tenant?.ownerId === knownOwner.userId ? knownOwner.name : ownerRow ? memberName(ownerRow) : null;

  return (
    <>
      <div className="settings-plane">
        <div className="settings-column company-general">
          {ready ? (
            <>
              <p className="settings-lead">{leadText(company)}</p>
              {lines.length > 0 ? (
                <div className="company-general-states">
                  {lines.map((line) => (
                    <p className="company-general-state" key={line.code}>
                      <span className="company-general-state-fact">{line.fact}</span>
                      {line.explanation ? ` ${line.explanation}` : null}
                    </p>
                  ))}
                </div>
              ) : null}
              {tenantQuery.isError ? (
                <div className="company-general-refresh-failure">
                  <ApiNotice error={tenantQuery.error} live="off" words={false}>
                    {REFRESH_FAILED_TEXT}
                  </ApiNotice>
                </div>
              ) : null}
              <dl className="settings-details company-general-facts">
                <div>
                  <dt>Name</dt>
                  <dd>
                    {owner && editing ? (
                      <RenameForm
                        draft={draft}
                        fieldRef={field}
                        onCancel={closeRename}
                        onChange={(value) => setDraft(withoutControlCharacters(value))}
                        onSubmit={submitRename}
                        pending={renaming}
                        problem={renameProblem}
                        refusal={renameRefusal}
                      />
                    ) : (
                      <div className="company-general-name-row">
                        <span className="company-general-name">{tenant?.name ?? listedName ?? ""}</span>
                        {owner ? (
                          <button
                            aria-label="Rename company"
                            className="icon-button settings-name-edit company-general-rename"
                            onClick={openRename}
                            ref={pencil}
                            title="Rename"
                            type="button"
                          >
                            <Pencil aria-hidden="true" size={14} />
                          </button>
                        ) : null}
                      </div>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Owner</dt>
                  <dd>
                    {owner ? (
                      "You"
                    ) : ownerName !== null ? (
                      ownerName
                    ) : (
                      <Link className="admin-note-link" to="/settings/members">
                        See Members
                      </Link>
                    )}
                  </dd>
                </div>
                {paidThrough !== null ? (
                  <div>
                    <dt>Paid until</dt>
                    <dd>
                      <time dateTime={paidThrough}>{formatPaidUntil(paidThrough)}</time>
                    </dd>
                  </div>
                ) : null}
              </dl>

              {owner ? (
                <OwnerZone
                  asking={asking}
                  busy={zoneBusy}
                  company={company}
                  onAsk={() => {
                    setZoneRefusal(null);
                    setAsking(true);
                  }}
                  onCancel={() => {
                    setAsking(false);
                    zoneButton.current?.focus();
                  }}
                  onPause={() => sendZone("pause")}
                  onResume={() => sendZone("resume")}
                  onTransfer={() => {
                    setAsking(false);
                    setTransfer({ chosenId: null, refusal: null });
                  }}
                  paidThrough={paidThrough}
                  paused={paused}
                  refusal={zoneRefusal}
                  stripId={stripId}
                  transferRef={transferButton}
                  zoneRef={zoneButton}
                />
              ) : null}
            </>
          ) : failed ? (
            <div className="company-general-failure">
              {/* Found on arrival, not announced (§5.6) — unless it ends a transfer the reader is waiting on. */}
              <ApiNotice error={tenantQuery.error} live={continued ? "alert" : "off"} words={false}>
                {READ_FAILED_TEXT}
              </ApiNotice>
              <button
                aria-disabled={tenantQuery.isFetching || undefined}
                className="secondary-button company-general-retry"
                onClick={() => {
                  if (tenantQuery.isFetching) return;
                  void tenantQuery.refetch().then((result) => {
                    if (result.isSuccess) heading()?.focus();
                  });
                }}
                type="button"
              >
                Try again
              </button>
            </div>
          ) : (
            <GeneralLoading />
          )}

          {/* One persistent region, a node per sentence (§5.6): mounted with the
              section, so a screen reader is already listening when it speaks. */}
          <div className="visually-hidden" role="status">
            {said ? <span key={said.seq}>{said.text}</span> : null}
          </div>
        </div>
      </div>
      {transfer !== null && (owner || handingOver) ? (
        <TransferOwnershipModal
          busy={transferBusy}
          chosenId={transfer.chosenId}
          company={company}
          companyId={companyId}
          meId={meId}
          onChoose={(userId) => setTransfer((current) => (current === null ? current : { ...current, chosenId: userId }))}
          onClose={() => {
            // ✕ and the scrim close nothing mid-transfer: its answer is still to be said here.
            if (transferBusy || handingOver) return;
            setTransfer(null);
            transferButton.current?.focus();
          }}
          onConfirm={sendTransfer}
          refusal={transfer.refusal}
        />
      ) : null}
      {continuedModal !== null ? (
        <TransferOwnershipModal
          busy
          chosenId={continuedModal.userId}
          company={company}
          companyId={companyId}
          frozen={continuedModal}
          meId={meId}
          onChoose={() => undefined}
          onClose={() => undefined}
          onConfirm={() => undefined}
          refusal={null}
        />
      ) : null}
    </>
  );
}

/** Three rows of the facts, as bars (§4.39 «Загрузка»): no lead, no zone, no spinner. */
function GeneralLoading() {
  return (
    <div aria-busy="true" className="company-general-loading">
      <span className="visually-hidden" role="status">
        {LOADING_TEXT}
      </span>
      <div aria-hidden="true" className="settings-details company-general-facts">
        {[0, 1, 2].map((index) => (
          <div key={index}>
            <span className="value-skeleton company-general-skeleton-label" />
            <span className="value-skeleton company-general-skeleton-value" />
          </div>
        ))}
      </div>
    </div>
  );
}

function RenameForm({
  draft,
  fieldRef,
  pending,
  problem,
  refusal,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: string;
  fieldRef: RefObject<HTMLInputElement | null>;
  pending: boolean;
  problem: string | null;
  refusal: (ShownRefusal & { invalid: boolean }) | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const reasonId = useId();
  return (
    <form
      className="company-general-rename-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <input
        aria-describedby={problem ? reasonId : undefined}
        aria-invalid={problem || refusal?.invalid ? true : undefined}
        aria-label="Company name"
        autoComplete="off"
        className="settings-name-input"
        maxLength={TENANT_NAME_MAX}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // Neither key acts while an IME is composing, nor while the write is out.
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        readOnly={pending}
        ref={fieldRef}
        spellCheck={false}
        value={draft}
      />
      {problem ? (
        <p className="settings-name-reason" id={reasonId}>
          {problem}
        </p>
      ) : null}
      <div className="settings-name-actions">
        {/* §4.1's two kinds of `aria-disabled`: steadily unavailable while the
            name has a reason (dimmed), in flight while the write is out. */}
        <button
          aria-disabled={pending || problem ? true : undefined}
          className={`primary-button compact-button${problem ? " is-unavailable" : ""}`}
          type="submit"
        >
          Save
        </button>
        <button aria-disabled={pending || undefined} className="secondary-button compact-button" onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
      {refusal ? (
        <ErrorNote key={refusal.seq} live="alert" requestId={refusal.requestId} serverWords={refusal.words}>
          {refusal.text}
        </ErrorNote>
      ) : null}
    </form>
  );
}

/** The owner's two rows (§4.39 «Управление»): Pause or Resume, and Transfer ownership. */
function OwnerZone({
  company,
  paused,
  paidThrough,
  asking,
  busy,
  refusal,
  stripId,
  zoneRef,
  transferRef,
  onAsk,
  onCancel,
  onPause,
  onResume,
  onTransfer,
}: {
  company: string | null;
  paused: boolean;
  paidThrough: string | null;
  asking: boolean;
  busy: boolean;
  refusal: ShownRefusal | null;
  stripId: string;
  zoneRef: RefObject<HTMLButtonElement | null>;
  transferRef: RefObject<HTMLButtonElement | null>;
  onAsk: () => void;
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
  onTransfer: () => void;
}) {
  const open = asking && !paused;
  return (
    <div className="company-general-zone">
      <div
        className="company-general-zone-row"
        onKeyDown={(event) => {
          if (open && event.key === "Escape") {
            event.preventDefault();
            if (!busy) onCancel();
          }
        }}
      >
        <div className="company-general-zone-line">
          <p className="company-general-zone-text">{paused ? resumeRowText(company) : pauseRowText(company)}</p>
          {/* One element for both, so focus stays on it when the answer turns Pause into Resume. */}
          <button
            aria-controls={open ? stripId : undefined}
            aria-disabled={busy || undefined}
            aria-expanded={paused ? undefined : open}
            className="secondary-button compact-button strip-trigger company-general-zone-button"
            onClick={() => {
              if (busy) return;
              if (paused) onResume();
              else if (open) onCancel();
              else onAsk();
            }}
            ref={zoneRef}
            type="button"
          >
            {paused ? "Resume company" : "Pause company"}
          </button>
        </div>
        {open ? (
          <Strip
            answer="Pause company"
            busy={busy}
            className="company-general-pause-confirm"
            id={stripId}
            onAnswer={onPause}
            onCancel={onCancel}
            sentence={pauseQuestion(company, paidThrough)}
          />
        ) : null}
        {refusal ? (
          <ErrorNote key={refusal.seq} requestId={refusal.requestId} serverWords={refusal.words}>
            {refusal.text}
          </ErrorNote>
        ) : null}
      </div>
      <div className="company-general-zone-row">
        <div className="company-general-zone-line">
          <p className="company-general-zone-text">{transferRowText(company)}</p>
          <button
            aria-haspopup="dialog"
            className="secondary-button compact-button company-general-zone-button"
            onClick={onTransfer}
            ref={transferRef}
            type="button"
          >
            Transfer ownership
          </button>
        </div>
      </div>
    </div>
  );
}
