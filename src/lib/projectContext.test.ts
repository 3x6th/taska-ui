import { describe, expect, it } from "vitest";
import type { ProjectContext, ProjectWorkflow } from "../domain/types";
import { allowedIssueTypes, workflowFor } from "./projectContext";

const workflow = (id: string): ProjectWorkflow => ({ id, name: id, version: 1, statuses: [], transitions: [] });
const context = (issueTypes: string[], workflows: ProjectContext["workflows"] = {}) =>
  ({
    issueTypes: issueTypes.map((code, index) => ({ code, name: code, color: null, icon: null, sortOrder: index })),
    workflows,
  }) as ProjectContext;

/**
 * The project's registry is the one source of the issue types a board offers
 * (TAS-417): its keys in the order the server sent them, never re-sorted and
 * not narrowed to the types the context sent a workflow for.
 */
describe("allowedIssueTypes", () => {
  it("keeps the registry's own order, whatever the codes are", () => {
    expect(allowedIssueTypes(context(["STORY", "SPIKE", "TASK", "EPIC"]))).toEqual(["STORY", "SPIKE", "TASK", "EPIC"]);
  });

  it("offers a registry type the workflows do not name, and no workflow type the registry lacks", () => {
    const types = allowedIssueTypes(context(["TASK", "EPIC"], { TASK: workflow("task"), BUG: workflow("bug") }));
    expect(types).toEqual(["TASK", "EPIC"]);
  });

  it("answers nothing before the context, and nothing for an empty registry", () => {
    expect(allowedIssueTypes(undefined)).toEqual([]);
    expect(allowedIssueTypes(context([]))).toEqual([]);
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
