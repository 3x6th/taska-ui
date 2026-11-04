import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { companiesHarness } from "../test/companiesHarness";
import { CompanyClosedScreen, CompanyUnavailableScreen } from "./CompanyClosedScreen";

/* DESIGN.md §4.35 (TAS-500): the company is closed to the reader, at the same address. */

describe("the closed company", () => {
  it("says why from the refusal, with no request id, and offers the picker and Log out; focus on the heading", () => {
    const { wrapper } = companiesHarness({ companyId: "g", path: "/projects" });
    const onLogout = vi.fn();
    render(<CompanyClosedScreen name="Globex" onLogout={onLogout} refusal={{ code: "MEMBERSHIP_INACTIVE", reasons: [], message: null }} />, {
      wrapper,
    });
    const heading = screen.getByRole("heading", { level: 1, name: "You no longer have access to Globex" });
    expect(heading).toHaveFocus();
    expect(screen.getByText(/Your membership was suspended or removed/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose a company" })).toHaveAttribute("href", "/companies");
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("prints the server's words for a code outside the table", () => {
    const { wrapper } = companiesHarness({ companyId: "m", path: "/projects" });
    render(
      <CompanyClosedScreen name={null} onLogout={() => {}} refusal={{ code: "INVALID_STATE", reasons: [], message: "The company is closed" }} />,
      { wrapper },
    );
    expect(screen.getByRole("heading", { name: "This company could not be opened" })).toBeInTheDocument();
    expect(screen.getByText("The company is closed")).toBeInTheDocument();
  });

  it("an entry with no answer is §4.18's refusal variant: the server's words, the id, Try again", () => {
    const { wrapper } = companiesHarness({ companyId: "g", path: "/projects" });
    const onRetry = vi.fn();
    const error = Object.assign(new Error("Gateway timeout"), { status: 504, code: "UNAVAILABLE", requestId: "rid-504" });
    const { rerender } = render(<CompanyUnavailableScreen error={error} name="Globex" onRetry={onRetry} retrying={false} />, { wrapper });
    expect(screen.getByRole("heading", { name: "Globex could not be opened" })).toHaveFocus();
    expect(screen.getByText("Gateway timeout")).toBeInTheDocument();
    expect(screen.getByText("rid-504")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<CompanyUnavailableScreen error={error} name="Globex" onRetry={onRetry} retrying />);
    expect(screen.getByRole("button", { name: "Try again" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
