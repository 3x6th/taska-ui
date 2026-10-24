import { fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

/**
 * A trigger and the dialog it opens, the way every caller holds one: a state
 * flag, and the dialog mounted while it is set. `onCancel` is the content's own
 * way out (a Cancel, a Save's success), given the close so it can do something
 * around it; `after` is drawn once the dialog has closed, in the same update.
 */
function Opened({
  field,
  triggerStays = true,
  onCancel = (close) => close(),
  after,
}: {
  field?: ReactNode;
  triggerStays?: boolean;
  onCancel?: (close: () => void) => void;
  after?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [closed, setClosed] = useState(false);
  const close = () => {
    setOpen(false);
    setClosed(true);
  };
  return (
    <>
      {triggerStays || !closed ? (
        <button onClick={() => setOpen(true)} type="button">
          New project
        </button>
      ) : null}
      <button type="button">Elsewhere</button>
      {closed ? after : null}
      {open ? (
        <Modal onClose={close} title="New project">
          {field}
          <button onClick={() => onCancel(close)} type="button">
            Cancel
          </button>
        </Modal>
      ) : null}
    </>
  );
}

/** Opens the dialog from its trigger the way a keyboard does: focus on it, then the press. */
function openFrom(name = "New project") {
  const trigger = screen.getByRole("button", { name });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

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

  it("takes focus onto its first stop when nothing inside asked for it, so the trap has something to hold", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    render(
      <Modal onClose={() => {}} title="Retry outbox event">
        <input aria-label="Reason" />
      </Modal>,
    );

    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    opener.remove();
  });

  it("leaves focus where the content put it — an autoFocus field wins", () => {
    render(
      <Modal onClose={() => {}} title="New issue">
        <input aria-label="Summary" autoFocus />
      </Modal>,
    );

    expect(screen.getByLabelText("Summary")).toHaveFocus();
  });

  it("wraps from a place script put focus that is not a stop, when no stop lies that way", () => {
    // The archive line and refusal of §5.7 are `tabIndex=-1`: focus is put
    // there, Tab never stops. With no stop after the line (a Members dialog
    // whose form went with the archive), the browser's next was the page under
    // the scrim (art-director, TAS-149); with none before the eyebrow, its
    // previous was.
    render(
      <>
        <button type="button">Behind the scrim</button>
        <Modal
          eyebrow={
            <span data-testid="eyebrow" tabIndex={-1}>
              TAS
            </span>
          }
          onClose={() => {}}
          title="Members"
        >
          <input aria-label="Search" />
          <p data-testid="archive-line" tabIndex={-1}>
            This project is archived, so its members cannot be changed.
          </p>
        </Modal>
        <button type="button">After the scrim</button>
      </>,
    );
    const close = screen.getByRole("button", { name: "Close" });
    const search = screen.getByLabelText("Search");
    const line = screen.getByTestId("archive-line");
    const eyebrow = screen.getByTestId("eyebrow");

    line.focus();
    expect(fireEvent.keyDown(line, { key: "Tab" })).toBe(false);
    expect(close).toHaveFocus();

    eyebrow.focus();
    expect(fireEvent.keyDown(eyebrow, { key: "Tab", shiftKey: true })).toBe(false);
    expect(search).toHaveFocus();
  });

  it("leaves Tab from such a place to the browser while a stop lies that way", () => {
    render(
      <Modal onClose={() => {}} title="Labels">
        <p data-testid="archive-line" tabIndex={-1}>
          This project is archived, so its labels cannot be changed.
        </p>
        <button type="button">Cancel</button>
      </Modal>,
    );
    const line = screen.getByTestId("archive-line");

    line.focus();
    // Close is behind it and Cancel ahead: the browser's own order goes either way.
    expect(fireEvent.keyDown(line, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(line, { key: "Tab", shiftKey: true })).toBe(true);
    expect(line).toHaveFocus();
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

/**
 * §7's way back (TAS-299 follow-up): closing gives focus to the control the
 * dialog was opened from — whichever way it closed, and only when focus went
 * with the dialog. The ring on the way back is measured in Chromium, in
 * `e2e/focus-ring.spec.ts`; jsdom has no input modality to measure it with.
 */
describe("Modal, closing", () => {
  it("gives focus back to the control it was opened from, after Close and after the content's own Cancel", () => {
    render(<Opened field={<input aria-label="Key" autoFocus />} />);

    const trigger = openFrom();
    expect(screen.getByLabelText("Key")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();

    openFrom();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(trigger).toHaveFocus();
  });

  it("does the same under StrictMode, whose rehearsal unmount is not a close and leaves autoFocus where it landed", () => {
    render(
      <StrictMode>
        <Opened field={<input aria-label="Key" autoFocus />} />
      </StrictMode>,
    );

    const trigger = openFrom();
    expect(screen.getByLabelText("Key")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(trigger).toHaveFocus();
  });

  it("gives focus to nothing when the trigger went with the close", () => {
    render(<Opened triggerStays={false} />);

    openFrom();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "New project" })).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves focus where the caller put it on the way out", () => {
    render(
      <Opened
        onCancel={(close) => {
          close();
          screen.getByRole("button", { name: "Elsewhere" }).focus();
        }}
      />,
    );

    openFrom();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });

  it("leaves focus on what the close itself drew and focused — a new card, an opened panel", () => {
    render(<Opened after={<button autoFocus type="button">TAS-108</button>} />);

    openFrom();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "TAS-108" })).toHaveFocus();
  });
});

/**
 * `Esc` (DESIGN.md §4.11, TAS-397): one listener in `Modal`, on `window`, for
 * every dialog of the product. It closes exactly one thing — the innermost —
 * so an inner layer that takes the key with `preventDefault()` keeps the
 * dialog open, and so do IME composition, a focused field holding text-work,
 * and a write in flight.
 */
describe("Modal, Esc", () => {
  function Escapable({ busy = false, onClose }: { busy?: boolean; onClose: () => void }) {
    const [text, setText] = useState("");
    return (
      <Modal busy={busy} onClose={onClose} title="New project">
        <label>
          Description
          <textarea
            data-unsaved-text={text !== "" ? "true" : undefined}
            onChange={(event) => setText(event.target.value)}
            value={text}
          />
        </label>
        <label>
          Key
          <input />
        </label>
        {/* An inner layer, the way Members' results list takes the key. */}
        <ul
          aria-label="Results"
          onKeyDown={(event) => {
            if (event.key === "Escape") event.preventDefault();
          }}
          tabIndex={0}
        />
      </Modal>
    );
  }

  it("closes, as Close does, from anywhere in the dialog", () => {
    const onClose = vi.fn();
    render(<Escapable onClose={onClose} />);

    fireEvent.keyDown(screen.getByLabelText("Key"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves the dialog to an inner layer that took the key", () => {
    const onClose = vi.fn();
    render(<Escapable onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("list", { name: "Results" }), { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does nothing during IME composition", () => {
    const onClose = vi.fn();
    render(<Escapable onClose={onClose} />);

    fireEvent.keyDown(screen.getByLabelText("Key"), { key: "Escape", isComposing: true });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open while focus is in a field holding text-work, and closes from it once the text is gone", () => {
    const onClose = vi.fn();
    render(<Escapable onClose={onClose} />);
    const description = screen.getByLabelText("Description");
    fireEvent.change(description, { target: { value: "Half a thought" } });
    description.focus();

    fireEvent.keyDown(description, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(description).toHaveFocus();
    expect(description).toHaveValue("Half a thought");

    // Elsewhere in the dialog, the text does not hold it.
    screen.getByLabelText("Key").focus();
    fireEvent.keyDown(screen.getByLabelText("Key"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does nothing while a write begun in it is in flight, and Close still closes", () => {
    const onClose = vi.fn();
    render(<Escapable busy onClose={onClose} />);

    fireEvent.keyDown(screen.getByLabelText("Key"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("gives focus back to the control it was opened from, as Close does", () => {
    render(<Opened />);

    const trigger = openFrom();
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
