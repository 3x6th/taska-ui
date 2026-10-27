import { useMutation, useQueries, useQueryClient, type UseQueryOptions, type UseQueryResult } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { ACCOUNT_LOCKED_REASON, apiErrorFacts, isAccountLocked, isDisplayNameInvalid } from "../api/errors";
import type { InvitationPreview } from "../domain/types";
import type { LoginRedirectState } from "../components/RequireSession";
import { DEFAULT_SIGNED_IN_ROUTE } from "../components/RequireSession";
import { AuthShell } from "../components/AuthShell";
import { ErrorNote } from "../components/ErrorNote";
import { ProviderChoices } from "../components/ProviderChoices";
import { useAuthMethods } from "../hooks/useAuthMethods";
import { formatLockDeadline, lockedUntilOf } from "../lib/accountLock";
import { displayNameProblem, trimDisplayName } from "../lib/displayName";
import {
  forgetInviteToken,
  heldInviteToken,
  holdInviteToken,
  inviteTokenFromInput,
  subscribeInviteToken,
} from "../lib/inviteLink";
import {
  NAME_HINT,
  inAppPath,
  oauthReturnTo,
  providerRefusalFromState,
  providerRefusalText,
  refusalLockDeadline,
  type ProviderRefusal,
} from "./authText";
import { SignupPanel } from "./SignupPanel";
import { useSignup } from "./useSignup";
import type { ScreenProps } from "./App";

/**
 * The card's tabs: Sign in, Accept invite — the invite form, which a `SIGNUP`
 * link labels «Create account» — and Create account, the sign-up form (§4.31).
 * Never more than two at once.
 */
type AuthMode = "signin" | "invite" | "signup";

interface LoginScreenProps extends ScreenProps {
  /** Which route the card is on: `/login` starts on Sign in, `/invite` on Accept invite. */
  initialMode: "signin" | "invite";
}

/**
 * The password policy as a person reads it, under New password (DESIGN.md
 * §4.27). The numbers are auth-service's default policy (`validation.password`
 * in its application.yml, backend #204); the stand may configure others, and
 * when it refuses, its own sentence is printed instead of this one.
 */
const PASSWORD_HINT = "At least 8 characters, with an uppercase letter, a digit and a symbol.";

/**
 * What the invite tab says for the server's one 401 (§4.27). The server's own
 * "Invalid or expired token" names no way out, and the 401 covers four causes
 * it does not tell apart — expired, already used, revoked by a newer
 * invitation, an account that is no longer invited.
 */
const INVITE_LINK_DEAD =
  "This invitation link no longer works — it expired, was used, or was replaced by a newer one. If you already set a password, sign in; otherwise ask the person who invited you to send a new invitation.";

/** The same 401 for a link of kind `SIGNUP` (§4.31): its way out is to sign up again, not to ask anybody. */
const SIGNUP_LINK_DEAD =
  "This sign-up link no longer works — it expired, was used, or was replaced by a newer one. If you already set a password, sign in; otherwise create your account again.";

/**
 * The same 401 for a link whose kind nobody knows — the preview refused it —
 * while sign-up is open, so it may be either (§4.31). With sign-up off every
 * link is an invitation, and §4.27's sentence stands.
 */
const ANY_LINK_DEAD =
  "This link no longer works — it expired, was used, or was replaced by a newer one. If you already set a password, sign in; otherwise ask for a new invitation or create your account again.";

/** The invite tab's note, with a link caught and without one (§4.27, TAS-425). */
const INVITE_NOTE = "Confirm your name and choose a password to activate your Taska account.";

/** Under the invite form's button (§4.27), and for a `SIGNUP` link (§4.31). */
const INVITE_LINK_HINT = "Link expired? Ask the person who invited you to send a new one.";
const SIGNUP_LINK_HINT = "Link expired? Create your account again to get a new one.";

/**
 * The preview's answers, by token (TAS-425). The token is in the key, so this
 * cache entry is as short-lived as the token itself: memory only, dropped with
 * the link once it is spent, and kept apart from the cache a foreign session's
 * sign-out clears — the preview was read without that session and is about
 * the person activating.
 */
const INVITATION_PREVIEW_KEY = "invitation-preview";

/**
 * The login card, all its tabs (DESIGN.md §4.27, §4.31; TAS-208, TAS-426).
 *
 * Accepting an invitation **opens no session**: `POST /auth/invitations/accept`
 * answers 204 with no tokens, and since backend #204 the contract says the
 * client signs in afterwards like anybody else. So a 204 replaces the route
 * with `/login`, says the password is set, and puts focus in Email — and reads
 * nothing about the account, because nobody is signed in to read it. Before
 * TAS-208 this called `GET /users/me` here, which answered 401 with no session
 * and, under somebody else's, opened *their* projects.
 *
 * Somebody else's session is told about on the invite tab and signed out of at
 * submit, before the request — never on landing, which would end a session
 * for a link opened by accident.
 *
 * Since TAS-425 a link is previewed before the password is asked for
 * (`POST /auth/invitations/preview`, sent without the session like the
 * activation): a caught link on arrival, a typed one on Continue. The answer
 * fills Email, read-only, so a password manager files the new password under
 * the right account, and Name, which the reader may change and which is sent
 * with the password. A link the preview refuses never shows the form at all.
 *
 * Since TAS-426 the card reads `GET /auth/methods` on every mount: with sign-up
 * open, `/login`'s second tab is Create account rather than Accept invite, and
 * the provider buttons stand under Sign in and Create account. With sign-up off
 * and no providers — the stand today — the card is the one it was, but for the
 * tabs' roles. A provider sign-in that did not finish comes back here with its
 * refusal in router state, drawn above the tabs.
 */
