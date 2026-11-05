import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { taskaApi } from "../../api/client";
import { apiErrorFacts } from "../../api/errors";
import {
  INVITATION_EMAIL_MAX,
  PROJECT_GRANT_ROLES,
  invitationEmailProblem,
  sameInvitationEmail,
  trimInvitationEmail,
  type CreateInvitationInput,
  type Invitation,
  type Membership,
  type KnownMembershipRole,
  type KnownProjectGrantRole,
  type Seats,
} from "../../api/tenantMembers";
import { ErrorNote } from "../../components/ErrorNote";
import { Modal } from "../../components/Modal";
import { useMutation } from "../../hooks/useMutation";
import { keyBadgeStyle } from "../../lib/format";
import { isIndefinite, keyFor, type SentIntent } from "./companyMembers";
import { COMPANY_INVITATIONS_KEY, COMPANY_MEMBERS_KEY } from "./companyMembersQuery";
import { inviteHeadText, inviteRefusalWords } from "./companyMembersText";
import { QUOTA_WRITE_META } from "./companyPlan";

/** What the modal opens with: empty for «Invite a member», the expired row's for «Invite again» (§4.38). */
export interface InviteDraft {
  email: string;
  role: KnownMembershipRole;
  grants: ReadonlyArray<{ projectId: string; role: KnownProjectGrantRole }>;
}

const ROLE_OPTIONS: ReadonlyArray<{ value: KnownMembershipRole; label: string; description: string }> = [
  { value: "MEMBER", label: "Member", description: "Works in the projects they’re added to." },
  { value: "TENANT_ADMIN", label: "Admin", description: "Manages members and invitations, and is an admin in every project." },
];

const GRANT_LABELS: Record<KnownProjectGrantRole, string> = { ADMIN: "Admin", MEMBER: "Member", VIEWER: "Viewer" };

/**
 * «Invite a member» (DESIGN.md §4.38 «Приглашение», TAS-502): the address,
 * the company role, and for a Member the projects with a role in each. The
 * seat the invitation holds is the server's to grant — a full company is
 * answered 422 — so nothing here is disabled by the seat snapshot.
 *
 * **One key per intent**: the same body sent again after an answer that never
 * came goes with the same key, so it can never create a second invitation; a
 * changed body, or a retry after a refusal, is a new intent. A 201 closes the
 * dialog and hands the answer to the section, which puts it first in «Pending
 * invitations» and reads the list and the seats again.
 */
