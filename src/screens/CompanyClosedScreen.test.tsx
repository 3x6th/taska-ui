import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { companiesHarness } from "../test/companiesHarness";
import { CompanyClosedScreen, CompanyUnavailableScreen } from "./CompanyClosedScreen";

/* DESIGN.md §4.35 (TAS-500): the company is closed to the reader, at the same address. */

describe("the closed company", () => {
  it("says why from the refusal, with no request id, and offers the picker and Log out; focus on the heading", () => {
    const { wrapper } = companiesHarness({ companyId: "g", path: "/projects" });
    const onLogout = vi.fn();
    render(<CompanyClosedScreen name="Globex" onLogout={onLogout} refusal={{ code: "MEMBERSHIP_INACTIVE", reasons: [], message: "Membership is not active", requestId: "rid-m" }} />, {
      wrapper,
    });
    const heading = screen.getByRole("heading", { level: 1, name: "You no longer have access to Globex" });
    expect(heading).toHaveFocus();
    expect(screen.getByText(/Your membership was suspended or removed/)).toBeInTheDocument();
    // An answer, not a failure: no request id and not the server's words.
    expect(screen.queryByText("rid-m")).not.toBeInTheDocument();
    expect(screen.queryByText("Membership is not active")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose a company" })).toHaveAttribute("href", "/companies");
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("on the table's last row prints the server's words and the request id", () => {
    const { wrapper } = companiesHarness({ companyId: "m", path: "/projects" });
    render(
      <CompanyClosedScreen
        name={null}
        onLogout={() => {}}
        refusal={{ code: "TENANT_MISMATCH", reasons: [], message: "Tenant mismatch", requestId: "rid-mismatch" }}
      />,
      { wrapper },
    );
    expect(screen.getByRole("heading", { name: "This company could not be opened" })).toBeInTheDocument();
    expect(screen.getByText("Tenant mismatch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy request id rid-mismatch" })).toBeInTheDocument();
  });

  it("says «this company» inside a sentence and «This company» at its start", () => {
    const { wrapper } = companiesHarness({ companyId: "u", path: "/projects" });
    render(
      <CompanyClosedScreen name={null} onLogout={() => {}} refusal={{ code: "MEMBERSHIP_INACTIVE", reasons: [], message: null, requestId: null }} />,
      { wrapper },
    );
    expect(screen.getByRole("heading", { name: "You no longer have access to this company" })).toBeInTheDocument();
  });

  it("a content read refused for a pause says the company is paused, from the reasons", () => {
    const { wrapper } = companiesHarness({ companyId: "i", path: "/projects" });
    render(
      <CompanyClosedScreen
        name="Initech"
        onLogout={() => {}}
        refusal={{ code: "CAPABILITY_DISABLED", reasons: ["OWNER_PAUSE"], message: "Project content is not available", requestId: "rid-c" }}
      />,
      { wrapper },
    );
    expect(screen.getByRole("heading", { name: "Initech is paused" })).toBeInTheDocument();
    expect(screen.queryByText("rid-c")).not.toBeInTheDocument();
  });

  it("an entry with no answer is §4.18's refusal variant: the server's words, the id, Try again", () => {
    const { wrapper } = companiesHarness({ companyId: "g", path: "/projects" });
    const onRetry = vi.fn();
    const error = Object.assign(new Error("Gateway timeout"), { status: 504, code: "UNAVAILABLE", requestId: "rid-504" });
    const { rerender } = render(<CompanyUnavailableScreen error={error} name="Globex" onRetry={onRetry} retrying={false} />, { wrapper });
    expect(screen.getByRole("heading", { name: "Globex could not be opened" })).toHaveFocus();
    expect(screen.getByText("Taska could not open this company right now. Nothing in it is known yet.")).toBeInTheDocument();
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
