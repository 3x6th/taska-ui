import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import type { EmailChangeChallenge } from "../../api/accountCredentials";
import { apiErrorFacts, reportable } from "../../api/errors";
import { taskaApi } from "../../api/client";
import { ErrorNote } from "../../components/ErrorNote";
import { useMutation } from "../../hooks/useMutation";
import { usePressKeys } from "../../hooks/usePressKeys";
import { ME_QUERY_KEY } from "../../lib/ownAvatarLink";
import { FORGOT_PASSWORD_ROUTE } from "../../lib/recoveryLink";
import {
  CODE_HINT,
  DEAD_CODE_TEXT,
  EMAIL_CHANGED_TEXT,
  NEW_PASSWORD_HINT,
  PASSWORD_CHANGED_TEXT,
  codeSentText,
  isDeadCode,
  normalizeCode,
  violatedFields,
  type FormField,
} from "../accountText";
import { CredentialRefusal, PasswordField } from "../credentialFields";
import type { ForgotPasswordState } from "../ForgotPasswordScreen";

type Form = "email" | "password";

/** Where focus goes once a form has given way to its trigger again (art-director B13). */
interface Refocus {
  target: Form;
  /** After a 204 the ring is drawn whatever pressed the button (`focusVisible: true`); after Cancel and Esc, not. */
  visible: boolean;
}

const EMAIL_FIELDS: readonly FormField[] = [
  { name: "newEmail", label: "New email" },
  { name: "currentPassword", label: "Current password" },
];
const CODE_FIELDS: readonly FormField[] = [{ name: "code", label: "Code" }];
const PASSWORD_FIELDS: readonly FormField[] = [
  { name: "currentPassword", label: "Current password" },
  { name: "newPassword", label: "New password" },
];

/**
 * Settings › Account (TAS-527, art-director B1, B6–B13, B16): the email and
 * the password that sign the reader in to every company — a personal section
 * of the companies build, for every role, gated by nothing the company says.
 *
 * Two rows, one form open at a time (B10). The email changes in two steps, by
 * the 8-digit code the server mails to the new address (the contract's, not
 * the story's link — orchestrator decision 1); the current password is
 * cleared from memory on the 201 and the challenge is held in memory only
 * (B9). **Nothing is optimistic** (B11): the address shown is always
 * `GET /users/me`'s, read again on the 204 in this tab and every other of the
 * account (`onAccountChanged`, wired at the shell). The password change is one
 * step. Both commands go with the account session, from inside the company.
 *
 * No request of its own on first paint: the account is `["me"]`, which the
 * Settings shell has already asked for.
 */
