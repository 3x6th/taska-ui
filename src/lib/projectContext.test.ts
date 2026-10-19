import { describe, expect, it } from "vitest";
import type { ProjectContext, ProjectWorkflow } from "../domain/types";
import { allowedIssueTypes, workflowFor } from "./projectContext";

const workflow = (id: string): ProjectWorkflow => ({ id, name: id, version: 1, statuses: [], transitions: [] });
const context = (workflows: ProjectContext["workflows"]) => ({ workflows }) as ProjectContext;

/**
 * The project context is the one source of the issue types a board offers
 * (TAS-212). Since TAS-173 that set includes a type this build has no name
 * for, after the known ones, so a backend type is offered rather than dropped.
 */
describe("allowedIssueTypes", () => {
  it("puts the known types in the board's order, then unknown ones in the order sent", () => {
    const types = allowedIssueTypes(
      context(Object.fromEntries([["SPIKE", workflow("spike")], ["STORY", workflow("story")], ["EPIC", workflow("epic")], ["TASK", workflow("task")]])),
    );
    expect(types).toEqual(["TASK", "STORY", "SPIKE", "EPIC"]);
  });

  it("answers nothing before the context, and nothing for a project that allows nothing", () => {
    expect(allowedIssueTypes(undefined)).toEqual([]);
    expect(allowedIssueTypes(context({}))).toEqual([]);
  });
});

describe("workflowFor", () => {
  it("finds a workflow by its own key only, never on the prototype", () => {
    const workflows = { EPIC: workflow("epic") };
    expect(workflowFor(workflows, "EPIC")).toEqual(workflow("epic"));
    expect(workflowFor(workflows, "constructor")).toBeUndefined();
    expect(workflowFor(workflows, "toString")).toBeUndefined();
    expect(workflowFor(workflows, null)).toBeUndefined();
    expect(workflowFor(undefined, "EPIC")).toBeUndefined();
  });
});
