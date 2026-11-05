import { useId, useRef, useState, type MouseEvent } from "react";
import { ArrowLeftRight, LogOut, Settings, Settings2, ShieldCheck } from "lucide-react";
import { COMPANIES_ROUTE } from "../lib/companies";
import { COMPANY_ZONE, inCompanyZone } from "../screens/company/sections";
import { useCompanyMarker, useCompanyName } from "../hooks/useCompanies";
import { AddressLink } from "./CompanyRouter";
import { CompanyMarkerWord } from "./CompanyMarkerWord";
import { useCompanyAddress } from "../lib/companyAddress";
import { Link, useLocation } from "react-router-dom";
import type { User } from "../domain/types";
import { useDismissOnOutside } from "../hooks/useDismissOnOutside";
import { useMeta } from "../hooks/useMeta";
import { globalRoleLabel, userStatusLabel } from "../lib/format";
import { Avatar } from "./Avatar";

interface UserProfileMenuProps {
  user?: User;
  loading?: boolean;
  loggingOut?: boolean;
  onLogout: () => void;
}

/** Whether `pathname` is inside the area at `root` — the area itself or any of its sections. */
const insideArea = (pathname: string, root: string) => pathname === root || pathname.startsWith(`${root}/`);

export function UserProfileMenu({ user, loading = false, loggingOut = false, onLogout }: UserProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const location = useLocation();
  const meta = useMeta();
  // The entry exists only for an account the server called GLOBAL_ADMIN. A
  // gateway that states no role counts as not an admin, which is lossy in the
  // safe direction (docs/ai/API-DIVERGENCE.md).
  const isGlobalAdmin = user?.globalRole === "GLOBAL_ADMIN";
  // The companies build (TAS-500, §4.16): the tab's company first in the list,
  // «Taska role» for the account's role beside it, «Switch company» on top of
  // the actions, and no Administration for anyone (TAS-510).
  const address = useCompanyAddress();
  const companies = address !== null;
  const companyName = useCompanyName(address?.companyId ?? null);
  // TAS-512 (§4.34): the company's state, after its name — the only place it is seen below 768.
  const marker = useCompanyMarker(address?.companyId ?? null);
  // Read off the address rather than `getTenancy()`: only the companies build
  // has one, and so this component asks nothing of an API it does not need.
  const adminConsole = !companies;

  // Escape and a press outside, from the hook the notifications popover and the
  // global search dropdown share (§4.16, §7). This used to be the only copy in
  // the product, which is exactly why the other two shipped without it. Escape
  // hands focus back to the trigger (TAS-380): the row that had it went with
  // the popover.
  useDismissOnOutside(open, rootRef, () => setOpen(false), triggerRef);

  /**
   * A plain click on one of the two link rows closes the popover. A modified
   * click opens the page in a new tab and leaves this one as it is, so the
   * menu it was opened from stays open.
   *
   * Closing the popover unmounts the item that had focus, so it goes back to
   * the trigger (§7). What this actually covers is the case where no route
   * change follows — opening the menu while already on that page and choosing
   * it again. On a real navigation the route swap unmounts this trigger a tick
   * later and focus ends up on <body> anyway; that is true of every in-app
   * link, not of these rows, and is recorded in docs/ai/BACKLOG.md rather than
   * patched here.
   */
  const followLink = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    setOpen(false);
    triggerRef.current?.focus();
  };

  /**
   * «Manage company» (TAS-522, §4.16, §5.10), the switcher's row (§4.34) on
   * the narrow screen that has no switcher: a modified click is `followLink`'s
   * — a new tab, this menu left open. A plain one closes the menu in the frame
   * of the click and leaves focus to the zone, whose heading takes it from the
   * link's state; the trigger does not, unlike the rows above.
   */
  const followManage = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    setOpen(false);
  };

  const person = user;

  return (
    <div className="user-profile-menu" ref={rootRef}>
      <button
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={user ? `Open profile for ${user.displayName}` : "Open profile"}
        className="user-profile-trigger"
        // Enabled as soon as the query settles, whether or not it produced a
        // user. Requiring `user` meant that a profile which failed to load —
        // a 5xx, a network drop, a CORS refusal, none of which clear the
        // tokens — took Log out down with it, and with /login bouncing anyone
        // holding tokens the only way out was to clear site data.
        disabled={loading}
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        type="button"
      >
        <Avatar user={person} label="Current user" loading={loading} size="md" />
      </button>

      {open ? (
        <section aria-label="Current user profile" className="user-profile-popover" id={popoverId} role="dialog">
          {person ? (
            <>
              <header className="user-profile-head">
                <Avatar user={person} size="lg" />
                <div>
                  <strong>{person.displayName}</strong>
                  {/* The address the account signs in with and the one thing
                      a namesake cannot share (§4.16, TAS-389): whole, never
                      cut, so it is not repeated in the list below. */}
                  <span>{person.email}</span>
                </div>
              </header>
              <dl className="user-profile-details">
                {companies && address?.companyId ? (
                  <div className="user-profile-company-row">
                    <dt>Company</dt>
                    <dd className="user-profile-company">
                      {companyName ?? "This company"}
                      {marker ? (
                        <>
                          {" "}
                          <CompanyMarkerWord company={companyName} marker={marker} />
                        </>
                      ) : null}
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt>Status</dt>
                  <dd>
                    {/* An unmodelled value keeps the quiet base pill: the
                        modifier simply does not match a rule, which is the
                        right answer for a status this build cannot interpret.
                        The label is the one rule every dictionary follows
                        (`userStatusLabel`): the build's word, a served English
                        name, or the value as received — and "—" for the
                        `null` an absent status arrives as (TAS-173), which
                        used to throw on `toLowerCase` and take the menu down. */}
                    <span className={`user-status is-${(person.status ?? "").toLowerCase()}`}>
                      {userStatusLabel(person.status, meta?.userStatuses)}
                    </span>
                  </dd>
                </div>
                {/* A gateway that does not state the role gets no row at all:
                    "Unknown" would read as a fact about the account rather than
                    about the response. */}
                {person.globalRole ? (
                  <div>
                    <dt>{companies ? "Taska role" : "Role"}</dt>
                    <dd>{globalRoleLabel(person.globalRole)}</dd>
                  </div>
                ) : null}
              </dl>
            </>
          ) : (
            // Nothing invented about who this is — only that we could not find
            // out, and that leaving is still possible.
            <p className="user-profile-unknown">Your profile could not be loaded.</p>
          )}
          {/* One divider above the rows — this block's own top border —
              and none between them: Log out is already set apart by
              `--danger` (§4.16, art-director's ruling 6 on TAS-380). */}
          <div className="user-profile-actions">
            {companies ? (
              <AddressLink
                className="user-profile-link"
                onFollow={() => setOpen(false)}
                path={COMPANIES_ROUTE}
                state={{ focusHeading: true }}
              >
                <ArrowLeftRight aria-hidden="true" size={15} />
                Switch company
              </AddressLink>
            ) : null}
            {/* The tab's company's zone (TAS-522, §5.10), for every role, in a
                tab that has a company. Drawn below 768 only, where the bar has
                no switcher and so no «Manage company» of its own — at 768 and
                wider the CSS takes it out, `display: none`, the accessibility
                tree included. A router link inside the company's prefix, as
                the switcher's is; inside the zone it says so with
                `aria-current` alone, as Settings does. */}
            {companies && address?.companyId ? (
              <Link
                aria-current={inCompanyZone(location.pathname) ? "page" : undefined}
                className="user-profile-link user-profile-manage"
                onClick={followManage}
                state={{ focusHeading: true }}
                to={COMPANY_ZONE}
              >
                <Settings2 aria-hidden="true" size={15} />
                Manage company
              </Link>
            ) : null}
            {/* Every reader, and even when the profile did not load: Appearance
                needs no profile, and My profile says for itself that it could
                not read one. A link, as Administration is: it navigates, so it
                has to be middle-clickable and copyable. */}
            <Link
              aria-current={insideArea(location.pathname, "/settings") ? "page" : undefined}
              className="user-profile-link"
              onClick={followLink}
              to="/settings"
            >
              <Settings aria-hidden="true" size={15} />
              Settings
            </Link>
            {isGlobalAdmin && adminConsole ? (
              // Absent — not disabled, not hidden — for everyone else; hiding it
              // is not the permission control, the server is
              // (`/api/v1/readonly/*` is GLOBAL_ADMIN-only and enumerates
              // 401/403).
              <Link
                // Opened from /admin itself, the entry leads nowhere new, and
                // saying so is one attribute. Any section counts: /admin is an
                // area that redirects into /admin/data (§5.8), so an exact
                // match would be true for a single tick and never again.
                aria-current={insideArea(location.pathname, "/admin") ? "page" : undefined}
                className="user-profile-link"
                onClick={followLink}
                to="/admin"
              >
                <ShieldCheck aria-hidden="true" size={15} />
                Administration
              </Link>
            ) : null}
            <button className="user-profile-logout" disabled={loggingOut} onClick={onLogout} type="button">
              <LogOut aria-hidden="true" size={15} />
              {loggingOut ? "Logging out…" : "Log out"}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
