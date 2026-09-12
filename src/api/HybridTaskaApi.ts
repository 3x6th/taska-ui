import type {
  AcceptInvitationInput,
  AuthTokens,
  BoardParams,
  ConfirmAttachmentUploadInput,
  CreateAttachmentUploadUrlInput,
  CreateIssueInput,
  CreateIssueLinkInput,
  CreateProjectInput,
  CreateProjectLabelInput,
  ListCommentsParams,
  ListIssuesParams,
  ListNotificationsParams,
  LoginInput,
  RetryableOutboxService,
  SearchIssuesParams,
  TaskaApi,
  UpdateIssueInput,
  UpdateProjectLabelInput,
} from "./TaskaApi";
import type {
  AdminCatalog,
  AdminRow,
  AdminRowQuery,
  AdminRows,
  AdminRowsQuery,
  AttachmentDownloadUrl,
  AttachmentUploadTicket,
  Board,
  Issue,
  IssueAttachment,
  IssueComment,
  IssueLink,
  IssueSearchHit,
  IssueType,
  IssueWatchers,
  IssueWithHistory,
  Label,
  Notification,
  OutboxRetryResult,
  Page,
  ProblematicOutboxSummary,
  Project,
  ProjectLabel,
  ProjectMember,
  ProjectMembership,
  UnwatchIssueResult,
  User,
  UserStatusChange,
  WatchIssueResult,
  Workflow,
} from "../domain/types";

/**
 * API groups with gateway contracts are served by the real backend. Project
 * membership and member reads use a temporary single-admin compatibility view,
 * and this class is what the deployed stand runs.
 *
 * **The compensation is still load-bearing** (TAS-219). Backend PR #152
 * (TAS-137) adds `GET /projects/{projectId}/members` and a `currentUserRole`
 * field on `ProjectResponseDto`, and `RestTaskaApi` is written against it — but
 * the PR was open and undeployed when that was written. Probed on 2026-09-12
 * without a token: the member route answers **405**, because only POST is
 * mapped on that path, and `GET /projects/{id}/membership` — the route
 * `getMembership` below stands in for, and the one PR #152 does *not* add —
 * answers the static-resource **404**. The control in the same run,
 * `GET /users/me`, answered 401.
 *
 * What happens the day PR #152 deploys: `getMembership` and `listMembers` below
 * become plain delegations to `live`, and the `assumeProjectAdmin` constructor
 * argument goes with them — along with `VITE_TASKA_ASSUME_PROJECT_ADMIN` and
 * its entry in docs/ai/API-DIVERGENCE.md. Nothing else in this class changes.
 * None of it is removed before then, because until then this is the only thing
 * standing between the stand and a board that knows nobody.
 */
export class HybridTaskaApi implements TaskaApi {
  constructor(
    private readonly live: TaskaApi,
    private readonly assumeProjectAdmin = false,
  ) {}

  login(input: LoginInput): Promise<AuthTokens> {
    return this.live.login(input);
  }

  acceptInvitation(input: AcceptInvitationInput): Promise<void> {
    return this.live.acceptInvitation(input);
  }

  refresh(refreshToken: string): Promise<AuthTokens> {
    return this.live.refresh(refreshToken);
  }

  logout(): Promise<void> {
    return this.live.logout();
  }

  getCurrentUser(): Promise<User> {
    return this.live.getCurrentUser();
  }

  hasSession(): boolean {
    return this.live.hasSession();
  }

  onSessionExpired(listener: () => void): () => void {
    return this.live.onSessionExpired(listener);
  }

  listProjects(): Promise<Project[]> {
    return this.live.listProjects();
  }

  createProject(input: CreateProjectInput): Promise<Project> {
    return this.live.createProject(input);
  }

  getProject(projectId: string): Promise<Project> {
    return this.live.getProject(projectId);
  }