export function SettingsAccountSection() {
  const meQuery = useQuery({ queryKey: ME_QUERY_KEY, queryFn: () => taskaApi.getCurrentUser() });
  const user = meQuery.data;
  const [open, setOpen] = useState<Form | null>(null);
  /** A form's write is out: the other trigger refuses too, so nothing is dropped mid-flight. */
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<{ key: number; text: string } | null>(null);
  const [refocus, setRefocus] = useState<Refocus | null>(null);
  const emailTrigger = useRef<HTMLButtonElement>(null);
  const passwordTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (refocus === null) return;
    const trigger = refocus.target === "email" ? emailTrigger.current : passwordTrigger.current;
    if (!trigger) return;
    if (!refocus.visible) {
      trigger.focus();
      return;
    }
    try {
      trigger.focus({ focusVisible: true });
    } catch {
      trigger.focus();
    }
  }, [refocus]);

  /** A trigger: the line a success left goes (B11), and the other form with what was typed in it (B10). */
  const openForm = (form: Form) => {
    if (busy) return;
    setSuccess(null);
    setRefocus(null);
    setOpen(form);
  };
  const closeForm = (form: Form, visible: boolean) => {
    setOpen(null);
    setRefocus({ target: form, visible });
  };
  const finished = (form: Form, text: string) => {
    setSuccess((last) => ({ key: (last?.key ?? 0) + 1, text }));
    closeForm(form, true);
  };

  return (
    <div className="settings-plane">
      <div className="settings-column settings-account">
        <p className="settings-lead">This email and password sign you in to every company you belong to.</p>
        <ul className="settings-rows">
          <li className="settings-row">
            <div className="settings-row-text">
              <h2 className="settings-row-title">Email</h2>
              {user ? (
                <p className="settings-row-description settings-account-email">{user.email}</p>
              ) : meQuery.isError ? (
                // A state found on arrival, not an answer to a press: not live.
                <p className="settings-account-unloaded">Your email could not be loaded.</p>
              ) : (
                <p aria-busy="true" className="settings-row-description">
                  <span aria-hidden="true" className="value-skeleton settings-account-skeleton" />
                  <span className="visually-hidden">Loading your email</span>
                </p>
              )}
            </div>
            {user && open !== "email" ? (
              <button
                aria-disabled={busy || undefined}
                className="secondary-button compact-button settings-account-trigger"
                onClick={() => openForm("email")}
                ref={emailTrigger}
                type="button"
              >
                Change email
              </button>
            ) : null}
            {user && open === "email" ? (
              <EmailChangeForm
                email={user.email}
                onCancel={() => closeForm("email", false)}
                onDone={() => finished("email", EMAIL_CHANGED_TEXT)}
                onPending={setBusy}
              />
            ) : null}
          </li>
          <li className="settings-row">
            <div className="settings-row-text">
              <h2 className="settings-row-title">Password</h2>
              <p className="settings-row-description">Changing it needs your current password.</p>
            </div>
            {open !== "password" ? (
              <button
                aria-disabled={busy || undefined}
                className="secondary-button compact-button settings-account-trigger"
                onClick={() => openForm("password")}
                ref={passwordTrigger}
                type="button"
              >
                Change password
              </button>
            ) : (
              <PasswordChangeForm
                email={user?.email ?? null}
                onCancel={() => closeForm("password", false)}
                onDone={() => finished("password", PASSWORD_CHANGED_TEXT)}
                onPending={setBusy}
              />
            )}
          </li>
        </ul>
        {/* Mounted with the section and never re-mounted, so a success is a
            change to announce; keyed inside, so the same line twice is said
            twice. Empty, it is out of the flow (B11). */}
        <p className="settings-account-success" role="status">
          {success ? <span key={success.key}>{success.text}</span> : null}
        </p>
      </div>
    </div>
  );
}

/** Enter submits — never while an IME composes — and Esc is Cancel, while nothing is in flight (B13). */
function formKeys(pending: boolean, cancel: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (!pending) cancel();
  };
}

/** The ids a form's refusal lines and reasons carry, per field. */
function useFieldIds() {
  const base = useId();
  return {
    field: (name: string) => `${base}-${name}`,
    reason: (name: string) => `${base}-${name}-reason`,
    line: (name: string) => `${base}-${name}-line`,
  };
}

/** `aria-describedby` from the parts that are on screen, in order. */
const describedBy = (...ids: Array<string | null | false>) => ids.filter(Boolean).join(" ") || undefined;

function ForgotCurrentPassword({ email }: { email: string | null }) {
  return (
    <Link
      className="admin-note-link settings-account-forgot"
      state={(email ? { email } : {}) satisfies ForgotPasswordState}
      to={FORGOT_PASSWORD_ROUTE}
    >
      Forgot your current password?
    </Link>
  );
}

/**
 * Change email (B9): step 1 — New email, Current password — then the code
 * step, with the sentence of where the code went, Code, Change email, Start
 * over and Cancel. A dead code (422 `CONFIRMATION_EXPIRED`, 404) takes the
 * code step's field and buttons for «Start over» and «Cancel».
 */