export function LoginScreen({ theme, toggleTheme, initialMode }: LoginScreenProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const redirect = (location.state ?? null) as LoginRedirectState | null;
  const from = inAppPath(redirect?.from);
  const methods = useAuthMethods();
  const signup = useSignup();
  const capturedToken = useSyncExternalStore(subscribeInviteToken, heldInviteToken);
  // The refusal a provider sign-in came back with (§4.31): read once from the
  // router state it travelled in, then this screen's own, and gone with the
  // next submit, provider press or tab change.
  const [providerRefusal, setProviderRefusal] = useState<ProviderRefusal | null>(() =>
    providerRefusalFromState(redirect?.providerRefusal),
  );
  const [mode, setMode] = useState<AuthMode>(() =>
    providerRefusalFromState(redirect?.providerRefusal)?.tab === "signup" ? "signup" : initialMode,
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [typedToken, setTypedToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  /** The name as the reader changed it; `null` until they do, which reads the invited one (§4.27). */
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  /**
   * How many times "Try again" has been answered by a refusal, for this link
   * (§4.27). The refusal found on arrival is not announced; every one that
   * answers a Try again is, and is keyed by this count so that the same
   * sentence is mounted — and announced — again.
   */
  const [retryRefusals, setRetryRefusals] = useState(0);
  // Read once: a session held when the form opened is the one the notice is
  // about, and the press that signs out of it is what retires the notice —
  // not a re-read that might race the sign-out.
  const [signedInElsewhere, setSignedInElsewhere] = useState(() => taskaApi.hasSession());
  const [activated, setActivated] = useState(Boolean(redirect?.activated));
  /** Bumped when the methods' answer takes the open tab away, so focus can follow it to Sign in (§4.31). */
  const [tabTaken, setTabTaken] = useState(0);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const refusalRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const previewRefusalRef = useRef<HTMLDivElement>(null);
  const signinTabRef = useRef<HTMLButtonElement>(null);
  const noticeId = useId();
  const tokenHintId = useId();
  const passwordHintId = useId();
  const newPasswordId = useId();
  const passwordId = useId();
  const typedTokenId = useId();
  const inviteEmailId = useId();
  const nameId = useId();
  const nameHintId = useId();
  const tabsId = useId();
  const panelId = `${tabsId}-panel`;
  const tabId = (tab: AuthMode) => `${tabsId}-${tab}`;

  // Which tabs, by route and by the server's methods (§4.31): never three.
  // `/invite` keeps Accept invite whatever the methods say, so a link opened in
  // a clean browser does not jump; `/login` trades it for Create account while
  // sign-up is open — an invitation then arrives only as a link.
  const tabs: readonly AuthMode[] =
    initialMode !== "invite" && methods.signupEnabled ? ["signin", "signup"] : ["signin", "invite"];
  // The answer took the open tab away: Sign in is open instead, what was typed
  // stays in memory, and focus that was in the panel goes to the Sign in tab.
  // Adjusted during render, which commits once.
  if (!tabs.includes(mode)) {
    setMode("signin");
    setTabTaken((count) => count + 1);
  }
  const active: AuthMode = tabs.includes(mode) ? mode : "signin";

  // A link that arrives while the card is already up — a hash change on the
  // Pages build, handed over by `App` — lands on the tab it is for. Adjusted
  // during render, which commits once, rather than in an effect that would
  // paint the sign-in tab first.
  const [tokenSeen, setTokenSeen] = useState(capturedToken);
  if (tokenSeen !== capturedToken) {
    setTokenSeen(capturedToken);
    if (capturedToken !== null) setMode("invite");
    // A name typed for one link is not the name of the next.
    setNameDraft(null);
    setRetryRefusals(0);
  }

  // The link's preview, read as soon as a link is caught (§4.27): who it was
  // made for, and the name the account carries now. Never retried by itself and
  // never re-read on focus — a dead link stays dead, and the reader's own
  // "Try again" is the retry for a failure that is not. A list of one query or
  // of none, so that without a link nothing is put in the cache at all: the
  // sign-in form after an expired session starts from an empty one (§5.1).
  const previewQueries: UseQueryOptions<InvitationPreview>[] =
    capturedToken === null
      ? []
      : [
          {
            queryKey: [INVITATION_PREVIEW_KEY, capturedToken],
            queryFn: () => taskaApi.previewInvitation(capturedToken),
            retry: false,
            staleTime: Infinity,
            refetchOnWindowFocus: false,
          },
        ];
  const preview: UseQueryResult<InvitationPreview> | undefined = useQueries({ queries: previewQueries })[0];
  /**
   * The refusal "Try again" is answering, held while the retry is out: a
   * query with no data goes back to pending when it is fetched again, and the
   * refusal — with "Checking" under it — has to stay where it was (§4.27).
   * Held until the retry's answer is in hand, a new refusal included, so that
   * the answer is drawn once, in the same commit as `retryRefusals` moves.
   */
  const [retrying, setRetrying] = useState<{ error: unknown } | null>(null);
  const previewed = capturedToken !== null && preview?.isSuccess ? preview.data : null;
  const previewError = retrying ? retrying.error : preview?.isError ? preview.error : null;
  const previewRefused = capturedToken !== null && previewError !== null;
  const nameValue = nameDraft ?? previewed?.displayName ?? "";
  const nameProblem = previewed ? displayNameProblem(nameValue) : null;
  // A sign-up link's words (§4.31), swapped in place in the same commit that
  // fills Email and Name; any other kind — an unknown one too — keeps the
  // invitation's.
  const signupLink = previewed?.kind === "SIGNUP";
  // The dead-link sentence for a link whose kind is not known.
  const unknownLinkDead = methods.signupEnabled ? ANY_LINK_DEAD : INVITE_LINK_DEAD;

  // A typed token is previewed on Continue (§4.27), and the answer makes it a
  // caught one: the field goes, the caught layout is drawn — from the answer
  // already in hand, so it is not asked for twice — and focus is in New
  // password.
  const continueWith = useMutation({
    mutationFn: (token: string) => taskaApi.previewInvitation(token),
    onSuccess: (answer, token) => {
      queryClient.setQueryData([INVITATION_PREVIEW_KEY, token], answer);
      holdInviteToken(token);
      setFocusRequest({ target: "newPassword" });
    },
  });

  // Only the session that died without being asked needs explaining: a login
  // form after clicking a private link surprises nobody, and a sentence there
  // is one more thing to read on a screen that already asks for two. And the
  // explanation only belongs over the sign-in form: "Your session expired. Sign
  // in to continue." above a form headed "Activate account" describes neither.
  const expiredNotice = active === "signin" && redirect?.expired ? "Your session expired. Sign in to continue." : null;
  const activatedNotice = active === "signin" && activated ? "Password set. Sign in with your email and new password." : null;
  // It is about activating, and there is nothing to activate once the preview
  // has refused the link (§4.27): it goes with the form.
  const foreignSessionNotice =
    active === "invite" && signedInElsewhere && !previewRefused
      ? "You’re signed in on this browser. Activating this invitation signs you out first."
      : null;
  // A cancelled sign-in says nothing (§4.31): the screen is as it was.
  const refusalShown = providerRefusal !== null && providerRefusalText(providerRefusal) !== null ? providerRefusal : null;

  // Where the reader starts, decided from what brought them here: on mount,
  // and again on an arrival that did not remount this screen — `/invite` to
  // `/login` after an activation is one, wherever the two routes render the
  // same component in the same place. A fresh object per request, so asking
  // for the same field twice still moves focus.
  const [focusRequest, setFocusRequest] = useState<{
    target: "notice" | "refusal" | "email" | "newPassword";
  } | null>(() => {
    const target = refusalShown
      ? "refusal"
      : expiredNotice
        ? "notice"
        : activatedNotice
          ? "email"
          : initialMode === "invite" && heldInviteToken()
            ? "newPassword"
            : null;
    return target ? { target } : null;
  });
  const [arrival, setArrival] = useState(location.key);
  if (arrival !== location.key) {
    setArrival(location.key);
    if (redirect?.activated) {
      setMode("signin");
      setActivated(true);
      setNewPassword("");
      setFocusRequest({ target: "email" });
    }
    const arrived = providerRefusalFromState(redirect?.providerRefusal);
    if (arrived) {
      setProviderRefusal(arrived);
      setMode(arrived.tab === "signup" ? "signup" : "signin");
      if (providerRefusalText(arrived) !== null) setFocusRequest({ target: "refusal" });
    }
  }

  // Before the arrival's own focus below, which wins when both apply.
  useEffect(() => {
    if (tabTaken === 0) return;
    const focused = document.activeElement;
    if (focused === null || focused === document.body) signinTabRef.current?.focus();
  }, [tabTaken]);

  useEffect(() => {
    // The expiry redirect happened without the user asking, and focus would
    // otherwise stay on <body> with nothing announced (§7). A live region
    // would not help: that node mounts with its text already in it, so there
    // is no change to announce — moving focus is what reads the sentence out.
    // A provider's refusal is the same kind of arrival (§4.31). After an
    // activation the sentence is tied to Email instead, and focus there reads
    // both (§4.27). A captured link needs only the password.
    if (focusRequest?.target === "notice") noticeRef.current?.focus();
    else if (focusRequest?.target === "refusal") refusalRef.current?.focus();
    else if (focusRequest?.target === "email") emailRef.current?.focus();
    else if (focusRequest?.target === "newPassword") newPasswordRef.current?.focus();
  }, [focusRequest]);

  // A preview that refused the link takes the form away, and focus with it if
  // it was there — New password, where a caught link starts. It goes to the
  // refusal rather than to <body>, as the expired session's notice takes it
  // (§4.27); focus anywhere else is left where the reader put it. Again after
  // each Try again that ends refused (TAS-426): a dead link or a rejected
  // request takes Try again away too, with the focus it had.
  useEffect(() => {
    if (!previewRefused) return;
    const active = document.activeElement;
    if (active === null || active === document.body) previewRefusalRef.current?.focus();
  }, [previewRefused, retryRefusals]);

  // Read once, then taken out of the history entry: router state outlives a
  // reload, and a reload of `/login` would otherwise say "Password set" — or
  // the provider's refusal — again, and take focus a second time, for an
  // arrival long past. The notice itself is this screen's state from here on,
  // and goes the way §4.27 and §4.31 say it goes.
  const stateToDrop = Boolean(redirect?.activated || redirect?.providerRefusal);
  useEffect(() => {
    if (stateToDrop) navigate(location.pathname, { replace: true, state: null });
  }, [stateToDrop, location.pathname, navigate]);

  const switchTo = (next: AuthMode) => {
    setMode(next);
    setActivated(false);
    setProviderRefusal(null);
    // A shown password does not follow the reader to the other tab (§4.27).
    setShowPassword(false);
    setShowNewPassword(false);
    submit.reset();
    continueWith.reset();
    signup.dropRefusals();
  };

  // Roving tabindex (§4.27 «Табы»): only the open tab is in the Tab order, and
  // the arrows, Home and End move focus and the choice together.
  const onTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.indexOf(active);
    const next =
      event.key === "ArrowRight"
        ? tabs[(at + 1) % tabs.length]
        : event.key === "ArrowLeft"
          ? tabs[(at - 1 + tabs.length) % tabs.length]
          : event.key === "Home"
            ? tabs[0]
            : event.key === "End"
              ? tabs[tabs.length - 1]
              : null;
    if (next === null) return;
    event.preventDefault();
    if (next !== active) switchTo(next);
    document.getElementById(tabId(next))?.focus();
  };

  const submit = useMutation({
    mutationFn: async (): Promise<"signedIn" | "activated"> => {
      if (active === "signin") {
        await taskaApi.login({ email, password });
        queryClient.setQueryData(["me"], await taskaApi.getCurrentUser());
        return "signedIn";
      }
      // Out of somebody else's session first, and before the request rather
      // than after it: a 401 from the activation must not read as that
      // session dying (§5.1), and nothing cached for it belongs to whoever is
      // activating. The notice above said this would happen.
      if (taskaApi.hasSession()) {
        await taskaApi.logout();
        // Everything that session read goes, and its writes with it — all but
        // the link's preview, which no session read and which the form on
        // screen is drawn from.
        queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== INVITATION_PREVIEW_KEY });
        queryClient.getMutationCache().clear();
        setSignedInElsewhere(false);
      }
      await taskaApi.acceptInvitation({
        token: capturedToken ?? inviteTokenFromInput(typedToken),
        newPassword,
        // Always sent, and trimmed (§4.27): what the reader confirmed is the
        // name the account starts with.
        displayName: trimDisplayName(nameValue),
      });
      return "activated";
    },
    onMutate: () => {
      setActivated(false);
      setProviderRefusal(null);
    },
    onSuccess: async (outcome) => {
      if (outcome === "activated") {
        // The link is spent, and nobody is signed in: the sign-in form, with
        // a sentence saying so. `replace`, so Back does not return to a form
        // whose link no longer works.
        forgetInviteToken();
        queryClient.removeQueries({ queryKey: [INVITATION_PREVIEW_KEY] });
        navigate("/login", { replace: true, state: { activated: true } satisfies LoginRedirectState });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      // Back to whatever the guard interrupted, and `replace` so Back does not
      // land on the login form of a session that already exists.
      navigate(from ?? DEFAULT_SIGNED_IN_ROUTE, { replace: true });
    },
  });

  const passwordRefused = active === "invite" && submit.isError && isPasswordRefusal(submit.error);
  const nameRefused = active === "invite" && submit.isError && isDisplayNameInvalid(submit.error);
  const notice = expiredNotice ?? activatedNotice ?? foreignSessionNotice;
  // Where a provider flow comes back to (guard §4): the path the guard
  // remembered, or `/projects` — said explicitly.
  const returnTo = oauthReturnTo(redirect?.from);
  const onProviderStart = () => setProviderRefusal(null);

  /**
   * Enter or a press on the invite tab's one button. Without a caught link that
   * button is Continue, and it previews what was typed. With one it is
   * Activate, which sends nothing while the preview is out or has refused, and
   * nothing for a name with a reason against it — it takes the reader to Name
   * instead (§4.27).
   */
  const submitInvite = () => {
    if (capturedToken === null) {
      if (continueWith.isPending) return;
      continueWith.mutate(inviteTokenFromInput(typedToken));
      return;
    }
    if (submit.isPending || !previewed) return;
    if (nameProblem) {
      nameRef.current?.focus();
      return;
    }
    submit.mutate();
  };

  const tabLabel = (tab: AuthMode) =>
    tab === "signin" ? "Sign in" : tab === "signup" || signupLink ? "Create account" : "Accept invite";

  return (
    <AuthShell theme={theme} toggleTheme={toggleTheme}>
      {refusalShown ? (
        // A refusal the reader arrives with (§4.31): a state on arrival, so
        // focus brings it to them and it is not a live region.
        <div className="auth-refusal" ref={refusalRef} tabIndex={-1}>
          <ProviderRefusalNote refusal={refusalShown} />
        </div>
      ) : notice ? (
        <p
          className="auth-notice"
          id={noticeId}
          ref={noticeRef}
          // Focusable only as the expiry's own announcement; the other two
          // are read through the control they describe, or simply read.
          tabIndex={expiredNotice ? -1 : undefined}
        >
          {notice}
        </p>
      ) : null}
      {/* Tabs (§4.27 «Табы», TAS-426): a tab and a button with the same words
          — «Sign in», «Create account» — are told apart by their role. The
          look is §4.2's, `is-active` included. */}
      <div className="segmented" onKeyDown={onTabsKeyDown} role="tablist">
        {tabs.map((tab) => (
          <button
            aria-controls={panelId}
            aria-selected={active === tab}
            className={active === tab ? "is-active" : ""}
            id={tabId(tab)}
            key={tab}
            onClick={() => switchTo(tab)}
            ref={tab === "signin" ? signinTabRef : undefined}
            role="tab"
            tabIndex={active === tab ? 0 : -1}
            type="button"
          >
            {tabLabel(tab)}
          </button>
        ))}
      </div>

      <div aria-labelledby={tabId(active)} id={panelId} role="tabpanel">
        {active === "signup" ? (
          <SignupPanel
            onProviderStart={onProviderStart}
            providers={methods.providers}
            returnTo={returnTo}
            signup={signup}
          />
        ) : (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              if (active === "invite") {
                submitInvite();
                return;
              }
              // The guard `aria-disabled` on either submit does not enforce by
              // itself: Enter in a field while the request is out sends nothing.
              if (submit.isPending) return;
              submit.mutate();
            }}
          >
            {active === "signin" ? (
              <>
                <label className="field">
                  <span>Email</span>
                  <input
                    aria-describedby={activatedNotice ? noticeId : undefined}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    ref={emailRef}
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                  />
                </label>
                {/* New password's layout (§4.27, TAS-299): the label is `for`
                    the field and wraps nothing, because a wrapping label around
                    the toggle would name the field "Password Show password".
                    The toggle is required for the invite's reason — there is no
                    reset, and failed sign-ins lock the account. */}
                <div className="field">
                  <label htmlFor={passwordId}>Password</label>
                  <div className="password-field">
                    <input
                      autoComplete="current-password"
                      id={passwordId}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="••••••••••"
                      type={showPassword ? "text" : "password"}
                      value={password}
                    />
                    <button
                      aria-label="Show password"
                      aria-pressed={showPassword}
                      className="icon-button password-toggle"
                      onClick={() => setShowPassword((shown) => !shown)}
                      type="button"
                    >
                      {showPassword ? <EyeOff aria-hidden="true" size={14} /> : <Eye aria-hidden="true" size={14} />}
                    </button>
                  </div>
                </div>
                {/* `aria-disabled`, not `disabled` (§4.21, §4.27): a submit
                    that disabled itself dropped the keyboard reader's focus to
                    <body> for the length of the request. */}
                <button aria-disabled={submit.isPending || undefined} className="primary-button auth-submit" type="submit">
                  {submit.isPending ? "Signing in" : "Sign in"}
                </button>
                {submit.isError ? <LoginFailure error={submit.error} key={submit.submittedAt} /> : null}
                <p className="auth-hint">Forgot your password? Taska has no password reset yet.</p>
              </>
            ) : capturedToken === null ? (
              <>
                <p className="invite-note">{INVITE_NOTE}</p>
                <div className="field">
                  <label htmlFor={typedTokenId}>Invitation token</label>
                  <input
                    aria-describedby={tokenHintId}
                    aria-invalid={continueWith.isError && previewFailure(continueWith.error) !== "unavailable" ? true : undefined}
                    autoComplete="off"
                    className="mono-input"
                    id={typedTokenId}
                    onChange={(event) => setTypedToken(event.target.value)}
                    spellCheck={false}
                    value={typedToken}
                  />
                  <p className="auth-field-hint" id={tokenHintId}>
                    Open the link in your invitation email — it fills this in.
                  </p>
                </div>
                {/* Continue, not Activate: nothing is asked for until the link
                    has said whose it is (§4.27). No debounce — a token half
                    typed would read as a dead link. */}
                <button
                  aria-disabled={continueWith.isPending || undefined}
                  className="primary-button auth-submit"
                  type="submit"
                >
                  {continueWith.isPending ? "Checking" : "Continue"}
                </button>
                {continueWith.isError ? (
                  <PreviewFailureNote deadSentence={unknownLinkDead} error={continueWith.error} live />
                ) : null}
                {continueWith.isError && previewFailure(continueWith.error) === "dead" ? null : (
                  <p className="auth-hint">{INVITE_LINK_HINT}</p>
                )}
              </>
            ) : previewRefused ? (
              // The link was refused on arrival, so there is nothing to fill
              // in: the note, the fields, Activate and the hint all go, and
              // the refusal stands in their place. A state found on arrival,
              // not an answer to anything done, so not announced — focus
              // brings it to a reader who was in the form (§4.27).
              <div className="invite-preview-refusal" ref={previewRefusalRef} tabIndex={-1}>
                <PreviewFailureNote
                  deadSentence={unknownLinkDead}
                  error={previewError}
                  key={retryRefusals}
                  live={retryRefusals > 0}
                />
                {previewFailure(previewError) === "unavailable" ? (
                  <button
                    aria-disabled={retrying ? true : undefined}
                    className="secondary-button auth-retry"
                    onClick={() => {
                      if (retrying || !preview) return;
                      setRetrying({ error: previewError });
                      void preview.refetch().then((result) => {
                        setRetrying(null);
                        if (result.isSuccess) setFocusRequest({ target: "newPassword" });
                        else setRetryRefusals((count) => count + 1);
                      });
                    }}
                    type="button"
                  >
                    {retrying ? "Checking" : "Try again"}
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                {signupLink ? (
                  // The same box, its words swapped in place (§4.31): a
                  // heading of its own line and one sentence under it.
                  <div className="invite-note">
                    <h1 className="invite-note-title">Finish creating your account</h1>
                    <p>Confirm your name and choose a password.</p>
                  </div>
                ) : (
                  <p className="invite-note">{INVITE_NOTE}</p>
                )}
                {/* Read-only, and an input rather than text: a password manager
                    files the new password under this address (§4.27). In the
                    tab order, with §7's ring and no accent frame. */}
                <div aria-busy={previewed ? undefined : true} className="field">
                  <label htmlFor={inviteEmailId}>Email</label>
                  <div className="invite-value-field">
                    <input
                      autoComplete="username"
                      id={inviteEmailId}
                      readOnly
                      type="email"
                      value={previewed?.email ?? ""}
                    />
                    {previewed ? null : <span aria-hidden="true" className="value-skeleton invite-skeleton-email" />}
                  </div>
                </div>
                <div aria-busy={previewed ? undefined : true} className="field">
                  <label htmlFor={nameId}>Name</label>
                  <div className="invite-value-field">
                    <input
                      aria-describedby={nameHintId}
                      aria-invalid={nameProblem || nameRefused ? true : undefined}
                      autoComplete="name"
                      id={nameId}
                      onChange={(event) => setNameDraft(event.target.value)}
                      readOnly={!previewed}
                      ref={nameRef}
                      spellCheck={false}
                      value={nameValue}
                    />
                    {previewed ? null : <span aria-hidden="true" className="value-skeleton invite-skeleton-name" />}
                  </div>
                  {/* The one reason the shared check gives stands where the
                      hint stood, while there is one (§4.27, §5.9). */}
                  <p className="auth-field-hint" id={nameHintId}>
                    {nameProblem ?? NAME_HINT}
                  </p>
                </div>
                <div className="field">
                  <label htmlFor={newPasswordId}>New password</label>
                  <div className="password-field">
                    <input
                      aria-describedby={passwordHintId}
                      aria-invalid={passwordRefused || undefined}
                      autoComplete="new-password"
                      id={newPasswordId}
                      onChange={(event) => setNewPassword(event.target.value)}
                      ref={newPasswordRef}
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                    />
                    {/* Required, not a nicety (§4.27): there is one field, no
                        reset, and a typo here locks the account for good. */}
                    <button
                      aria-label="Show password"
                      aria-pressed={showNewPassword}
                      className="icon-button password-toggle"
                      onClick={() => setShowNewPassword((shown) => !shown)}
                      type="button"
                    >
                      {showNewPassword ? <EyeOff aria-hidden="true" size={14} /> : <Eye aria-hidden="true" size={14} />}
                    </button>
                  </div>
                  <p className="auth-field-hint" id={passwordHintId}>
                    {PASSWORD_HINT}
                  </p>
                </div>
                {/* `aria-disabled`, not `disabled` (§4.21): a button that
                    disabled itself would drop the keyboard reader's focus to
                    <body> for the length of the request. In flight while the
                    preview is out too, with its label unchanged. */}
                <button
                  aria-disabled={submit.isPending || !previewed || undefined}
                  className="primary-button auth-submit"
                  type="submit"
                >
                  {signupLink
                    ? submit.isPending
                      ? "Creating account"
                      : "Create account"
                    : submit.isPending
                      ? "Activating"
                      : "Activate account"}
                </button>
                {submit.isError ? (
                  <InviteFailure deadSentence={signupLink ? SIGNUP_LINK_DEAD : INVITE_LINK_DEAD} error={submit.error} />
                ) : null}
                {/* Not under the dead-link alert, which already says what to
                    do next — twice in a row would be the same advice in two
                    voices. */}
                {submit.isError && isDeadLink(submit.error) ? null : signupLink ? (
                  // The sign-up hint is shorter than the invitation's, which
                  // the form showed while the preview was out: at 390 one line
                  // against two, and the card would move by it (§4.31). The
                  // invitation's words stay under it, unseen and unread, to
                  // hold the height — at every width, not one.
                  <p className="auth-hint auth-hint-stack">
                    <span>{SIGNUP_LINK_HINT}</span>
                    <span aria-hidden="true" className="auth-hint-reserve">
                      {INVITE_LINK_HINT}
                    </span>
                  </p>
                ) : (
                  <p className="auth-hint">{INVITE_LINK_HINT}</p>
                )}
              </>
            )}
          </form>
        )}
        {active === "signin" ? (
          <ProviderChoices onStart={onProviderStart} providers={methods.providers} returnTo={returnTo} tab="signin" />
        ) : null}
      </div>
    </AuthShell>
  );
}

