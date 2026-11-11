import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { taskaApi } from "../api/client";
import { apiErrorFacts } from "../api/errors";
import type { ProjectTaskQuota } from "../api/tenantMembers";
import {
  ISSUE_COUNT_NOTE,
  ISSUE_COUNT_READ_FAILED,
  countFailureWords,
  keepsHeldCount,
  newIssueCountText,
  projectIssueCountText,
  projectTaskQuotaKey,
  retryCountRead,
} from "../lib/projectTaskQuota";
import { ErrorNote } from "./ErrorNote";

/*
 * The project's issue counter in its two dialogs (TAS-528, DESIGN.md §4.43):
 * New issue's line under Planning and Edit project's «Issues» row under Key.
 * Companies build only — each caller renders these only when the address names
 * a company (api-contract-guard B5), so today's build asks nothing and draws
 * nothing. Read when the dialog opens and not before; nothing waits for it,
 * nothing is switched off by it, and it is not a Tab stop (art-director B7).
 */

type CountView = { state: "loading" } | { state: "value"; quota: ProjectTaskQuota } | { state: "failed"; error: unknown };

/**
 * The one read, shared by both dialogs under one key (B4), and what it lets
 * the dialog show. A value already shown stays through a failed re-read only
 * when that failure says nothing about the request (`keepsHeldCount`); a
 * definite one drops it — react-query keeps `data` beside an error, so the
 * cached value is taken out explicitly, and the failure is drawn instead.
 */
function useProjectIssueCount(companyId: string, projectId: string): CountView {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: projectTaskQuotaKey(projectId),
    queryFn: () => taskaApi.getProjectTaskQuota(companyId, projectId),
    retry: retryCountRead,
  });
  const dropped = query.error !== null && !keepsHeldCount(query.error);
  useEffect(() => {
    if (!dropped) return;
    const cached = queryClient.getQueryCache().find<ProjectTaskQuota>({ queryKey: projectTaskQuotaKey(projectId), exact: true });
    if (cached && cached.state.data !== undefined) cached.setState({ ...cached.state, data: undefined, dataUpdatedAt: 0 });
  }, [dropped, projectId, queryClient]);
  if (!dropped && query.data !== undefined) return { state: "value", quota: query.data };
  if (query.error !== null) return { state: "failed", error: query.error };
  return { state: "loading" };
}

/** The read's failure, in the row's place: not live, no «Try again» — reopening or returning to the tab reads it again (§5.6). */
function CountFailure({ error }: { error: unknown }) {
  return (
    <ErrorNote requestId={apiErrorFacts(error).requestId} serverWords={countFailureWords(error)}>
      {ISSUE_COUNT_READ_FAILED}
    </ErrorNote>
  );
}

/**
 * New issue's line, its own row of the form between Planning and the refusal
 * slot (art-director B1) — never between a refusal and the buttons. Loading,
 * one reserved line of the same height (B4), hidden from assistive tech.
 */
export function NewIssueCount({ companyId, projectId }: { companyId: string; projectId: string }) {
  const view = useProjectIssueCount(companyId, projectId);
  if (view.state === "failed") return <CountFailure error={view.error} />;
  if (view.state === "loading") {
    return (
      <p aria-hidden="true" className="new-issue-count">
        <span className="value-skeleton" />
      </p>
    );
  }
  return <p className="new-issue-count">{newIssueCountText(view.quota)}</p>;
}

/**
 * Edit project's «Issues» row, a second `dl` directly under Key (B2): the
 * count and «Deleted issues still count.» under it. Loading, the two lines
 * reserved at their own heights (B4). A failure takes the whole row's place,
 * the label with it (B5).
 */
export function EditProjectIssueCount({ companyId, projectId }: { companyId: string; projectId: string }) {
  const view = useProjectIssueCount(companyId, projectId);
  if (view.state === "failed") return <CountFailure error={view.error} />;
  return (
    <dl className="form-static-field">
      <dt>Issues</dt>
      {view.state === "loading" ? (
        <dd aria-hidden="true" className="project-issue-count">
          <span className="project-issue-count-value">
            <span className="value-skeleton" />
          </span>
          <span className="field-note">
            <span className="value-skeleton" />
          </span>
        </dd>
      ) : (
        <dd className="project-issue-count">
          <span className="project-issue-count-value">{projectIssueCountText(view.quota)}</span>
          <span className="field-note">{ISSUE_COUNT_NOTE}</span>
        </dd>
      )}
    </dl>
  );
}
