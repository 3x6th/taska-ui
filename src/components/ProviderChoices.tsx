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
 *   `--provider-mono` — black on the light button, white on the dark one. The
 *   Apple button's words are `--provider-mono` too (`.provider-button-apple`):
 *   Apple's rule is black or white, and Google's `--provider-fg` is neither.
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
  // Apple's own artwork, not a redrawing: the path of the «logo and text»
  // button at its medium size (a 31 × 44 box, the logo 17 wide), as Apple's
  // Sign in with Apple JS (`appleid.auth.js`) draws it — copied unchanged,
  // and drawn uncropped across the button's full height (§4.31). The view box
  // is the logo's 17-wide column of that file, `x` 7 to 24; the glyph begins
  // 0.75 into it, which `.provider-mark-apple` accounts for.
  return (
    <svg aria-hidden="true" className="provider-mark provider-mark-mono provider-mark-apple" focusable="false" viewBox="7 0 17 44">
      <path d="M15.7099491,14.8846154 C16.5675461,14.8846154 17.642562,14.3048315 18.28274,13.5317864 C18.8625238,12.8312142 19.2852829,11.852829 19.2852829,10.8744437 C19.2852829,10.7415766 19.2732041,10.6087095 19.2490464,10.5 C18.2948188,10.5362365 17.1473299,11.140178 16.4588366,11.9494596 C15.9152893,12.56548 15.4200572,13.5317864 15.4200572,14.5222505 C15.4200572,14.6671964 15.4442149,14.8121424 15.4562937,14.8604577 C15.5166879,14.8725366 15.6133185,14.8846154 15.7099491,14.8846154 Z M12.6902416,29.5 C13.8618881,29.5 14.3812778,28.714876 15.8428163,28.714876 C17.3285124,28.714876 17.6546408,29.4758423 18.9591545,29.4758423 C20.2395105,29.4758423 21.0971074,28.292117 21.9063891,27.1325493 C22.8123013,25.8038779 23.1867451,24.4993643 23.2109027,24.4389701 C23.1263509,24.4148125 20.6743484,23.4122695 20.6743484,20.5979021 C20.6743484,18.1579784 22.6069612,17.0588048 22.7156707,16.974253 C21.4353147,15.1382708 19.490623,15.0899555 18.9591545,15.0899555 C17.5217737,15.0899555 16.3501271,15.9596313 15.6133185,15.9596313 C14.8161157,15.9596313 13.7652575,15.1382708 12.521138,15.1382708 C10.1536872,15.1382708 7.75,17.0950413 7.75,20.7911634 C7.75,23.0861411 8.64383344,25.513986 9.74300699,27.0842339 C10.6851558,28.4129053 11.5065162,29.5 12.6902416,29.5 Z" />
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
    <a
      aria-disabled={inFlight || undefined}
      className={provider === "APPLE" ? "provider-button provider-button-apple" : "provider-button"}
      href={href}
      onClick={onClick}
    >
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
 * A press remembers the attempt (`taska.oauthAttempt`: the provider, the tab
 * it began on and the `returnTo` it was sent) and puts every button in flight. Coming back with Back from
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
            rememberOAuthAttempt({ provider: started, tab, returnTo });
            setInFlight(true);
            onStart?.(started);
          }}
          provider={provider}
        />
      ))}
    </div>
  );
}
