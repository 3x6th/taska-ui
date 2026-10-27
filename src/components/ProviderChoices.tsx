import { useEffect, useState, type MouseEvent } from "react";
import { taskaApi } from "../api/client";
import googleMark from "../assets/provider-google-g.svg";
import type { OAuthProvider } from "../domain/types";
import { rememberOAuthAttempt } from "../lib/oauthCallback";

/**
 * The marks of the three sign-in providers (DESIGN.md §2.8, §4.31). The only
 * brand colour in the product, and only here:
 *
 * - Google's G is Google's file unchanged (`src/assets/provider-google-g.svg`,
 *   the G of Google's sign-in button), drawn as an image so its four colours
 *   stay in that file and never pass through a stylesheet that could tint it;
 * - GitHub's Invertocat and Apple's logo are single-colour marks, filled with
 *   `--provider-mono` — black on the light button, white on the dark one.
 *
 * All three are decoration: `aria-hidden`, the button's words are its name.
 */
function ProviderMark({ provider }: { provider: OAuthProvider }) {
  if (provider === "GOOGLE") {
    return <img alt="" aria-hidden="true" className="provider-mark" draggable={false} src={googleMark} />;
  }
  if (provider === "GITHUB") {
    return (
      <svg aria-hidden="true" className="provider-mark provider-mark-mono" focusable="false" viewBox="0 0 16 16">
        <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className="provider-mark provider-mark-mono" focusable="false" viewBox="0 0 24 24">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

const LABELS: Readonly<Record<OAuthProvider, string>> = {
  GOOGLE: "Continue with Google",
  GITHUB: "Continue with GitHub",
  APPLE: "Continue with Apple",
};

/**
 * One provider's button (§4.31): a real link to the address `oauthStartUrl`
 * built, so the press is a page navigation the browser shows the progress of —
 * no spinner, and no request from this app. `inFlight` is §4.1's in-flight
 * recipe on every provider button once any was pressed: `aria-disabled`,
 * `cursor: progress`, the words unchanged, and a second press refused — a
 * second start would replace the first one's state cookie and the first return
 * would meet `STATE_INVALID`.
 *
 * Only a plain press starts the flow here; a press with a modifier, or the
 * middle button, is the browser's to open elsewhere, and leaves this page as
 * it was.
 */
function ProviderButton({
  provider,
  href,
  inFlight,
  onStart,
}: {
  provider: OAuthProvider;
  href: string;
  inFlight: boolean;
  onStart: (provider: OAuthProvider) => void;
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (inFlight) {
      event.preventDefault();
      return;
    }
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    onStart(provider);
  };
  return (
    <a aria-disabled={inFlight || undefined} className="provider-button" href={href} onClick={onClick}>
      <ProviderMark provider={provider} />
      <span>{LABELS[provider]}</span>
    </a>
  );
}

/** The client's order (§4.31), whatever order the answer lists them in. */
const ORDER: readonly OAuthProvider[] = ["GOOGLE", "GITHUB", "APPLE"];

/**
 * The provider buttons under a form (§4.31): the «or» rule, then one button per
 * provider the answer lists, in the client's order. Nothing at all when it
 * lists none — the screen is then the one it was before TAS-426.
 *
 * A press remembers the attempt (`taska.oauthAttempt`: the provider and the
 * tab it began on) and puts every button in flight. Coming back with Back from
 * the provider's page restores this page from the bfcache with that state
 * still on it, so `pageshow` with `persisted` takes it off.
 */
export function ProviderChoices({
  providers,
  returnTo,
  tab,
  divider = true,
  onStart,
}: {
  providers: readonly string[];
  returnTo: string;
  tab: string;
  /** The «or» rule above the buttons; off where the button stands alone (an expired name step). */
  divider?: boolean;
  onStart?: (provider: OAuthProvider) => void;
}) {
  const [inFlight, setInFlight] = useState(false);
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setInFlight(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);
  const shown = ORDER.filter((provider) => providers.includes(provider));
  if (shown.length === 0) return null;
  return (
    <div className="auth-providers">
      {divider ? <p className="auth-divider">or</p> : null}
      {shown.map((provider) => (
        <ProviderButton
          href={taskaApi.oauthStartUrl(provider, returnTo)}
          inFlight={inFlight}
          key={provider}
          onStart={(started) => {
            rememberOAuthAttempt({ provider: started, tab });
            setInFlight(true);
            onStart?.(started);
          }}
          provider={provider}
        />
      ))}
    </div>
  );
}