/**
 * Whether the activation was refused for the password rather than the link —
 * the one refusal whose field can be pointed at (`aria-invalid`, §4.27).
 *
 * **Keyed on the sentence**, which this file otherwise avoids, and the reason
 * is that nothing else carries it: every 400 of the route shares
 * `INVALID_ARGUMENT`. Two of them come from auth-service's gRPC transport,
 * before the service sees the request — a blank token, "body.token must not be
 * blank", and a blank password, "body.newPassword must not be blank"
 * (`AuthGrpcService.setPasswordByToken`, `GrpcRequestValidators`). Behind them
 * the service's own: the token's "Token required" and "Invite token is too
 * long", and the password policy's sentences, all beginning "Password"
 * (`PasswordValidator`, `AuthServiceImpl.setPasswordByToken`, develop
 * `e8a8d316b326`). So a password refusal begins "Password" or
 * "body.newPassword", and a token refusal begins neither. A reworded sentence
 * costs only the field marker: the sentence itself is still printed.
 */
function isPasswordRefusal(error: unknown): boolean {
  const { code, status, message } = apiErrorFacts(error);
  return (
    (code === "INVALID_ARGUMENT" || status === 400) &&
    message !== null &&
    (message.startsWith("Password") || message.startsWith("body.newPassword"))
  );
}

