import { afterEach, describe, expect, it } from "vitest";
import { focusLost } from "./focusTrap";

/**
 * The one "was focus lost" check the board's archive turn, Edit project and
 * Labels share (TAS-397): nowhere, `<body>`, a node gone from the document, or
 * a control switched off under it. Anything else is a reader's place, kept.
 */
describe("focusLost", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is true on <body>, and false on a control that holds focus", () => {
    document.body.innerHTML = "<button type='button'>Save</button>";
    expect(focusLost()).toBe(true);

    document.querySelector("button")!.focus();
    expect(focusLost()).toBe(false);
  });

  it("is true once the focused control is switched off", () => {
    document.body.innerHTML = "<button type='button'>Add label</button>";
    const button = document.querySelector("button")!;
    button.focus();

    button.disabled = true;

    // Whether the engine moves focus off it or leaves it reported there, it is
    // not a place the next Tab can start from.
    expect(focusLost()).toBe(true);
  });
});
