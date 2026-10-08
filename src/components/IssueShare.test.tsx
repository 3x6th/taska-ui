import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appUrl } from "../lib/appLinks";
import { IssueShare } from "./IssueShare";

/**
 * TAS-248. The popover's ways in and out, and the two answers a Copy button can
 * get: the clipboard took the link, or it did not and the reader is shown how
 * to take it by hand. Keyboard activation itself (Enter and Space on the
 * trigger) is a native button's and is driven in a real browser instead, in
 * `e2e/issue-share.spec.ts`.
 */
const SHORT = appUrl("/browse/API-5");
const FULL = appUrl("/projects/project-1/issues/issue-1");

function renderShare() {
  render(
    <>
      <IssueShare issueId="issue-1" issueKey="API-5" projectId="project-1" />
      <button type="button">Somewhere else</button>
    </>,
  );
  return {
    trigger: screen.getByRole("button", { name: "Share issue API-5" }),
    outside: screen.getByRole("button", { name: "Somewhere else" }),
  };
}

function stubClipboard(writeText: ((value: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

/** Lets a settled clipboard promise reach state. */
const settle = () => act(async () => {});

afterEach(() => {
  stubClipboard(undefined);
  vi.useRealTimers();
});

describe("IssueShare", () => {
  it("offers the short link and the full link, in the scheme the app routes by", () => {
    const { trigger } = renderShare();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("title", "Share");

    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Share API-5" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", dialog.id);
    const short = within(dialog).getByRole("textbox", { name: "Short link" });
    const full = within(dialog).getByRole("textbox", { name: "Full link" });
    expect(short).toHaveValue(SHORT);
    expect(short).toHaveAttribute("readonly");
    expect(short).toHaveAttribute("title", SHORT);
    expect(SHORT).toMatch(/\/browse\/API-5$/);
    expect(full).toHaveValue(FULL);
    expect(FULL).toMatch(/\/projects\/project-1\/issues\/issue-1$/);
    // Absolute, from this page's own origin — nothing names a host.
    expect(SHORT.startsWith(window.location.origin)).toBe(true);
    expect(within(dialog).getByRole("button", { name: "Copy short link" })).toHaveTextContent("Copy");
    expect(within(dialog).getByRole("button", { name: "Copy full link" })).toHaveTextContent("Copy");
    // The answer region is there before any answer, and empty.
    expect(within(dialog).getByRole("status")).toBeEmptyDOMElement();
  });

  it("closes on Escape and puts focus back on the trigger", () => {
    const { trigger } = renderShare();
    fireEvent.click(trigger);
    screen.getByRole("button", { name: "Copy full link" }).focus();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on a press outside and leaves focus to the press", () => {
    const { trigger } = renderShare();
    fireEvent.click(trigger);
    screen.getByRole("button", { name: "Copy short link" }).focus();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();
  });

  it("toggles from its own trigger without a close and a reopen on one press", () => {
    const { trigger } = renderShare();
    fireEvent.click(trigger);
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when focus moves on past it, and not when it moves inside or nowhere", () => {
    const { trigger, outside } = renderShare();
    fireEvent.click(trigger);
    const lastCopy = screen.getByRole("button", { name: "Copy full link" });

    // Shift+Tab back onto the trigger, and a press that focuses nothing.
    fireEvent.focusOut(lastCopy, { relatedTarget: trigger });
    fireEvent.focusOut(lastCopy, { relatedTarget: null });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Tab past the last control.
    fireEvent.focusOut(lastCopy, { relatedTarget: outside });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("copies each link and says which one in the polite region, for two seconds", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const { trigger } = renderShare();
    fireEvent.click(trigger);
    const status = screen.getByRole("status");

    fireEvent.click(screen.getByRole("button", { name: "Copy short link" }));
    await settle();
    expect(writeText).toHaveBeenLastCalledWith(SHORT);
    expect(status).toHaveTextContent("Short link copied");

    fireEvent.click(screen.getByRole("button", { name: "Copy full link" }));
    await settle();
    expect(writeText).toHaveBeenLastCalledWith(FULL);
    expect(status).toHaveTextContent("Full link copied");
    // Focus stays where the press left it: nothing was selected for the reader.
    expect(screen.getByRole("textbox", { name: "Full link" })).not.toHaveFocus();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(status).toBeEmptyDOMElement();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("announces a second copy of the same link again", async () => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    const { trigger } = renderShare();
    fireEvent.click(trigger);
    const status = screen.getByRole("status");
    const copy = screen.getByRole("button", { name: "Copy short link" });

    fireEvent.click(copy);
    await settle();
    const first = status.firstElementChild;
    fireEvent.click(copy);
    await settle();

    expect(status).toHaveTextContent("Short link copied");
    // A new node, not the same text left in place: that is what a screen
    // reader announces a second time.
    expect(status.firstElementChild).not.toBe(first);
  });

  it("selects the link and says how to copy it by hand when the clipboard refuses", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockRejectedValue(new DOMException("Write permission denied.", "NotAllowedError"));
    stubClipboard(writeText);
    const { trigger } = renderShare();
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole("button", { name: "Copy full link" }));
    await settle();

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(
      "Couldn’t copy the full link automatically. It’s selected — press Ctrl+C or ⌘C to copy it.",
    );
    expect(status).not.toHaveTextContent(/copied/);
    const full = screen.getByRole("textbox", { name: "Full link" }) as HTMLInputElement;
    expect(full).toHaveFocus();
    expect(full.selectionStart).toBe(0);
    expect(full.selectionEnd).toBe(FULL.length);

    // An instruction stays until it has been followed — not two seconds.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(status).toHaveTextContent("Couldn’t copy the full link");
  });

  it("does the same on a page with no clipboard at all", async () => {
    stubClipboard(undefined);
    const { trigger } = renderShare();
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole("button", { name: "Copy short link" }));
    await settle();

    expect(screen.getByRole("status")).toHaveTextContent("Couldn’t copy the short link automatically.");
    const short = screen.getByRole("textbox", { name: "Short link" }) as HTMLInputElement;
    expect(short).toHaveFocus();
    expect(short.selectionEnd).toBe(SHORT.length);
  });

  it("tells a touch screen to long-press rather than to press keys", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("refused")));
    const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) => ({ matches: query === "(pointer: coarse)", media: query }) as MediaQueryList,
    );
    const { trigger } = renderShare();
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole("button", { name: "Copy short link" }));
    await settle();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Couldn’t copy the short link automatically. Touch and hold the link above to copy it.",
    );
    matchMedia.mockRestore();
  });

  it("starts with an empty answer every time it opens", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("refused")));
    const { trigger } = renderShare();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Copy short link" }));
    await settle();
    expect(screen.getByRole("status")).not.toBeEmptyDOMElement();

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(trigger);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
