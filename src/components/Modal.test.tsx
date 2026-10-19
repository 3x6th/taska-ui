import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

function renderModal() {
  const onClose = vi.fn();
  render(
    <>
      <button type="button">Behind the scrim</button>
      <Modal onClose={onClose} title="Invite user">
        <label>
          Email
          <input />
        </label>
        <button disabled type="button">
          Not a stop
        </button>
        <div className="modal-actions">
          <button type="button">Cancel</button>
          <button type="submit">Send invitation</button>
        </div>
      </Modal>
    </>,
  );
  return { onClose, dialog: screen.getByRole("dialog", { name: "Invite user" }) };
}

/**
 * The two §7 entries TAS-299 closes for every modal: the scrim is not a Tab
 * stop, and Tab cannot walk out of the dialog into the page behind it. The
 * walk itself, with the ring at every stop, is `e2e/focus-ring.spec.ts`.
 */
describe("Modal", () => {
  it("keeps the backdrop out of the Tab order and still closes on a click on it", () => {
    const { onClose } = renderModal();
    const backdrop = screen.getByRole("button", { name: "Close modal" });

    expect(backdrop).toHaveAttribute("tabindex", "-1");
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("wraps Tab from the last stop to the first, and Shift+Tab from the first to the last", () => {
    const { dialog } = renderModal();
    const close = screen.getByRole("button", { name: "Close" });
    const send = screen.getByRole("button", { name: "Send invitation" });

    send.focus();
    expect(fireEvent.keyDown(send, { key: "Tab" })).toBe(false);
    expect(close).toHaveFocus();

    expect(fireEvent.keyDown(close, { key: "Tab", shiftKey: true })).toBe(false);
    expect(send).toHaveFocus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("leaves Tab between the ends to the browser", () => {
    renderModal();
    const field = screen.getByLabelText("Email");
    field.focus();

    // Not prevented: the browser's own order moves focus on from here.
    expect(fireEvent.keyDown(field, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(field, { key: "Tab", shiftKey: true })).toBe(true);
    expect(field).toHaveFocus();
  });
});