  /**
   * Synthesised, because the route it stands in for does not exist: probed on
   * 2026-09-12 without a token, `GET /projects/{id}/membership` answers the
   * static-resource 404, and PR #152 does not add it. When that PR deploys this
   * method becomes `return this.live.getMembership(projectId)` — the rest leg
   * already derives the answer from `GET /projects/{id}`'s `currentUserRole` —
   * and the `assumeProjectAdmin` argument goes with it.
   */
  async getMembership(projectId: string): Promise<ProjectMembership> {
    // With the assumption on, every field below is already decided: the role is
    // ADMIN by assumption, and the other two are constants. The project read
    // contributed nothing to the answer and was the only thing in it that could
    // fail — so on the deployed stand, where the flag is on, TAS-162's 500 on
    // `GET /projects/{id}` was taking write access away from the board over a
    // result that was then thrown away.
    //
    // This is not a workaround for that 500 and must not grow into one. The
    // board still shows the project-details failure, its name and key are still
    // missing, and `listMembers` below still needs the project for `addedAt`
    // and `addedBy` and still fails honestly when it cannot have it. All this
    // does is stop a read the flag does not use from deciding who may write.
    if (this.assumeProjectAdmin) {
      return { role: "ADMIN", isMember: true, projectExists: true };
    }

    const [project, currentUser] = await Promise.all([
      this.live.getProject(projectId),
      this.live.getCurrentUser(),
    ]);

    return {
      role: project.createdBy === currentUser.id ? "ADMIN" : "VIEWER",
      isMember: true,
      projectExists: true,
    };
  }

  /**
   * One member — the reader — because the gateway has no member read yet: the
   * route answers 405 on the stand (2026-09-12, no token; only POST is mapped
   * on that path), which is not even the 404 signature `isUndeployedRoute`
   * matches. `addedAt` and `addedBy` are invented from the project's own
   * timestamps and exist nowhere else; `ProjectMemberDetailsDto` in PR #152
   * carries neither, which is why both are optional on `ProjectMember`.
   *
   * When PR #152 deploys this method becomes
   * `return this.live.listMembers(projectId)`, the two synthesised fields stop
   * being produced at all, and the three surfaces that draw `member.user` —
   * the assignee filter, the assignee chips and the watcher name map — start
   * naming real people instead of the reader alone.
   */
  async listMembers(projectId: string): Promise<ProjectMember[]> {
    const [project, currentUser] = await Promise.all([
      this.live.getProject(projectId),
      this.live.getCurrentUser(),
    ]);

    return [
      {
        userId: currentUser.id,
        role: this.assumeProjectAdmin || project.createdBy === currentUser.id ? "ADMIN" : "VIEWER",
        addedAt: project.createdAt,
        addedBy: project.createdBy,
        user: {
          displayName: currentUser.displayName,
          email: currentUser.email,
          color: currentUser.color,
        },
      },
    ];
  }

  getWorkflow(projectId: string, issueType?: IssueType): Promise<Workflow> {
    return this.live.getWorkflow(projectId, issueType);
  }

  listIssues(projectId: string, params?: ListIssuesParams): Promise<Page<Issue>> {
    return this.live.listIssues(projectId, params);
  }

  // Delegated whole, like the search below it. The board route is deployed and
  // measured (2026-09-09), it takes a project id and no membership, and there
  // is nothing here for this class to synthesise — the compensation it exists
  // for is project membership only.
  getBoard(projectId: string, params: BoardParams): Promise<Board> {
    return this.live.getBoard(projectId, params);
  }

  // Delegated whole. Search is one gateway route with no membership in it, and
  // this class synthesises membership and nothing else — including the query
  // guard, which belongs to whichever implementation is underneath rather than
  // being applied twice on the way down.
  searchIssues(params: SearchIssuesParams): Promise<Page<IssueSearchHit>> {
    return this.live.searchIssues(params);
  }

  getIssue(projectId: string, issueId: string): Promise<IssueWithHistory> {
    return this.live.getIssue(projectId, issueId);
  }

  getIssueById(issueId: string): Promise<IssueWithHistory> {
    return this.live.getIssueById(issueId);
  }

  createIssue(projectId: string, input: CreateIssueInput): Promise<Issue> {
    return this.live.createIssue(projectId, input);
  }

  updateIssue(projectId: string, issueId: string, input: UpdateIssueInput): Promise<Issue> {
    return this.live.updateIssue(projectId, issueId, input);
  }

