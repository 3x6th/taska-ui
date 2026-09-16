import type {
  AcceptInvitationInput,
  AuthTokens,
  BoardParams,
  ConfirmAttachmentUploadInput,
  ConfirmAvatarUploadInput,
  CreateAttachmentUploadUrlInput,
  CreateAvatarUploadUrlInput,
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
  UpdateProjectInput,
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
  AvatarUploadTicket,
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
  UserAvatar,
  UserStatusChange,
  WatchIssueResult,
  Workflow,
} from "../domain/types";

/**
 * Every method delegates to `live`, and the class compensates for nothing.
 *
 * It used to synthesise the reader's project role and the project's member
 * list out of `GET /projects/{id}` and `GET /users/me`, because the gateway
 * could read neither (TAS-137), with `VITE_TASKA_ASSUME_PROJECT_ADMIN` deciding
 * the role on the stand. That came out in TAS-224, once TAS-137 deployed:
 * measured on 2026-09-16 without a token, `GET /projects/{id}/members` answers
 * 401 where it answered 405 on 2026-09-12, with `GET /users/me` answering 401
 * as the control. The role arrives as `currentUserRole` on `GET /projects/{id}`
 * — `GET /projects/{id}/membership` still answers the static-resource 404 and
 * is not coming — and the `rest` leg derives `getMembership` from it.
 *
 * The class survives only until TAS-209 makes `rest` the default mode and
 * deletes it. Until then `hybrid` is the default and the mode the deployed
 * stand runs, so it stays a pure pass-through: what `live` answers, and what
 * `live` rejects with, is what the caller gets.
 */
export class HybridTaskaApi implements TaskaApi {
  constructor(private readonly live: TaskaApi) {}

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

  updateProject(projectId: string, input: UpdateProjectInput): Promise<Project> {
    return this.live.updateProject(projectId, input);
  }

  getMembership(projectId: string): Promise<ProjectMembership> {
    return this.live.getMembership(projectId);
  }

  listMembers(projectId: string): Promise<ProjectMember[]> {
    return this.live.listMembers(projectId);
  }

  getWorkflow(projectId: string, issueType?: IssueType): Promise<Workflow> {
    return this.live.getWorkflow(projectId, issueType);
  }

  listIssues(projectId: string, params?: ListIssuesParams): Promise<Page<Issue>> {
    return this.live.listIssues(projectId, params);
  }

  getBoard(projectId: string, params: BoardParams): Promise<Board> {
    return this.live.getBoard(projectId, params);
  }

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

  listIssueLinks(projectId: string, issueId: string): Promise<IssueLink[]> {
    return this.live.listIssueLinks(projectId, issueId);
  }

  createIssueLink(projectId: string, issueId: string, input: CreateIssueLinkInput): Promise<IssueLink> {
    return this.live.createIssueLink(projectId, issueId, input);
  }

  deleteIssueLink(projectId: string, issueId: string, linkId: string): Promise<void> {
    return this.live.deleteIssueLink(projectId, issueId, linkId);
  }

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

  createAvatarUploadUrl(input: CreateAvatarUploadUrlInput): Promise<AvatarUploadTicket> {
    return this.live.createAvatarUploadUrl(input);
  }

  putAvatarBytes(uploadUrl: string, body: Blob, contentType: string): Promise<void> {
    return this.live.putAvatarBytes(uploadUrl, body, contentType);
  }

  confirmAvatarUpload(input: ConfirmAvatarUploadInput): Promise<UserAvatar> {
    return this.live.confirmAvatarUpload(input);
  }

  deleteMyAvatar(): Promise<void> {
    return this.live.deleteMyAvatar();
  }

  getUserAvatarUrl(userId: string): Promise<string | null> {
    return this.live.getUserAvatarUrl(userId);
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

  getAdminCatalog(): Promise<AdminCatalog> {
    return this.live.getAdminCatalog();
  }

  listAdminRows(query: AdminRowsQuery): Promise<AdminRows> {
    return this.live.listAdminRows(query);
  }

  getAdminRow(query: AdminRowQuery): Promise<AdminRow> {
    return this.live.getAdminRow(query);
  }

  getProblematicOutboxSummary(): Promise<ProblematicOutboxSummary> {
    return this.live.getProblematicOutboxSummary();
  }

  blockUser(userId: string, reason: string): Promise<UserStatusChange> {
    return this.live.blockUser(userId, reason);
  }

  unblockUser(userId: string, reason: string): Promise<UserStatusChange> {
    return this.live.unblockUser(userId, reason);
  }

  resetCredentialLockout(userId: string, reason: string): Promise<UserStatusChange> {
    return this.live.resetCredentialLockout(userId, reason);
  }

  retryOutboxEvent(
    service: RetryableOutboxService,
    eventId: string,
    reason: string,
  ): Promise<OutboxRetryResult> {
    return this.live.retryOutboxEvent(service, eventId, reason);
  }
}