/**
 * What a refused activation says (§4.27): the 401 in this screen's own words —
 * an invitation's or, for a `SIGNUP` link, a sign-up's (§4.31) — every other
 * refusal in the server's, and the request id under either. An alert, because
 * the reader is looking at a button that just stopped saying "Activating" and
 * the answer is not where focus is.
 */
function InviteFailure({ error, deadSentence }: { error: unknown; deadSentence: string }) {
  const { message, requestId } = apiErrorFacts(error);
  return (
    <ErrorNote live="alert" requestId={requestId}>
      {isDeadLink(error) ? deadSentence : (message ?? "The invitation could not be activated.")}
    </ErrorNote>
  );
}

/** The activation's one 401 — the link is dead, whichever of the four ways (§4.27). */
function isDeadLink(error: unknown): boolean {
  const { status, code } = apiErrorFacts(error);
  return status === 401 || code === "UNAUTHENTICATED";
}

/**
 * The two 4xx a retry may change (§4.27): a request the server timed out
 * waiting for (408), and one it would not take yet (429). They go with the 5xx.
 */
const RETRYABLE_CLIENT_STATUSES: ReadonlySet<number> = new Set([408, 429]);

/**
 * How a preview was refused (§4.27): the link is dead (its one 401); the
 * request was refused (any other 4xx but 408 and 429 — a 400 at the gateway's
 * edge for a body it will not read), which no retry changes; or the link could
 * not be checked — a 5xx, a 408 or a 429, or no answer at all — which a retry
 * might. The mock carries no status, so its codes stand in.
 */