  assignIssue(projectId: string, issueId: string, assigneeId: string | null): Promise<Issue> {
    return this.live.assignIssue(projectId, issueId, assigneeId);
  }

  transitionIssue(projectId: string, issueId: string, transitionId: string): Promise<Issue> {
    return this.live.transitionIssue(projectId, issueId, transitionId);
  }

  deleteIssue(projectId: string, issueId: string): Promise<void> {
    return this.live.deleteIssue(projectId, issueId);
  }

  // Straight delegation: the link routes exist in the contract and there is
  // nothing about them for this class to synthesise. Its compensation is about
  // project membership only.
  listIssueLinks(projectId: string, issueId: string): Promise<IssueLink[]> {
    return this.live.listIssueLinks(projectId, issueId);
  }

  createIssueLink(projectId: string, issueId: string, input: CreateIssueLinkInput): Promise<IssueLink> {
    return this.live.createIssueLink(projectId, issueId, input);
  }

  deleteIssueLink(projectId: string, issueId: string, linkId: string): Promise<void> {
    return this.live.deleteIssueLink(projectId, issueId, linkId);
  }

  // Delegated whole, like the link routes above: labels are in the contract
  // with their own role rules, and there is nothing here for this class to
  // synthesise. Its compensation is about project membership only — which does
  // reach these indirectly, since `getMembership` decides whether the panel
  // offers the writes at all, and the server refuses them regardless.
  listProjectLabels(projectId: string): Promise<ProjectLabel[]> {
    return this.live.listProjectLabels(projectId);
  }

  createProjectLabel(projectId: string, input: CreateProjectLabelInput): Promise<ProjectLabel> {
    return this.live.createProjectLabel(projectId, input);
  }

  updateProjectLabel(projectId: string, labelId: string, input: UpdateProjectLabelInput): Promise<ProjectLabel> {
    return this.live.updateProjectLabel(projectId, labelId, input);
  }

  deleteProjectLabel(projectId: string, labelId: string): Promise<void> {
    return this.live.deleteProjectLabel(projectId, labelId);
  }

  listIssueLabels(projectId: string, issueId: string): Promise<Label[]> {
    return this.live.listIssueLabels(projectId, issueId);
  }

  addIssueLabel(projectId: string, issueId: string, labelId: string): Promise<void> {
    return this.live.addIssueLabel(projectId, issueId, labelId);
  }

  removeIssueLabel(projectId: string, issueId: string, labelId: string): Promise<void> {
    return this.live.removeIssueLabel(projectId, issueId, labelId);
  }

  /**
   * All five delegated whole. Nothing here is synthesisable: a subscription is
   * server state, and the five routes are **measured** on the deployed gateway
   * rather than inferred from the backend PR that added them — which is the
   * standard this file is held to, since its whole job is saying what is real
   * and what is stood in for. Probed on 2026-09-09 with an invalid uuid and no
   * credentials: `GET …/watchers`, both `…/watchers/me` verbs and
   * `DELETE …/watchers/{userId}` answer `400 INVALID_ARGUMENT` (the path
   * matched and the argument was rejected), `POST …/watchers` answers
   * `415 UNSUPPORTED_MEDIA_TYPE` (matched, and reached body parsing), and a
   * `…/watchers-nope` control answers the static-resource `404` an unmapped
   * path gets here. So there is no gap for this class to stand in.
   *
   * The compensation it *does* carry reaches this family sideways and it is
   * worth naming, because it is the thing a reader will wonder about. A watcher
   * row names a person by `userId` alone, and the panel resolves that through
   * `listMembers` above — which here answers with the current user and nobody
   * else. So against the deployed stand a watcher who is not the reader draws
   * as "Unknown", exactly as the reporter line and an attachment's byline
   * already do. That is the member-read gap (TAS-137) showing through one more
   * surface, not a second defect, and it is the reason this class must not
   * invent a name: a synthesised display name would make one screen look
   * healthy while the three beside it stayed honest.
   *
   * `isProjectAdmin` is `true` for everyone when `VITE_TASKA_ASSUME_PROJECT_ADMIN`
   * is on, so the panel offers the two ADMIN controls to every caller on the
   * stand and the gateway refuses them for anybody who is not one. That is the
   * documented shape of this flag (docs/ai/API-DIVERGENCE.md), not a new risk.
   */
  listIssueWatchers(projectId: string, issueId: string): Promise<IssueWatchers> {
    return this.live.listIssueWatchers(projectId, issueId);
  }