function EmailChangeForm({
  email,
  onCancel,
  onDone,
  onPending,
}: {
  email: string;
  onCancel: () => void;
  onDone: () => void;
  onPending: (pending: boolean) => void;
}) {
  const [step, setStep] = useState<"start" | "code" | "dead">("start");
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [code, setCode] = useState("");
  /** In memory only (B9): what the code confirms, and the sentence drawn from it when it came — static. */
  const [challenge, setChallenge] = useState<{ value: EmailChangeChallenge; sentence: string } | null>(null);
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const [focus, setFocus] = useState<{ target: "newEmail" | "currentPassword" | "code" | "dead" } | null>({ target: "newEmail" });
  const newEmailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const deadRef = useRef<HTMLDivElement>(null);
  const ids = useFieldIds();
  const sentId = useId();
  const startKeys = usePressKeys();
  const confirmKeys = usePressKeys();

  const start = useMutation({
    mutationFn: (input: { newEmail: string; currentPassword: string; key: string }) =>
      taskaApi.requestAccountEmailChange(input.newEmail, input.currentPassword, input.key),
    onSuccess: (answer) => {
      startKeys.answered();
      // The password is gone from memory with the 201: the code step never holds it (B9).
      setPassword("");
      setShown(false);
      setCode("");
      setMissing(new Set());
      setChallenge({ value: answer, sentence: codeSentText(answer) });
      setStep("code");
      setFocus({ target: "code" });
    },
    onError: (error) => startKeys.answered(error),
  });

  const confirm = useMutation({
    mutationFn: (input: { challengeId: string; code: string; key: string }) =>
      taskaApi.confirmAccountEmailChange(input.challengeId, input.code, input.key),
    onSuccess: () => {
      confirmKeys.answered();
      setCode("");
      setChallenge(null);
      onDone();
    },
    onError: (error) => {
      confirmKeys.answered(error);
      if (isDeadCode(error)) {
        setCode("");
        setStep("dead");
        setFocus({ target: "dead" });
        return;
      }
      // A refused code from Enter in Code: the code stays, selected, to retype at once (Q4).
      if (violatedFields(error, CODE_FIELDS).has("code") && document.activeElement === codeRef.current) codeRef.current?.select();
    },
  });

  const pending = start.isPending || confirm.isPending;
  useEffect(() => {
    onPending(pending);
    return () => onPending(false);
  }, [pending, onPending]);

  useEffect(() => {
    if (focus === null) return;
    if (focus.target === "dead") deadRef.current?.focus();
    else if (focus.target === "code") codeRef.current?.focus();
    else if (focus.target === "currentPassword") passwordRef.current?.focus();
    else newEmailRef.current?.focus();
  }, [focus]);

  const cancel = () => {
    if (pending) return;
    onCancel();
  };

  const sendCode = () => {
    if (pending) return;
    const address = newEmail.trim();
    const empty = new Set<string>();
    if (address === "") empty.add("newEmail");
    if (password === "") empty.add("currentPassword");
    if (empty.size > 0) {
      setMissing(empty);
      setFocus({ target: empty.has("newEmail") ? "newEmail" : "currentPassword" });
      return;
    }
    start.mutate({ newEmail: address, currentPassword: password, key: startKeys.take({ newEmail: address, currentPassword: password }) });
  };

  const changeEmail = () => {
    if (pending || challenge === null) return;
    const value = normalizeCode(code);
    if (value === "") {
      setMissing(new Set(["code"]));
      setFocus({ target: "code" });
      return;
    }
    const { challengeId } = challenge.value;
    confirm.mutate({ challengeId, code: value, key: confirmKeys.take({ challengeId, code: value }) });
  };

  /** Step 1 again with the address kept, the password to type again, and a new key on Send code (B9, Q5). */
  const startOver = () => {
    if (pending) return;
    setStep("start");
    setChallenge(null);
    setCode("");
    setPassword("");
    setShown(false);
    setMissing(new Set());
    start.reset();
    confirm.reset();
    startKeys.drop();
    confirmKeys.drop();
    setFocus({ target: "currentPassword" });
  };

  const onKeyDown = formKeys(pending, cancel);

  if (step === "dead") {
    return (
      <div className="form-stack settings-account-form" onKeyDown={onKeyDown}>
        {/* A state the press led to, which takes focus: not live (B12). */}
        <div className="settings-account-dead" ref={deadRef} tabIndex={-1}>
          <ErrorNote requestId={apiErrorFacts(confirm.error).requestId}>{DEAD_CODE_TEXT}</ErrorNote>
        </div>
        <div className="settings-account-actions">
          <button className="primary-button compact-button" onClick={startOver} type="button">
            Start over
          </button>
          <button className="secondary-button compact-button" onClick={cancel} type="button">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (step === "code" && challenge !== null) {
    const refusal = reportable(confirm.error);
    const marked = refusal === null ? new Set<string>() : violatedFields(refusal, CODE_FIELDS);
    const hintId = ids.reason("code");
    return (
      <form
        className="form-stack settings-account-form"
        noValidate
        onKeyDown={onKeyDown}
        onSubmit={(event) => {
          event.preventDefault();
          changeEmail();
        }}
      >
        <p className="settings-account-sent" id={sentId}>
          {challenge.sentence}
        </p>
        <div className="field">
          <label htmlFor={ids.field("code")}>Code</label>
          <input
            aria-describedby={describedBy(sentId, hintId, marked.has("code") && ids.line("code"))}
            aria-invalid={missing.has("code") || marked.has("code") || undefined}
            autoComplete="one-time-code"
            className="settings-account-code"
            id={ids.field("code")}
            inputMode="numeric"
            onChange={(event) => {
              setCode(event.target.value);
              setMissing(new Set());
              confirmKeys.drop();
            }}
            readOnly={pending}
            ref={codeRef}
            spellCheck={false}
            type="text"
            value={code}
          />
          <p className="auth-field-hint" id={hintId}>
            {missing.has("code") ? "Enter the code." : CODE_HINT}
          </p>
        </div>
        <div className="settings-account-actions">
          <button aria-disabled={pending || undefined} className="primary-button compact-button" type="submit">
            Change email
          </button>
          <button aria-disabled={pending || undefined} className="secondary-button compact-button" onClick={startOver} type="button">
            Start over
          </button>
          <button aria-disabled={pending || undefined} className="secondary-button compact-button" onClick={cancel} type="button">
            Cancel
          </button>
        </div>
        {refusal !== null ? (
          <CredentialRefusal
            error={refusal}
            failed="Your email was not changed."
            fields={CODE_FIELDS}
            key={confirm.submittedAt}
            lineId={ids.line}
            lost="The server could not be reached, so your email may or may not have changed. Press Change email again to make sure."
          />
        ) : null}
      </form>
    );
  }

  const refusal = reportable(start.error);
  const marked = refusal === null ? new Set<string>() : violatedFields(refusal, EMAIL_FIELDS);
  return (
    <form
      className="form-stack settings-account-form"
      noValidate
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        sendCode();
      }}
    >
      <div className="field">
        <label htmlFor={ids.field("newEmail")}>New email</label>
        <input
          aria-describedby={describedBy(missing.has("newEmail") && ids.reason("newEmail"), marked.has("newEmail") && ids.line("newEmail"))}
          aria-invalid={missing.has("newEmail") || marked.has("newEmail") || undefined}
          autoCapitalize="off"
          autoComplete="email"
          id={ids.field("newEmail")}
          onChange={(event) => {
            setNewEmail(event.target.value);
            setMissing((value) => without(value, "newEmail"));
            startKeys.drop();
          }}
          readOnly={pending}
          ref={newEmailRef}
          spellCheck={false}
          type="email"
          value={newEmail}
        />
        {missing.has("newEmail") ? (
          <p className="auth-field-hint" id={ids.reason("newEmail")}>
            Enter the new email address.
          </p>
        ) : null}
      </div>
      <PasswordField
        after={
          <>
            {missing.has("currentPassword") ? (
              <p className="auth-field-hint" id={ids.reason("currentPassword")}>
                Enter your current password.
              </p>
            ) : null}
            <ForgotCurrentPassword email={email} />
          </>
        }
        autoComplete="current-password"
        describedBy={describedBy(
          missing.has("currentPassword") && ids.reason("currentPassword"),
          marked.has("currentPassword") && ids.line("currentPassword"),
        )}
        id={ids.field("currentPassword")}
        inputRef={passwordRef}
        invalid={missing.has("currentPassword") || marked.has("currentPassword")}
        label="Current password"
        onChange={(value) => {
          setPassword(value);
          setMissing((current) => without(current, "currentPassword"));
          startKeys.drop();
        }}
        onToggle={() => setShown((value) => !value)}
        readOnly={pending}
        shown={shown}
        value={password}
      />
      <div className="settings-account-actions">
        <button aria-disabled={pending || undefined} className="primary-button compact-button" type="submit">
          Send code
        </button>
        <button aria-disabled={pending || undefined} className="secondary-button compact-button" onClick={cancel} type="button">
          Cancel
        </button>
      </div>
      {refusal !== null ? (
        <CredentialRefusal
          error={refusal}
          failed="Your email was not changed."
          fields={EMAIL_FIELDS}
          key={start.submittedAt}
          lineId={ids.line}
          lost="The server could not be reached, so the code may or may not have been sent. Send it again to make sure."
        />
      ) : null}
    </form>
  );
}