function previewFailure(error: unknown): "dead" | "rejected" | "unavailable" {
  if (isDeadLink(error)) return "dead";
  const { status, code } = apiErrorFacts(error);
  if (
    status !== null
      ? status >= 400 && status < 500 && !RETRYABLE_CLIENT_STATUSES.has(status)
      : code === "INVALID_ARGUMENT" || code === "FAILED_PRECONDITION"
  ) {
    return "rejected";
  }
  return "unavailable";
}

/**
 * What a refused preview says (§4.27): the dead link in the same words as a
 * refused activation — or, since a refused preview tells nobody the link's
 * kind, in words for either kind while sign-up is open (§4.31) — a rejected
 * request in the server's own, and anything else as a link that could not be
 * checked, with the server's words beside it. The request id under each.
 * `live` for an answer to a press — Continue's, and Try again's — and not for
 * the refusal found on arrival.
 */
function PreviewFailureNote({ error, deadSentence, live = false }: { error: unknown; deadSentence: string; live?: boolean }) {
  const { message, requestId, status, code } = apiErrorFacts(error);
  // Words only from something that answered: a request that never reached the
  // server has the browser's ("Failed to fetch"), and those are not the server's.
  const serverWords = status !== null || code !== null ? message : null;
  const failure = previewFailure(error);
  const role = live ? "alert" : undefined;
  if (failure === "dead") {
    return (
      <ErrorNote live={role} requestId={requestId}>
        {deadSentence}
      </ErrorNote>
    );
  }
  if (failure === "rejected" && message) {
    return (
      <ErrorNote live={role} requestId={requestId}>
        {message}
      </ErrorNote>
    );
  }
  return (
    <ErrorNote live={role} requestId={requestId} serverWords={serverWords}>
      This invitation could not be checked.
    </ErrorNote>
  );
}

