import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { User } from "../domain/types";
import { UserProfileMenu } from "./UserProfileMenu";

const anna: User = {
  id: "3f1f5a2e-0000-4000-8000-000000000001",
  login: "anna",
  email: "anna@example.com",
  displayName: "Anna Ivanova",
  status: "ACTIVE",
};

// The menu can hold a router <Link> (the Administration entry), so every case
// renders inside a router — including the ones where the entry is absent, so a
// missing router can never be what makes them pass.
const renderMenu = (props: ComponentProps<typeof UserProfileMenu>) =>
  render(
    <MemoryRouter>
      <UserProfileMenu {...props} />
    </MemoryRouter>,
  );

/**
 * The degraded case is the one that matters here. Since TAS-150 a client that
 * still holds tokens is bounced away from `/login`, so this menu is the only
 * way out of the app — and any failure of `GET /users/me` that is not a 401
 * (5xx, network, CORS; the gateway is recorded 500-ing in TAS-139) leaves the
 * tokens in place with no user to show. Gating the trigger on the user made
 * that a dead end recoverable only by clearing site data.
 */
describe("UserProfileMenu", () => {
  it("keeps the menu and Log out usable when the profile failed to load", () => {
    const onLogout = vi.fn();
    renderMenu({ loading: false, onLogout });

    const trigger = screen.getByRole("button", { name: "Open profile" });
    expect(trigger).toBeEnabled();
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog")).toBeVisible();
    // Nothing invented about who this is — only that we could not find out.
    expect(screen.getByText("Your profile could not be loaded.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("stays disabled only while the profile request is still in flight", () => {
    renderMenu({ loading: true, onLogout: vi.fn() });

    expect(screen.getByRole("button", { name: "Open profile" })).toBeDisabled();
  });

  it("shows the identity once it is known", () => {
    renderMenu({ user: anna, loading: false, onLogout: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    expect(screen.getByText("Anna Ivanova")).toBeVisible();
    expect(screen.getByText("@anna")).toBeVisible();
    expect(screen.getByText("anna@example.com")).toBeVisible();
    expect(screen.queryByText("Your profile could not be loaded.")).not.toBeInTheDocument();
  });

  it("names the global role of an admin", () => {
    renderMenu({ user: { ...anna, globalRole: "GLOBAL_ADMIN" }, loading: false, onLogout: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    expect(screen.getByText("Role")).toBeVisible();
    expect(screen.getByText("Global admin")).toBeVisible();
  });

  it("names the global role of a plain user", () => {
    renderMenu({ user: { ...anna, globalRole: "USER" }, loading: false, onLogout: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    expect(screen.getByText("Role")).toBeVisible();
    expect(screen.getByText("User")).toBeVisible();
  });

  // A gateway that predates the field, or one answering UNSPECIFIED, arrives
  // here as no role at all. The menu says nothing rather than inventing an
  // "Unknown" role for an account that certainly has one.
  it("omits the role row entirely when the server did not state one", () => {
    renderMenu({ user: anna, loading: false, onLogout: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    expect(screen.getByText("Status")).toBeVisible();
    expect(screen.queryByText("Role")).not.toBeInTheDocument();
    expect(screen.queryByText("User")).not.toBeInTheDocument();
    expect(screen.queryByText("Global admin")).not.toBeInTheDocument();
  });

  it("offers a global admin a link into the administration section", () => {
    renderMenu({ user: { ...anna, globalRole: "GLOBAL_ADMIN" }, loading: false, onLogout: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    // A link, not a button: /admin is a page, so it has to be middle-clickable
    // and copyable.
    const entry = screen.getByRole("link", { name: "Administration" });
    expect(entry).toHaveAttribute("href", "/admin");
    // Before Log out, which stays the last item in the menu.
    expect(entry.nextElementSibling).toBe(screen.getByRole("button", { name: "Log out" }));
  });

  it("closes the menu and returns focus to the trigger when the entry is chosen", () => {
    renderMenu({ user: { ...anna, globalRole: "GLOBAL_ADMIN" }, loading: false, onLogout: vi.fn() });

    const trigger = screen.getByRole("button", { name: "Open profile for Anna Ivanova" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("link", { name: "Administration" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The element that had focus has just been unmounted with the popover, so
    // without this the keyboard would be left on <body> (§7).
    expect(trigger).toHaveFocus();
  });

  // Absent from the markup, not hidden and not disabled: a plain user has no
  // Administration entry to find in the DOM at all.
  it("gives a plain user no administration entry", () => {
    renderMenu({ user: { ...anna, globalRole: "USER" }, loading: false, onLogout: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    expect(screen.getByRole("button", { name: "Log out" })).toBeVisible();
    expect(screen.queryByText("Administration")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  // An account whose role the gateway never stated counts as not an admin —
  // lossy in the safe direction (docs/ai/API-DIVERGENCE.md).
  it("gives an account with no stated role no administration entry either", () => {
    renderMenu({ user: anna, loading: false, onLogout: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    expect(screen.queryByText("Administration")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
