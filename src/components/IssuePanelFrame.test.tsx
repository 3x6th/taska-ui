import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IssuePanelFrame } from "./IssuePanelFrame";

/**
 * The panel holds Tab with the trap `Modal` uses (`trapTab`), so the two
 * dialogs of the product cannot disagree about where Tab goes. Pinned here for
 * the case art-director found on TAS-149: a place script put focus that is not
 * a stop — the panel's archive line is one (DESIGN.md §5.7) — with no stop
 * after it or none before it.
 */
describe("IssuePanelFrame", () => {
  it("wraps Tab from a place focus was put when no stop follows it, and leaves the browser its order where one does", () => {
    render(
      <>
        <button type="button">Behind the scrim</button>
        <IssuePanelFrame fallbackFocus={() => null} onClose={() => {}}>
          <button type="button">Comment</button>
          <p data-testid="archive-line" tabIndex={-1}>
            This project was archived on Oct 20, so this issue is read-only.
          </p>
        </IssuePanelFrame>
      </>,
    );
    const close = screen.getByRole("button", { name: "Close" });
    const comment = screen.getByRole("button", { name: "Comment" });
    const line = screen.getByTestId("archive-line");

    line.focus();
    expect(fireEvent.keyDown(line, { key: "Tab" })).toBe(false);
    expect(close).toHaveFocus();

    // Shift+Tab from the line has Comment behind it: the browser's own order.
    line.focus();
    expect(fireEvent.keyDown(line, { key: "Tab", shiftKey: true })).toBe(true);

    // And from Close, the first stop, it wraps to the last.
    close.focus();
    expect(fireEvent.keyDown(close, { key: "Tab", shiftKey: true })).toBe(false);
    expect(comment).toHaveFocus();
  });
});