/**
 * A provider sign-in's refusal, as the reader arrives with it (§4.31's table).
 * Not a live region — focus brings it. The locked account is `.auth-lock`'s two
 * lines; a provider's lock carries no deadline (TAS-444), so the first line
 * says none rather than make one up.
 */
function ProviderRefusalNote({ refusal }: { refusal: ProviderRefusal }) {
  if (refusal.reason === ACCOUNT_LOCKED_REASON) {
    const until = refusalLockDeadline(refusal);
    return (
      <ErrorNote requestId={refusal.requestId}>
        <span className="auth-lock">
          {until ? <LockDeadline until={until} /> : <span>Account is locked after too many failed sign-ins.</span>}
          <span>Try again later.</span>
        </span>
      </ErrorNote>
    );
  }
  return (
    <ErrorNote requestId={refusal.requestId} serverWords={refusal.message}>
      {providerRefusalText(refusal)}
    </ErrorNote>
  );
}

/**
 * What a refused sign-in says.
 *
 * Two branches and one rule between them: the branch is chosen by the response
 * code (`isAccountLocked`, src/api/errors.ts) and never by the wording. The
 * deadline comes from `details.lockedUntil` since backend PR #199, and from the
 * prose only when that is missing (`lockedUntilOf`, src/lib/accountLock.ts) —
 * either way, never to decide what the reader is told.
 *
 * **The fallback is the server's own sentence, verbatim.** When the deadline
 * cannot be read — no usable `details` and a reworded message, or a moment
 * that has already passed — this prints `Account is locked until
 * 2026-09-22T11:55:50.398486Z. Try again later.` exactly as it arrived. That is the ugliness TAS-237 was
 * filed about, and it is still the right answer: a hand-written "your account
 * is locked" would throw away information the server did send, and would make a
 * parser that quietly stopped matching indistinguishable from one that works.
 * Unreadable and traceable beats prettier and wrong.
 *
 * An alert since TAS-426 (§4.27): it answers the press of Sign in, and the
 * caller mounts it afresh for every attempt, so the same refusal twice is said
 * twice.
 */
