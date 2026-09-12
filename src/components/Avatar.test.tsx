import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { avatarColor } from "../lib/format";
import { Avatar } from "./Avatar";

const anna = {
  id: "3f1f5a2e-0000-4000-8000-000000000001",
  displayName: "Anna Ivanova",
};

/**
 * The circle is drawn three ways and the whole of TAS-220's front half is which
 * one wins: a picture when there is a usable link, initials when there is not,
 * and initials again when a link that looked usable did not load.
 *
 * The third is not an edge case. A download URL is presigned for fifteen
 * minutes, so a board left open over lunch is holding expired links — an
 * ordinary state, and one that must not leave holes where people's faces were.
 */
describe("Avatar", () => {
  it("draws initials on the computed fill when there is no picture", () => {
    render(<Avatar user={anna} />);

    const circle = screen.getByLabelText("Anna Ivanova");
    expect(circle.textContent).toBe("AI");
    expect(circle.querySelector("img")).toBeNull();
    // The fill is seeded by id, never by the name: a rename must not move
    // somebody's colour.
    expect(circle).toHaveStyle({ backgroundColor: avatarColor(anna.id) });
  });

  it("draws the picture over the fill, and keeps the name on the circle rather than on the image", () => {
    render(<Avatar user={{ ...anna, avatarUrl: "https://store.example/face.png?sig=1" }} />);

    const circle = screen.getByLabelText("Anna Ivanova");
    const image = circle.querySelector("img");
    expect(image).toHaveAttribute("src", "https://store.example/face.png?sig=1");
    // Decorative in the accessibility tree: the wrapper already carries the
    // full name as `aria-label` and `title` (§4.4), and a second copy would
    // make every avatar announce its owner twice.
    expect(image).toHaveAttribute("alt", "");
    expect(circle).toHaveAttribute("title", "Anna Ivanova");
    // The fill stays underneath, which is what a slow load shows and what a
    // picture with transparency sits on.
    expect(circle).toHaveStyle({ backgroundColor: avatarColor(anna.id) });
    // No initials under the picture: letters that appear and are covered a
    // moment later are a flicker, and they would show through a transparent PNG.
    expect(circle.textContent).toBe("");
  });

  it("falls back to initials when the picture does not load, rather than leaving a hole", () => {
    render(<Avatar user={{ ...anna, avatarUrl: "https://store.example/expired.png?sig=1" }} />);

    const circle = screen.getByLabelText("Anna Ivanova");
    fireEvent.error(circle.querySelector("img")!);

    expect(circle.querySelector("img")).toBeNull();
    expect(circle.textContent).toBe("AI");
  });

  it("tries a fresh link for somebody whose last one failed", () => {
    // The natural implementation of the fallback is a boolean, and a boolean
    // remembers "this person's picture is broken" — so the replacement they
    // just uploaded would never be drawn. Keyed by the link instead.
    const { rerender } = render(<Avatar user={{ ...anna, avatarUrl: "https://store.example/expired.png?sig=1" }} />);
    fireEvent.error(screen.getByLabelText("Anna Ivanova").querySelector("img")!);
    expect(screen.getByLabelText("Anna Ivanova").querySelector("img")).toBeNull();

    rerender(<Avatar user={{ ...anna, avatarUrl: "https://store.example/fresh.png?sig=2" }} />);

    expect(screen.getByLabelText("Anna Ivanova").querySelector("img")).toHaveAttribute(
      "src",
      "https://store.example/fresh.png?sig=2",
    );
  });

  it("draws no picture while the circle is a skeleton", () => {
    // A skeleton that has already been painted somebody's photograph is
    // claiming to know whose circle it is.
    render(<Avatar loading user={{ ...anna, avatarUrl: "https://store.example/face.png?sig=1" }} />);

    const circle = screen.getByLabelText("Loading user");
    expect(circle.querySelector("img")).toBeNull();
    expect(circle).toHaveAttribute("aria-busy", "true");
  });

  it("keeps the unassigned circle empty, picture or no picture", () => {
    render(<Avatar />);

    const circle = screen.getByLabelText("Unassigned");
    expect(circle).toHaveClass("avatar-empty");
    expect(circle.querySelector("img")).toBeNull();
    expect(circle.textContent).toBe("");
  });
});
