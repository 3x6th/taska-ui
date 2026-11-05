import { useQuery } from "@tanstack/react-query";
import { useId, useRef } from "react";
import { apiErrorFacts } from "../../api/errors";
import { ErrorNote } from "../../components/ErrorNote";
import { Modal } from "../../components/Modal";
import { recipientLabel, transferCandidates, type Recipient } from "./companyGeneral";
import {
  TRANSFER_HINT,
  TRANSFER_MEMBERS_FAILED,
  TRANSFER_MEMBERS_LOADING,
  transferConsequences,
  transferNoneText,
  type RefusalWords,
} from "./companyGeneralText";
import { companyMembersOptions } from "./companyMembersQuery";

/** The modal's refusal: the sentence, the detail line, and the attempt it answers (the box remounts per attempt). */
export interface TransferRefusal extends RefusalWords {
  requestId: string | null;
  seq: number;
}

/**
 * «Transfer ownership» (TAS-504, DESIGN.md §4.39, §4.11): who becomes the
 * owner, what that does to the reader — roles, finance, autopay, said only as
 * far as they are true — and the answer in §4.22's recipe, not primary: for
 * the reader it cannot be undone. No OTP and no second question (D248).
 *
 * The people come from the members list already read (§4.38), else from one
 * read when the modal opens; never a search, never a read per person
 * (api-contract-guard B4). The section holds the choice and the write: the
 * write runs through the company's re-entry, and `frozen` is this same modal
 * drawn again by the new context while that chain is still out.
 */
export function TransferOwnershipModal({
  companyId,
  company,
  meId,
  chosenId,
  onChoose,
  busy,
  refusal,
  onConfirm,
  onClose,
  frozen = null,
}: {
  companyId: string;
  company: string | null;
  meId: string | null;
  chosenId: string | null;
  onChoose: (userId: string) => void;
  busy: boolean;
  refusal: TransferRefusal | null;
  onConfirm: (recipient: Recipient) => void;
  onClose: () => void;
  /** The recipient of a transfer still in flight across a re-entry: the only option, nothing read. */
  frozen?: Recipient | null;
}) {
  const fieldId = useId();
  const hintId = useId();
  const select = useRef<HTMLSelectElement>(null);
  // The list already read is enough: `staleTime` keeps a cached one from being read again on open.
  const members = useQuery({ ...companyMembersOptions(companyId), enabled: frozen === null, staleTime: Number.POSITIVE_INFINITY });
  const candidates = frozen !== null ? [frozen] : transferCandidates(members.data, meId);
  const chosen = candidates.find((candidate) => candidate.userId === chosenId) ?? null;
  const unavailable = chosen === null;
  const consequences = transferConsequences(chosen === null ? null : { name: chosen.name, role: chosen.role }, company);

  const confirm = () => {
    if (busy) return;
    if (chosen === null) {
      select.current?.focus();
      return;
    }
    onConfirm(chosen);
  };

  let field;
  if (frozen === null && members.isPending) {
    field = (
      <p className="company-transfer-note" role="status">
        {TRANSFER_MEMBERS_LOADING}
      </p>
    );
  } else if (frozen === null && members.isError && !members.data) {
    field = (
      <div className="company-transfer-failure">
        <ErrorNote requestId={apiErrorFacts(members.error).requestId}>{TRANSFER_MEMBERS_FAILED}</ErrorNote>
        <button
          aria-disabled={members.isFetching || undefined}
          className="secondary-button compact-button company-transfer-retry"
          onClick={() => {
            if (!members.isFetching) void members.refetch();
          }}
          type="button"
        >
          Try again
        </button>
      </div>
    );
  } else if (candidates.length === 0) {
    field = <p className="company-transfer-note">{transferNoneText(company)}</p>;
  } else {
    field = (
      <div className="company-transfer-field">
        <label htmlFor={fieldId}>New owner</label>
        {/* A value, not text-work (§4.11): Esc still closes. */}
        <select
          aria-describedby={hintId}
          aria-disabled={busy || undefined}
          autoFocus
          className="company-transfer-select"
          id={fieldId}
          onChange={(event) => {
            if (!busy) onChoose(event.target.value);
          }}
          ref={select}
          value={chosen?.userId ?? ""}
        >
          <option disabled value="">
            Choose a member
          </option>
          {candidates.map((candidate) => (
            <option key={candidate.userId} value={candidate.userId}>
              {recipientLabel(candidate)}
            </option>
          ))}
        </select>
        <p className="company-transfer-hint" id={hintId}>
          {TRANSFER_HINT}
        </p>
      </div>
    );
  }

  return (
    <Modal busy={busy} continued={frozen !== null} onClose={onClose} title="Transfer ownership">
      <div
        className="company-transfer-body"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            confirm();
          }
        }}
      >
        {field}
        <div className="company-transfer-consequences">
          {consequences.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p className="company-transfer-rule">{consequences.rule}</p>
        </div>
        {refusal ? (
          <ErrorNote key={refusal.seq} live="alert" requestId={refusal.requestId} serverWords={refusal.words}>
            {refusal.text}
          </ErrorNote>
        ) : null}
        <div className="modal-actions">
          <button
            aria-disabled={busy || undefined}
            className="secondary-button company-transfer-cancel"
            onClick={() => {
              if (!busy) onClose();
            }}
            type="button"
          >
            Cancel
          </button>
          {/* §4.22's answer, not primary: for the reader this cannot be undone. Steadily unavailable until a choice. */}
          <button
            aria-disabled={busy || unavailable || undefined}
            className={`secondary-button member-confirm-accept company-transfer-confirm${unavailable && !busy ? " is-unavailable" : ""}`}
            data-busy={busy || undefined}
            onClick={confirm}
            type="button"
          >
            Transfer ownership
          </button>
        </div>
      </div>
    </Modal>
  );
}
