import { describe, expect, it } from "vitest";
import { routerBasename } from "./companyAddress";

describe("the router's basename (TAS-500, release-reviewer N2)", () => {
  it("is the company's prefix under the base in browser routing", () => {
    expect(routerBasename("browser", "", "n1")).toBe("/c/n1");
    expect(routerBasename("browser", "/repo", "n1")).toBe("/repo/c/n1");
    expect(routerBasename("browser", "/repo", null)).toBe("/repo");
  });

  it("never carries the base under hash routing — a hash route never contains it", () => {
    expect(routerBasename("hash", "/repo", "n1")).toBe("/c/n1");
    expect(routerBasename("hash", "/repo", null)).toBe("");
    expect(routerBasename("hash", "", "n 1")).toBe("/c/n%201");
  });
});
