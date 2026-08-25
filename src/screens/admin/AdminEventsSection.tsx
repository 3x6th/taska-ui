import { NavLink, Outlet } from "react-router-dom";

/**
 * The Events section (DESIGN.md §5.8) — transactional outbox diagnostics: what
 * is stuck, where, and for how long.
 *
 * Two views under one section head. **Problems** is the summary across every
 * service at once and is the section's root, because people arrive here asking
 * "what broke" and the counters answer that before the first click.
 * **Outbox** is the journal of one service's `outbox_events`, which is where
 * someone goes who already knows what they are looking for.
 *
 * The switch is navigation, not state: the view is part of the address, so two
 * `NavLink`s in a segmented control (§4.2) rather than two buttons, and
 * `aria-current` comes from the router's own match instead of being asserted
 * here.
 */
export function AdminEventsSection() {
  return (
    <div className="admin-events">
      {/* A nav, because these are two addresses. `end` on the first: without it
          the summary's link would match every journal address below it and both
          segments would claim to be current. */}
      <nav aria-label="Events views" className="admin-seg admin-events-views">
        <NavLink className="admin-seg-link" end to="/admin/events">
          Problems
        </NavLink>
        <NavLink className="admin-seg-link" to="/admin/events/outbox">
          Outbox
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
