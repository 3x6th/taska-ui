import { fireEvent, render, screen } from "@testing-library/react";
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
    render(<UserProfileMenu loading={false} onLogout={onLogout} />);

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
    render(<UserProfileMenu loading onLogout={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Open profile" })).toBeDisabled();
  });

  it("shows the identity once it is known", () => {
    render(<UserProfileMenu user={anna} loading={false} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Open profile for Anna Ivanova" }));

    expect(screen.getByText("Anna Ivanova")).toBeVisible();
    expect(screen.getByText("@anna")).toBeVisible();
    expect(screen.getByText("anna@example.com")).toBeVisible();
    expect(screen.queryByText("Your profile could not be loaded.")).not.toBeInTheDocument();
  });
});
