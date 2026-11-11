import { describe, expect, it } from "vitest";
import { DELETED_USER, DELETED_USER_IN_SENTENCE } from "./deletedUser";
import { deletedPerson, personFor, type Person } from "./people";

const SOFIA = "16ad2404-96e3-4c51-b00d-55c5d1451d3c";
const sofia: Person = { id: SOFIA, displayName: "Sofia Romero", color: "#ec4899", avatarUrl: "https://store.example/sofia.png" };

/** A member map that fails the test if it is so much as asked. */
const untouchable = (): ReadonlyMap<string, Person> =>
  new Proxy(new Map<string, Person>([[SOFIA, sofia]]), {
    get(target, key) {
      if (key === "get" || key === "has") throw new Error("the member list was consulted for a deleted account");
      const value = Reflect.get(target, key) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });

/**
 * TAS-529's rule for drawing a person (api-contract-guard §3, B2): deleted only
 * from the server's mark, and then from the mark alone — never from a blank
 * name, never by comparing a string, never with anything borrowed from the
 * member list.
 */
describe("personFor and a deleted account", () => {
  it("answers a marked summary before the member list is consulted", () => {
    const person = personFor(SOFIA, { displayName: null, avatarUrl: null, deleted: true }, untouchable());
    expect(person).toEqual({ id: SOFIA, displayName: DELETED_USER, avatarUrl: null, deleted: true });
  });

  it("keeps nothing a marked summary still carries — no name, no picture", () => {
    const person = personFor(SOFIA, { displayName: "Sofia Romero", avatarUrl: "https://store.example/sofia.png", deleted: true }, new Map());
    expect(person).toEqual(deletedPerson(SOFIA));
  });

  it("answers a member row marked deleted without borrowing its colour or picture, over a name the summary carries", () => {
    const members = new Map<string, Person>([[SOFIA, deletedPerson(SOFIA)]]);
    expect(personFor(SOFIA, { displayName: "Sofia Romero", avatarUrl: "https://store.example/sofia.png" }, members)).toEqual(
      deletedPerson(SOFIA),
    );
    expect(personFor(SOFIA, null, members)?.color).toBeUndefined();
  });

  it("reads only `true` as the mark: a blank name stays unnamed and falls to the member list", () => {
    const members = new Map<string, Person>([[SOFIA, sofia]]);
    expect(personFor(SOFIA, { displayName: "", avatarUrl: null, deleted: false }, members)).toBe(sofia);
    expect(personFor(SOFIA, { displayName: null, avatarUrl: null }, new Map())).toBeUndefined();
  });

  it("draws somebody called «Deleted user» without the mark as the person they are", () => {
    const person = personFor(SOFIA, { displayName: DELETED_USER, avatarUrl: null, deleted: false }, new Map([[SOFIA, sofia]]));
    expect(person).toEqual({ id: SOFIA, displayName: DELETED_USER, color: sofia.color, avatarUrl: sofia.avatarUrl });
    expect(person?.deleted).toBeUndefined();
  });

  it("gives a deleted person no colour to fill a circle with", () => {
    expect(deletedPerson(SOFIA)).not.toHaveProperty("color");
  });

  it("has two words and only two", () => {
    expect(DELETED_USER).toBe("Deleted user");
    expect(DELETED_USER_IN_SENTENCE).toBe("a deleted user");
  });
});