function LoginFailure({ error }: { error: unknown }) {
  const { message, requestId } = apiErrorFacts(error);
  // Only the Sign in tab draws this slot, and the argument behind
  // `isAccountLocked` covers that one route only — `POST /auth/login`, sound by
  // exhausting that method's other refusals (src/api/errors.ts). The invite
  // tab's `POST /auth/invitations/accept` and every provider route have
  // refusals of their own (`InviteFailure`, `ProviderRefusalNote`), keyed on
  // their own pairs, and never come here.
  //
  // What the argument does not reach is the `getCurrentUser()` that follows a
  // successful login in the same mutation: `validateAccessToken` runs
  // `validateUserStatus` for every authenticated call, and that raises
  // `PERMISSION_DENIED "User is blocked"` (AuthServiceImpl.java:205-213, read
  // at backend head `63f7ea5`). It reaches here, and what keeps it right is
  // the reader rather than the predicate — that refusal carries no
  // `details` and no future instant in its sentence, so `lockedUntilOf`
  // answers `null` and the server's own wording is printed verbatim. Correct,
  // and correct for a reason one layer below the one this branch claims.
  //
  // Read at render rather than held in state, so a lock that expires while the
  // form is still open falls back to the raw sentence on the next paint
  // instead of going on promising a moment that has gone. No timer wakes it —
  // the reader retrying is what re-renders this, and that is the moment it
  // matters.
  const lockedUntil = isAccountLocked(error) ? lockedUntilOf(error) : null;

  // The request id is owed on both branches and was missing from this screen
  // until TAS-237: a refusal here is as likely to need looking up in the
  // gateway log as one from any dialog, and `EditProjectModal` has paired the
  // id with the sentence since §5.6 asked for it. Mock mode never carries one.
  return (
    <ErrorNote live="alert" requestId={requestId}>
      {lockedUntil ? (
        // Two lines, the second centred under the first, per the story. The
        // centring is `.auth-lock`'s own — `ErrorNote` is shared with the issue
        // panel and the project dialogs and sets no alignment for anyone.
        <span className="auth-lock">
          <LockDeadline until={lockedUntil} />
          <span>Try again later.</span>
        </span>
      ) : (
        (message ?? "Sign-in failed.")
      )}
    </ErrorNote>
  );
}

/**
 * The first of the two lines: the machine-readable instant in `dateTime`, the
 * deadline in whichever form the reader needs today, and the same moment
 * fully qualified in `title` — `formatLockDeadline` decides all three
 * (`src/lib/accountLock.ts`).
 *
 * Its own function only so the formatted pair can be a `const`; the markup is
 * the same `<span>` `.auth-lock > span` has always selected.
 */
function LockDeadline({ until }: { until: Date }) {
  const { text, title } = formatLockDeadline(until);

  return (
    <span>
      Account is locked until{" "}
      <time dateTime={until.toISOString()} title={title}>
        {text}
      </time>
    </span>
  );
}