export function InviteMemberModal({
  companyId,
  company,
  seats,
  draft,
  onClose,
  onInvited,
}: {
  companyId: string;
  company: string | null;
  seats: Seats | null;
  draft: InviteDraft | null;
  onClose: () => void;
  onInvited: (invitation: Invitation) => void;
}) {
  const formId = useId();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState(draft?.email ?? "");
  const [role, setRole] = useState<KnownMembershipRole>(draft?.role ?? "MEMBER");
  /** The chosen projects and their roles — remembered while the role is Admin, until the dialog closes. */
  const [chosen, setChosen] = useState<Readonly<Record<string, KnownProjectGrantRole>>>(() =>
    Object.fromEntries((draft?.grants ?? []).map((grant) => [grant.projectId, grant.role])),
  );
  const [attempt, setAttempt] = useState(0);
  const intent = useRef<SentIntent | null>(null);
  // The company's projects from the cache when Projects has been open; asked otherwise.
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => taskaApi.listProjects() });
  const available = (projects.data ?? []).filter((project) => !project.archivedAt);

  const write = useMutation({
    mutationFn: (vars: { input: CreateInvitationInput; key: string }) =>
      taskaApi.createTenantInvitation(companyId, vars.input, vars.key),
    onSuccess: (invitation) => {
      intent.current = null;
      onInvited(invitation);
    },
    onError: (error) => {
      if (intent.current && isIndefinite(error)) intent.current = { ...intent.current, open: true };
    },
    // A refused invitation re-reads the company's plan reads, the snapshot with them (TAS-512, B4):
    // the seats a `QUOTA_EXCEEDED` makes the section read again are that one read — the gate's
    // (`CompanyGate`), never a second of this dialog's own (api-contract-guard N2).
    meta: QUOTA_WRITE_META,
  });

  const trimmed = trimInvitationEmail(email);
  const empty = invitationEmailProblem(email) === "empty";
  const sending = write.isPending;

  const submit = () => {
    if (sending || empty) return;
    const projectGrants =
      role === "MEMBER"
        ? available.filter((project) => chosen[project.id] !== undefined).map((project) => ({ projectId: project.id, role: chosen[project.id] }))
        : [];
    const input: CreateInvitationInput = { email: trimmed, role, projectGrants };
    const signature = JSON.stringify(input);
    const key = keyFor(intent.current, signature);
    intent.current = { signature, key, open: false };
    setAttempt((value) => value + 1);
    write.mutate({ input, key });
  };

  // Cmd/Ctrl+Enter sends from anywhere in the dialog (§4.11).
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submitRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // What the page has read about the address sent, to word an INVALID_STATE (art-director N-c).
  const sentEmail = write.variables?.input.email ?? trimmed;
  // A refusal that appears is brought into view (at 320 with a few projects it lands below the fold).
  const refusalBox = useRef<HTMLDivElement>(null);
  const refused = write.isError;
  useEffect(() => {
    if (refused) refusalBox.current?.scrollIntoView({ block: "nearest" });
  }, [refused, attempt]);
  const refusal = write.isError
    ? inviteRefusalWords(write.error, {
        email: sentEmail,
        company,
        member: (queryClient.getQueryData<Membership[]>(COMPANY_MEMBERS_KEY) ?? []).some(
          (row) => (row.state === "ACTIVE" || row.state === "SUSPENDED") && sameInvitationEmail(row.email, sentEmail),
        ),
        pending: (queryClient.getQueryData<Invitation[]>(COMPANY_INVITATIONS_KEY) ?? []).some(
          (row) => row.state === "PENDING" && sameInvitationEmail(row.email, sentEmail),
        ),
        // A QUOTA_EXCEEDED quotes the seat limit only from the snapshot already read (§4.38, TAS-512).
        seats,
      })
    : null;

  return (
    <Modal busy={sending} onClose={onClose} title="Invite a member">
      <form
        className="form-stack company-invite-form"
        // The server judges the address; the browser's bubble would answer first, in other words.
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="company-invite-head">{inviteHeadText(company, seats)}</p>

        <div className="field">
          <label htmlFor={`${formId}-email`}>Email</label>
          {/* A value, not text-work (§4.11): Esc still closes. */}
          <input
            aria-describedby={`${formId}-email-hint`}
            autoComplete="off"
            autoFocus
            id={`${formId}-email`}
            maxLength={INVITATION_EMAIL_MAX}
            onChange={(event) => setEmail(event.target.value)}
            readOnly={sending}
            spellCheck={false}
            type="email"
            value={email}
          />
          <p className="admin-field-hint" id={`${formId}-email-hint`}>
            {empty ? "Enter an email address." : ""}
          </p>
        </div>

        <fieldset className="token-access">
          <legend>Role</legend>
          <div className="token-access-options">
            {ROLE_OPTIONS.map((option) => (
              <label className="token-access-option" key={option.value}>
                <input
                  aria-describedby={`${formId}-${option.value}-description`}
                  aria-labelledby={`${formId}-${option.value}-title`}
                  checked={role === option.value}
                  name={`${formId}-role`}
                  onChange={() => {
                    if (!sending) setRole(option.value);
                  }}
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

        {role === "TENANT_ADMIN" ? (
          <p className="company-invite-note">Admins are admins in every project, so no projects are chosen here.</p>
        ) : (
          <fieldset className="token-access company-invite-projects">
            <legend>Projects (optional)</legend>
            {projects.isPending ? (
              <span aria-hidden="true" className="value-skeleton company-invite-projects-skeleton" />
            ) : projects.isError && !projects.data ? (
              <p className="company-invite-note">
                Projects could not be loaded, so none can be chosen here. You can add people to projects later.
              </p>
            ) : available.length === 0 ? (
              <p className="company-invite-note">
                {company ?? "This company"} has no projects yet. You can add people to projects later.
              </p>
            ) : (
              <ul className="company-invite-project-list">
                {available.map((project) => {
                  const grant = chosen[project.id];
                  return (
                    <li className="company-invite-project" key={project.id}>
                      <label className="company-invite-project-label">
                        <input
                          checked={grant !== undefined}
                          onChange={(event) => {
                            if (sending) return;
                            const on = event.target.checked;
                            setChosen((current) => {
                              const next = { ...current };
                              if (on) next[project.id] = "MEMBER";
                              else delete next[project.id];
                              return next;
                            });
                          }}
                          type="checkbox"
                        />
                        <span className="key-badge" style={keyBadgeStyle(project.projectKey, project.color)}>
                          {project.projectKey}
                        </span>
                        <span className="company-invite-project-name">{project.name}</span>
                      </label>
                      {grant !== undefined ? (
                        <select
                          aria-label={`Role in ${project.name}`}
                          className="member-role-select"
                          onChange={(event) => {
                            const value = event.target.value as KnownProjectGrantRole;
                            if (!sending) setChosen((current) => ({ ...current, [project.id]: value }));
                          }}
                          value={grant}
                        >
                          {PROJECT_GRANT_ROLES.map((option) => (
                            <option key={option} value={option}>
                              {GRANT_LABELS[option]}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>
        )}

        {refusal ? (
          <ErrorNote
            key={attempt}
            live="alert"
            ref={refusalBox}
            requestId={apiErrorFacts(write.error).requestId}
            serverWords={refusal.words}
          >
            {refusal.text}
          </ErrorNote>
        ) : null}

        <div className="modal-actions">
          <button
            aria-disabled={sending || undefined}
            className="secondary-button"
            onClick={() => {
              if (!sending) onClose();
            }}
            type="button"
          >
            Cancel
          </button>
          <button
            aria-describedby={empty ? `${formId}-email-hint` : undefined}
            aria-disabled={sending || empty || undefined}
            className={`primary-button company-invite-submit${empty && !sending ? " is-unavailable" : ""}`}
            data-busy={sending || undefined}
            type="submit"
          >
            Send invitation
          </button>
        </div>
      </form>
    </Modal>
  );
}
