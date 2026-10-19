import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

/**
 * TAS-173: there was no error boundary anywhere in `src`, so on React 19 one
 * render that threw unmounted the whole tree. These pin the three things the
 * boundary is for: the fallback replaces only what threw, the stack goes to the
 * console and not to the screen, and the children are tried again when the
 * reader asks or when the data they draw changes.
 */
describe("ErrorBoundary", () => {
  let consoleError: MockInstance;

  beforeEach(() => {
    // React reports a caught render error on the console as well; both are
    // expected here, and silencing them keeps the run readable.
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  function Card({ value }: { value: string }) {
    if (value === "bad") throw new Error(`Cannot draw ${value}`);
    return <p>Drew {value}</p>;
  }

  it("draws the children while they render, and the fallback in their place once they throw", () => {
    render(
      <>
        <ErrorBoundary fallback={(error) => <p role="alert">Fallback: {error.message}</p>}>
          <Card value="bad" />
        </ErrorBoundary>
        <ErrorBoundary fallback={() => <p>Never</p>}>
          <Card value="good" />
        </ErrorBoundary>
      </>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Fallback: Cannot draw bad");
    // The neighbour is untouched: one card that cannot be drawn costs one card.
    expect(screen.getByText("Drew good")).toBeVisible();
    expect(consoleError).toHaveBeenCalledWith(
      "A render failed and was caught by an error boundary.",
      expect.objectContaining({ message: "Cannot draw bad" }),
      expect.any(String),
    );
  });

  it("tries the children again when the reset key changes", () => {
    const fallback = () => <p>Could not be shown</p>;
    const { rerender } = render(
      <ErrorBoundary fallback={fallback} resetKey="bad">
        <Card value="bad" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Could not be shown")).toBeVisible();

    // Same key, same data: the fallback stays.
    rerender(
      <ErrorBoundary fallback={fallback} resetKey="bad">
        <Card value="bad" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Could not be shown")).toBeVisible();

    rerender(
      <ErrorBoundary fallback={fallback} resetKey="fixed">
        <Card value="fixed" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Drew fixed")).toBeVisible();
  });

  it("tries the children again when the fallback asks it to", () => {
    let value = "bad";
    function Flaky() {
      return <Card value={value} />;
    }
    render(
      <ErrorBoundary
        fallback={(_error, reset) => (
          <button onClick={reset} type="button">
            Try again
          </button>
        )}
      >
        <Flaky />
      </ErrorBoundary>,
    );

    value = "recovered";
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Drew recovered")).toBeVisible();
  });

  it("wraps something thrown that is not an Error, so the fallback always has a message", () => {
    function Throws(): never {
      throw "a bare string";
    }
    render(
      <ErrorBoundary fallback={(error) => <p>{error.message}</p>}>
        <Throws />
      </ErrorBoundary>,
    );
    expect(screen.getByText("a bare string")).toBeVisible();
  });
});
