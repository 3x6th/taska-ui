import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { taskaApi } from "../api/client";
import { apiErrorFacts, isSignupDisabled } from "../api/errors";
import type { SignupInput } from "../api/TaskaApi";
import { displayNameProblem, trimDisplayName } from "../lib/displayName";
import { retryAfterSeconds } from "./admin/users";
import { tooManyAttemptsText } from "./authText";
import { AUTH_METHODS_QUERY_KEY } from "../hooks/useAuthMethods";

/** The minute between two sign-up links for one address (backend TAS-423), counted down on screen (§4.31). */
export const RESEND_COOLDOWN_SECONDS = 60;

/** Where the panel puts focus next. A fresh object per request, so the same target twice still moves it. */
export type SignupFocus = { target: "title" | "name" | "email" } | null;

/**
 * Create account and «Check your email» (DESIGN.md §4.31), as state the card
 * holds rather than the panel: what was typed stays in memory across a tab
 * change, and so does «Check your email» with its countdown — the card is what
 * lives as long as the reader is on it, the panel only while its tab is.
 *
 * Neither request is ever retried (guard B1): a second send is a second email,
 * and the minute between two is the server's to count.
 */
export function useSignup() {
  const queryClient = useQueryClient();
  const [name, setNameValue] = useState("");
  /** The name has been changed or a send attempted: from then on its reason, if any, is shown (§5.9). */
  const [nameChecked, setNameChecked] = useState(false);
  const [email, setEmail] = useState("");
  /** What the last accepted request sent — «Check your email» is about it, and Resend sends it again. */
  const [sent, setSent] = useState<SignupInput | null>(null);
  /** Whether the text says a link went *again* (§4.31: «we’ve sent another link there»). */
  const [resent, setResent] = useState(false);
  /** The last resend was refused for its rate (429): the hint says so while the wait runs. */
  const [tooMany, setTooMany] = useState(false);
  /** When Resend opens again, and the clock the countdown is drawn from — both set by events, never read in render. */
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(0);
  /** The sentence the hidden status region says, keyed so the same sentence twice is said twice. */
  const [announcement, setAnnouncement] = useState<{ key: number; text: string } | null>(null);
  const [focus, setFocus] = useState<SignupFocus>(null);
  /**
   * The request the panel has carried out. The panel mounts afresh on every
   * change to its tab, and a request it carried out before must not pull focus
   * off the tab the reader just chose — the arrows walk the tabs (§4.27).
   */
  const focusTaken = useRef<SignupFocus>(null);
  const takeFocus = useCallback((): SignupFocus => {
    if (focus === null || focus === focusTaken.current) return null;
    focusTaken.current = focus;
    return focus;
  }, [focus]);

  const startCountdown = (seconds: number) => {
    const at = Date.now();
    setNow(at);
    setResendAt(at + seconds * 1000);
  };

  // A refusal saying sign-up is off re-reads the methods (§4.31, guard B4) —
  // and only such a refusal: never a re-read per press.
  const rereadMethodsOn = (error: unknown) => {
    if (isSignupDisabled(error)) void queryClient.invalidateQueries({ queryKey: AUTH_METHODS_QUERY_KEY });
  };

  const request = useMutation({
    mutationFn: (input: SignupInput) => taskaApi.requestSignup(input),
    retry: false,
    onSuccess: (_answer, input) => {
      setSent(input);
      setResent(false);
      setTooMany(false);
      setAnnouncement(null);
      startCountdown(RESEND_COOLDOWN_SECONDS);
      setFocus({ target: "title" });
    },
    onError: rereadMethodsOn,
  });

  const resend = useMutation({
    mutationFn: (input: SignupInput) => taskaApi.requestSignup(input),
    retry: false,
    onSuccess: (_answer, input) => {
      setResent(true);
      setTooMany(false);
      startCountdown(RESEND_COOLDOWN_SECONDS);
      setAnnouncement((last) => ({
        key: (last?.key ?? 0) + 1,
        text: `If ${input.email} can be used for a new Taska account, we’ve sent another link there. Open it to choose your password.`,
      }));
    },
    onError: (error) => {
      rereadMethodsOn(error);
      const { status, code } = apiErrorFacts(error);
      if (code !== "RESOURCE_EXHAUSTED" && status !== 429) return;
      // The countdown starts again from the server's number; without one, from the minute.
      const seconds = retryAfterSeconds(error);
      setTooMany(true);
      startCountdown(seconds ?? RESEND_COOLDOWN_SECONDS);
      setAnnouncement((last) => ({ key: (last?.key ?? 0) + 1, text: tooManyAttemptsText(seconds) }));
    },
  });

  const counting = sent !== null && now < resendAt;

  // Once a second while the wait runs, on the second's edge so «0:42» turns
  // into «0:41» when it should. Nothing ticks once it has run out.
  useEffect(() => {
    if (!counting) return;
    let timer = 0;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const left = resendAt - current;
      if (left > 0) timer = window.setTimeout(tick, left % 1000 || 1000);
    };
    timer = window.setTimeout(tick, (resendAt - Date.now()) % 1000 || 1000);
    return () => window.clearTimeout(timer);
  }, [counting, resendAt]);

  const nameProblem = nameChecked ? displayNameProblem(name) : null;

  return {
    name,
    setName: (value: string) => {
      setNameValue(value);
      setNameChecked(true);
    },
    nameProblem,
    email,
    setEmail,
    sent,
    resent,
    tooMany,
    counting,
    /** Milliseconds until Resend opens; only meaningful while `counting`. */
    remaining: resendAt - now,
    announcement,
    /** The focus request not yet carried out, once: the panel's effect takes it. */
    takeFocus,
    request,
    resend,
    /** Continue: the name's reason first, then one request. Enter while it is out sends nothing. */
    submit: () => {
      if (request.isPending) return;
      if (displayNameProblem(name) !== null) {
        setNameChecked(true);
        setFocus({ target: "name" });
        return;
      }
      request.mutate({ email: email.trim(), displayName: trimDisplayName(name) });
    },
    /** Resend link: the same address and name again — refused by the handler while the wait runs or a send is out. */
    sendAgain: () => {
      if (sent === null || counting || resend.isPending) return;
      resend.reset();
      resend.mutate(sent);
    },
    /** «Use a different email»: back to the form with both values, focus in Email. */
    backToForm: () => {
      setSent(null);
      setAnnouncement(null);
      resend.reset();
      request.reset();
      setFocus({ target: "email" });
    },
    /** A tab change takes refusals away, as on the other tabs; what was typed and sent stays. */
    dropRefusals: () => {
      request.reset();
      resend.reset();
    },
  };
}

export type SignupState = ReturnType<typeof useSignup>;
