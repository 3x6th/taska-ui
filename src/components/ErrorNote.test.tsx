import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorNote } from "./ErrorNote";

/**
 * TAS-192: the error box every former `.form-error` caller prints through. What
 * is pinned here is what a screen reader is told, which is easy to break by
 * moving a role up one element; the look is the stylesheet's.
 */
describe("ErrorNote", () => {
  it("announces the sentence and never the request id under it", () => {
    render(
      <ErrorNote live="alert" requestId="6f1c2b40-a1e2-4d55">
        The change was not saved.
      </ErrorNote>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The change was not saved.");
    expect(alert).not.toHaveTextContent("6f1c2b40");
    const id = screen.getByRole("button", { name: "Copy request id 6f1c2b40-a1e2-4d55" });
    expect(id.closest("[role='alert']")).toBeNull();
    // The box, not the sentence, is what the stylesheet draws.
    expect(alert.closest(".error-note")).toContainElement(id);
  });

  it("is no live region unless asked to be, and prints no id line without an id", () => {
    const { container } = render(<ErrorNote requestId={null}>Label name already exists</ErrorNote>);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector(".error-note")).toHaveTextContent(/^Label name already exists$/);
    expect(container.querySelector(".error-note-detail")).toBeNull();
  });

  it("puts the id a field is described by on the sentence", () => {
    render(
      <ErrorNote id="date-notice" live="polite">
        Finish typing the start date, or clear it.
      </ErrorNote>,
    );

    expect(screen.getByRole("status")).toHaveAttribute("id", "date-notice");
  });
});