  watchIssue(projectId: string, issueId: string): Promise<WatchIssueResult> {
    return this.live.watchIssue(projectId, issueId);
  }

  unwatchIssue(projectId: string, issueId: string): Promise<UnwatchIssueResult> {
    return this.live.unwatchIssue(projectId, issueId);
  }

  addIssueWatcher(projectId: string, issueId: string, userId: string): Promise<WatchIssueResult> {
    return this.live.addIssueWatcher(projectId, issueId, userId);
  }

  removeIssueWatcher(projectId: string, issueId: string, userId: string): Promise<UnwatchIssueResult> {
    return this.live.removeIssueWatcher(projectId, issueId, userId);
  }

  /**
   * All six delegated whole, including the direct-to-store PUT — and for this
   * family "no compensation" is a stronger statement than it is for links or
   * labels, so it is worth saying why rather than reusing the sentence above.
   *
   * This class synthesises project membership out of `GET /projects/{id}` and
   * `GET /users/me`, and that is the only thing it can synthesise: it holds no
   * store, no seeded data and no bucket. The five gateway routes are ordinary
   * routes with their own role rules — if the gateway has not deployed them the
   * caller sees that, which is the honest answer
   * (docs/ai/API-DIVERGENCE.md).
   *
   * The middle leg is where compensation stops being merely absent and becomes
   * impossible. `putAttachmentBytes` puts bytes on a **different server**: a
   * presigned S3 host that this class has no credentials for, no route to and
   * no substitute for. There is nothing to fall back to and nothing to fake —
   * a synthesised success would be this class reporting that a file is in a
   * bucket it never wrote to, and the next call, `confirmAttachmentUpload`,
   * would then be told by the *real* server that no such object exists. So the
   * failure travels up exactly as it arrived and the panel says what actually
   * happened.
   *
   * Which matters more here than anywhere else in this class, because this is
   * the one leg that may be blocked by something no code on this side can fix:
   * nothing in the backend repository configures CORS on the bucket
   * (`minio-init` runs `mc alias set` and `mc mb`, and there is no
   * `MINIO_API_CORS_ALLOW_ORIGIN` anywhere), and a PUT is never a simple
   * request, so a browser will always preflight it.
   */
  listAttachments(projectId: string, issueId: string): Promise<IssueAttachment[]> {
    return this.live.listAttachments(projectId, issueId);
  }

  createAttachmentUploadUrl(
    projectId: string,
    issueId: string,
    input: CreateAttachmentUploadUrlInput,
  ): Promise<AttachmentUploadTicket> {
    return this.live.createAttachmentUploadUrl(projectId, issueId, input);
  }

  putAttachmentBytes(uploadUrl: string, body: Blob, contentType: string): Promise<void> {
    return this.live.putAttachmentBytes(uploadUrl, body, contentType);
  }

  confirmAttachmentUpload(
    projectId: string,
    issueId: string,
    input: ConfirmAttachmentUploadInput,
  ): Promise<IssueAttachment> {
    return this.live.confirmAttachmentUpload(projectId, issueId, input);
  }

  getAttachmentDownloadUrl(
    projectId: string,
    issueId: string,
    attachmentId: string,
  ): Promise<AttachmentDownloadUrl> {
    return this.live.getAttachmentDownloadUrl(projectId, issueId, attachmentId);
  }

  deleteAttachment(projectId: string, issueId: string, attachmentId: string): Promise<void> {
    return this.live.deleteAttachment(projectId, issueId, attachmentId);
  }

  listComments(projectId: string, issueId: string, params?: ListCommentsParams): Promise<Page<IssueComment>> {
    return this.live.listComments(projectId, issueId, params);
  }

  addComment(projectId: string, issueId: string, body: string): Promise<IssueComment> {
    return this.live.addComment(projectId, issueId, body);
  }

