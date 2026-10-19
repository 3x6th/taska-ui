import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appUrl } from "../lib/appLinks";
import { AppFailureScreen } from "./AppFailureScreen";

const { reloadAt } = vi.hoisted(() => ({ reloadAt: vi.fn() }));
vi.mock("../lib/appLinks", async (importActual) => ({
  ...(await importActual<typeof import("../lib/appLinks")>()),
  reloadAt,
}));

/**
 * TAS-173 (release-reviewer F1 on 64742b3): "Go to projects" leaves the failed
 * tree with a full load, not a router move — `reloadAt` is the load, pinned in
 * appLinks.test.ts for the hash scheme the Pages build routes by. Here: a plain
 * click hands it the projects address and keeps the browser from following the
 * link itself; a click meant for a new tab is left alone.
 */
describe("the app failure screen's way out", () => {
  afterEach(() => {
    reloadAt.mockReset();
  });

  it("loads the projects page from scratch on a plain click", () => {
    render(<AppFailureScreen error={new Error("Cannot read properties of undefined")} />);
    const link = screen.getByRole("link", { name: "Go to projects" });

    expect(link).toHaveAttribute("href", appUrl("/projects"));
    const followed = fireEvent.click(link);

    expect(followed).toBe(false);
    expect(reloadAt).toHaveBeenCalledTimes(1);
    expect(reloadAt).toHaveBeenCalledWith(appUrl("/projects"));
  });

  it("leaves a click with a modifier to the browser", () => {
    // jsdom reports the navigation it does not implement on the console.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<AppFailureScreen error={new Error("boom")} />);

    fireEvent.click(screen.getByRole("link", { name: "Go to projects" }), { ctrlKey: true });

    expect(reloadAt).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
