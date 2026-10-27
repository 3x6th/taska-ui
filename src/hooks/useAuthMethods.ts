import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { taskaApi } from "../api/client";
import type { AuthMethods, OAuthProvider } from "../domain/types";

export const AUTH_METHODS_QUERY_KEY = ["auth-methods"] as const;

/**
 * `localStorage` `taska.authMethods` (DESIGN.md §4.31): the last answer of
 * `GET /auth/methods`, kept only to draw the card's first frame the way it
 * will most likely end up — **a hint, never a decision**. Nothing the server
 * enforces is decided from it: the answer replaces it on every mount, and a
 * press that the server refuses is refused there. The route is `no-store`;
 * that is about HTTP caches, and this is the screen's own memory of what it
 * drew last time.
 */
export const AUTH_METHODS_HINT_KEY = "taska.authMethods";

/** No hint and no answer: today's screen — no sign-up, no providers. */
export const AUTH_METHODS_CLOSED: AuthMethods = { signupEnabled: false, providers: [] };

const PROVIDERS: readonly OAuthProvider[] = ["GOOGLE", "GITHUB", "APPLE"];

/** A stored hint, read as narrowly as the server's answer is: anything else is no hint. */
export function readAuthMethodsHint(): AuthMethods | null {
  try {
    const raw = window.localStorage.getItem(AUTH_METHODS_HINT_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { signupEnabled, providers } = parsed as Record<string, unknown>;
    if (!Array.isArray(providers)) return null;
    const known = PROVIDERS.filter((provider) => providers.includes(provider));
    return { signupEnabled: signupEnabled === true, providers: known };
  } catch {
    return null;
  }
}

export function rememberAuthMethods(methods: AuthMethods): void {
  try {
    window.localStorage.setItem(AUTH_METHODS_HINT_KEY, JSON.stringify(methods));
  } catch {
    // Nowhere to keep it: the next first frame is drawn closed.
  }
}

/**
 * The sign-in card's methods: read on **every mount** of the card, without a
 * spinner and without an error line — the `/meta` precedent (§4.2). Until it
 * answers, and if it fails, the stored hint stands in; without one, the
 * closed set. Never re-read on focus or per press — only on mount, and when a
 * refusal says sign-up is off (`SIGNUP_DISABLED` invalidates this key).
 */
export function useAuthMethods(): AuthMethods {
  const [hint] = useState(readAuthMethodsHint);
  const { data } = useQuery({
    queryKey: AUTH_METHODS_QUERY_KEY,
    queryFn: async () => {
      const methods = await taskaApi.getAuthMethods();
      rememberAuthMethods(methods);
      return methods;
    },
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  return data ?? hint ?? AUTH_METHODS_CLOSED;
}