  updateComment(projectId: string, issueId: string, commentId: string, body: string): Promise<IssueComment> {
    return this.live.updateComment(projectId, issueId, commentId, body);
  }

  deleteComment(projectId: string, issueId: string, commentId: string): Promise<void> {
    return this.live.deleteComment(projectId, issueId, commentId);
  }

  listNotifications(params?: ListNotificationsParams): Promise<Page<Notification>> {
    return this.live.listNotifications(params);
  }

  markNotificationRead(notificationId: string): Promise<Notification> {
    return this.live.markNotificationRead(notificationId);
  }

  markAllNotificationsRead(): Promise<{ updatedCount: number }> {
    return this.live.markAllNotificationsRead();
  }

  // Nothing to synthesise: the admin endpoints exist in the contract, and the
  // compensation this class carries is about project membership, not about
  // these. If the gateway has not deployed them yet the caller sees that,
  // which is the honest answer (docs/ai/API-DIVERGENCE.md).
  getAdminCatalog(): Promise<AdminCatalog> {
    return this.live.getAdminCatalog();
  }

  listAdminRows(query: AdminRowsQuery): Promise<AdminRows> {
    return this.live.listAdminRows(query);
  }

  getAdminRow(query: AdminRowQuery): Promise<AdminRow> {
    return this.live.getAdminRow(query);
  }

  /**
   * Straight to the gateway, and deliberately with no mock fallback. The route
   * is deployed — backend PR #141 (TAS-105) merged 2026-08-27 and it answers
   * 200 with `{counts, events, notAllShown}` (measured 2026-09-08) — so this is
   * the ordinary case rather than a position taken about an absent route, and
   * the compensation that used to hang off it came out with TAS-194. The reason
   * below is not that compensation and outlives it.
   *
   * Two reasons. This class holds no mock store to answer from — the
   * compensation it carries is a *view* over live data, not seeded data — and a
   * synthesised summary would sit on the same screen as an Outbox journal of
   * real rows, where the two would contradict each other with no way for the
   * reader to tell which half was invented. The Problems view instead reads the
   * gateway's own answer, whatever it is.
   */
  getProblematicOutboxSummary(): Promise<ProblematicOutboxSummary> {
    return this.live.getProblematicOutboxSummary();
  }

  /**
   * Straight to the gateway, all three of them, and deliberately with no
   * fallback of any kind. All three are deployed since backend PR #146
   * (measured 2026-09-08), so this is now the ordinary case rather than a
   * position taken about an absent route — but the reason for it has not
   * changed and outlives the deployment.
   *
   * They are *writes*. A compensation for a read can be a view over live data;
   * a compensation for a write would be this class reporting a change that
   * never happened, to a table it cannot alter, which is worse than the failure
   * it would be hiding. So the section sees the gateway's own answer, whatever
   * it is.
   *
   * `resetCredentialLockout` is the clearest case of the three: what it changes
   * — a credential's failed-attempt counter — is not in any response this class
   * can read, so there is not even a table to pretend against.
   */
  blockUser(userId: string, reason: string): Promise<UserStatusChange> {
    return this.live.blockUser(userId, reason);
  }

  unblockUser(userId: string, reason: string): Promise<UserStatusChange> {
    return this.live.unblockUser(userId, reason);
  }

  resetCredentialLockout(userId: string, reason: string): Promise<UserStatusChange> {
    return this.live.resetCredentialLockout(userId, reason);
  }

  /**
   * The Events section's retry, on the same terms as the three writes above and
   * for the same reason: it is a write, and a compensation for a write would be
   * this class reporting that a stuck event had been requeued when nothing had
   * touched the queue. Worse here than there, because the operator's next act is
   * to stop looking.
   *
   * It is also the one write in this product whose *failure* is ambiguous on the
   * server — the audit row is written after the update commits — so a class that
   * invented an answer would be inventing the one answer nobody can check.
   */
  retryOutboxEvent(
    service: RetryableOutboxService,
    eventId: string,
    reason: string,
  ): Promise<OutboxRetryResult> {
    return this.live.retryOutboxEvent(service, eventId, reason);
  }
}