/**
 * Change password: Current password, New password (B5's hint only, no
 * strength meter, no confirm field), Change password and Cancel. A hidden
 * `autocomplete="username"` input carries the account's address for a
 * password manager, outside the tab order and the accessibility tree (N1).
 */
function PasswordChangeForm({
  email,
  onCancel,
  onDone,
  onPending,
}: {
  email: string | null;
  onCancel: () => void;
  onDone: () => void;
  onPending: (pending: boolean) => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [shownCurrent, setShownCurrent] = useState(false);
  const [shownNext, setShownNext] = useState(false);
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const ids = useFieldIds();
  const keys = usePressKeys();

  const change = useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string; key: string }) =>
      taskaApi.changeAccountPassword(input.currentPassword, input.newPassword, input.key),
    onSuccess: () => {
      keys.answered();
      setCurrent("");
      setNext("");
      onDone();
    },
    onError: (error) => keys.answered(error),
  });
  const pending = change.isPending;
  useEffect(() => {
    onPending(pending);
    return () => onPending(false);
  }, [pending, onPending]);

  useEffect(() => {
    currentRef.current?.focus();
  }, []);

  const cancel = () => {
    if (pending) return;
    onCancel();
  };

  const submit = () => {
    if (pending) return;
    const empty = new Set<string>();
    if (current === "") empty.add("currentPassword");
    if (next === "") empty.add("newPassword");
    if (empty.size > 0) {
      setMissing(empty);
      (empty.has("currentPassword") ? currentRef : nextRef).current?.focus();
      return;
    }
    change.mutate({ currentPassword: current, newPassword: next, key: keys.take({ currentPassword: current, newPassword: next }) });
  };

  const refusal = reportable(change.error);
  const marked = refusal === null ? new Set<string>() : violatedFields(refusal, PASSWORD_FIELDS);
  return (
    <form
      className="form-stack settings-account-form"
      noValidate
      onKeyDown={formKeys(pending, cancel)}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {email !== null ? <input autoComplete="username" hidden readOnly type="email" value={email} /> : null}
      <PasswordField
        after={
          <>
            {missing.has("currentPassword") ? (
              <p className="auth-field-hint" id={ids.reason("currentPassword")}>
                Enter your current password.
              </p>
            ) : null}
            <ForgotCurrentPassword email={email} />
          </>
        }
        autoComplete="current-password"
        describedBy={describedBy(
          missing.has("currentPassword") && ids.reason("currentPassword"),
          marked.has("currentPassword") && ids.line("currentPassword"),
        )}
        id={ids.field("currentPassword")}
        inputRef={currentRef}
        invalid={missing.has("currentPassword") || marked.has("currentPassword")}
        label="Current password"
        onChange={(value) => {
          setCurrent(value);
          setMissing((value_) => without(value_, "currentPassword"));
          keys.drop();
        }}
        onToggle={() => setShownCurrent((value) => !value)}
        readOnly={pending}
        shown={shownCurrent}
        value={current}
      />
      <PasswordField
        after={
          <p className="auth-field-hint" id={ids.reason("newPassword")}>
            {missing.has("newPassword") ? "Enter a new password." : NEW_PASSWORD_HINT}
          </p>
        }
        autoComplete="new-password"
        describedBy={describedBy(ids.reason("newPassword"), marked.has("newPassword") && ids.line("newPassword"))}
        id={ids.field("newPassword")}
        inputRef={nextRef}
        invalid={missing.has("newPassword") || marked.has("newPassword")}
        label="New password"
        onChange={(value) => {
          setNext(value);
          setMissing((value_) => without(value_, "newPassword"));
          keys.drop();
        }}
        onToggle={() => setShownNext((value) => !value)}
        readOnly={pending}
        shown={shownNext}
        value={next}
      />
      <div className="settings-account-actions">
        <button aria-disabled={pending || undefined} className="primary-button compact-button" type="submit">
          Change password
        </button>
        <button aria-disabled={pending || undefined} className="secondary-button compact-button" onClick={cancel} type="button">
          Cancel
        </button>
      </div>
      {refusal !== null ? (
        <CredentialRefusal
          error={refusal}
          failed="Your password was not changed."
          fields={PASSWORD_FIELDS}
          key={change.submittedAt}
          lineId={ids.line}
          lost="The server could not be reached, so your password may or may not have changed. Press Change password again to make sure."
        />
      ) : null}
    </form>
  );
}

const without = (set: ReadonlySet<string>, name: string): ReadonlySet<string> => {
  if (!set.has(name)) return set;
  const next = new Set(set);
  next.delete(name);
  return next;
};
