import { TenancyUnavailableError } from "../errors";
import { B2B_TENANCY, type TaskaApi } from "../TaskaApi";
import { WebSessionClient, type LockManagerLike } from "../webSession";
import { MockTaskaApi, MockTaskaStore } from "./MockTaskaApi";
import { MockTenantServer, type MockRouteKind } from "./MockTenantServer";

/*
 * The companies build's mock (TAS-500): the same `WebSessionClient` the REST
 * implementation runs on, talking to `MockTenantServer` instead of the
 * gateway — so the credential a call carries, its renewal, its context epoch
 * and the meaning of every refusal are decided by the one shared layer, and
 * the two implementations cannot drift apart on any of it.
 */

/**
 * What each `TaskaApi` method is in the companies build — a `Record` over
 * every key, so a method added to the interface does not compile until it is
 * placed here.
 *
 * - `session`: answered by the session layer itself;
 * - `withheld`: not offered in this build, refused without a request
 *   (`TENANCY_WITHHELD_OPERATIONS`);
 * - `public`: sent without a credential, as the REST leg sends it (`skipAuth`);
 * - `sync`: not a request at all (the provider's start address);
 * - `account`: the account's own routes — GLOBAL_SELF, the avatar, tokens and
 *   connected apps, `/meta` — which either session may call (api-contract-guard
 *   §2); answered from the account's store;
 * - `tenant-self`: the reader's own notifications and their settings, Telegram
 *   with them (TENANT_SELF, TAS-325) — a company session, not stopped by a
 *   restriction;
 * - `tenant-read` / `tenant-write`: the company's data. The object-store legs
 *   (`putAttachmentBytes`, `getAttachmentBytes`) are reads here: the mock's
 *   bucket is the company's store, and a restriction stops the confirm, not
 *   the bytes.
 */
type MockRoute = "session" | "withheld" | "public" | "sync" | MockRouteKind;

export const MOCK_COMPANY_ROUTES: Readonly<Record<keyof TaskaApi, MockRoute>> = {
  login: "withheld",
  acceptInvitation: "public",
  previewInvitation: "public",
  getAuthMethods: "public",
  requestSignup: "public",
  oauthStartUrl: "sync",
  exchangeOAuthCode: "withheld",
  completeOAuthSignup: "withheld",
  refresh: "withheld",
  logout: "session",
  getCurrentUser: "account",
  updateMyDisplayName: "account",
  getNotificationPreferences: "tenant-self",
  updateNotificationPreferences: "tenant-self",
  createTelegramLink: "tenant-self",
  confirmTelegramLink: "tenant-self",
  disconnectTelegram: "tenant-self",
  listConnectedApps: "account",
  revokeConnectedApp: "account",
  listAccessTokens: "account",
  createAccessToken: "withheld",
  revokeAccessToken: "account",
  hasSession: "session",
  onSessionExpired: "session",
  getTenancy: "session",
  signIn: "session",
  listTenants: "session",
  enterCompany: "session",
  leaveCompany: "session",
  currentWorkspace: "session",
  settleWorkspace: "session",
  onWorkspaceChange: "session",
  onWorkspaceClosed: "session",
  onWorkspacePending: "session",
  onWorkspaceLeft: "session",
  onWorkspaceRestricted: "session",
  lastCompanyHint: "session",
  // TAS-501: the session layer picks their credentials, as for the REST leg —
  // none for the plans, the account's for creating, the company session for
  // the other three (`MockTenantServer`'s "tenant-control" kind).
  listBillingPlans: "session",
  createTenant: "session",
  getTenant: "session",
  getTenantOperation: "session",
  cancelTenantCreation: "session",
  // TAS-502: every one with the tab's company session, picked by the session
  // layer as for the REST leg; `MockTenantServer` checks it the blueprint's way.
  listTenantMembers: "session",
  setTenantMemberRole: "session",
  setTenantMemberState: "session",
  removeTenantMember: "session",
  leaveTenant: "session",
  listTenantInvitations: "session",
  createTenantInvitation: "session",
  resendTenantInvitation: "session",
  revokeTenantInvitation: "session",
  getTenantQuotas: "session",
  reenterCompany: "session",
  // TAS-504: the company's name, owner and pause, with the tab's company
  // session, picked by the session layer as for the REST leg.
  renameTenant: "session",
  pauseTenant: "session",
  resumeTenant: "session",
  transferTenantOwnership: "session",
  getSubscription: "session",
  getMeta: "account",
  listProjects: "tenant-read",
  createProject: "tenant-write",
  getProject: "tenant-read",
  updateProject: "tenant-write",
  archiveProject: "tenant-write",
  getProjectContext: "tenant-read",
  getMembership: "tenant-read",
  listMembers: "tenant-read",
  addProjectMember: "tenant-write",
  changeProjectMemberRole: "tenant-write",
  removeProjectMember: "tenant-write",
  searchUsers: "tenant-read",
  inviteUser: "withheld",
  listIssues: "tenant-read",
  getBoard: "tenant-read",
  getBoardColumnPage: "tenant-read",
  getProjectStats: "tenant-read",
  searchIssues: "tenant-read",
  getIssue: "tenant-read",
  getIssueByKey: "tenant-read",
  createIssue: "tenant-write",
  updateIssue: "tenant-write",
  transitionIssue: "tenant-write",
  deleteIssue: "tenant-write",
  listIssueLinks: "tenant-read",
  createIssueLink: "tenant-write",
  deleteIssueLink: "tenant-write",
  listProjectLabels: "tenant-read",
  createProjectLabel: "tenant-write",
  updateProjectLabel: "tenant-write",
  deleteProjectLabel: "tenant-write",
  listIssueLabels: "tenant-read",
  addIssueLabel: "tenant-write",
  removeIssueLabel: "tenant-write",
  listIssueWatchers: "tenant-read",
  watchIssue: "tenant-write",
  unwatchIssue: "tenant-write",
  addIssueWatcher: "tenant-write",
  removeIssueWatcher: "tenant-write",
  listAttachments: "tenant-read",
  createAttachmentUploadUrl: "tenant-write",
  putAttachmentBytes: "tenant-read",
  confirmAttachmentUpload: "tenant-write",
  getAttachmentDownloadUrl: "tenant-read",
  getAttachmentBytes: "tenant-read",
  deleteAttachment: "tenant-write",
  createAvatarUploadUrl: "account",
  putAvatarBytes: "account",
  confirmAvatarUpload: "account",
  deleteMyAvatar: "account",
  listIssueWorklogs: "tenant-read",
  addIssueWorklog: "tenant-write",
  updateIssueWorklog: "tenant-write",
  deleteIssueWorklog: "tenant-write",
  listProjectWorkflows: "tenant-read",
  createProjectIssueType: "tenant-write",
  updateProjectIssueType: "tenant-write",
  deleteProjectIssueType: "tenant-write",
  reorderProjectIssueTypes: "tenant-write",
  createProjectWorkflow: "tenant-write",
  addWorkflowStatus: "tenant-write",
  addWorkflowTransition: "tenant-write",
  updateProjectWorkflow: "tenant-write",
  deleteProjectWorkflow: "tenant-write",
  updateWorkflowStatus: "tenant-write",
  deleteWorkflowStatus: "tenant-write",
  updateWorkflowTransition: "tenant-write",
  deleteWorkflowTransition: "tenant-write",
  listComments: "tenant-read",
  addComment: "tenant-write",
  updateComment: "tenant-write",
  deleteComment: "tenant-write",
  listNotifications: "tenant-self",
  markNotificationRead: "tenant-self",
  markAllNotificationsRead: "tenant-self",
  getAdminCatalog: "withheld",
  listAdminRows: "withheld",
  getAdminRow: "withheld",
  getProblematicOutboxSummary: "withheld",
  listAuditEntries: "withheld",
  retryOutboxEvent: "withheld",
  blockUser: "withheld",
  unblockUser: "withheld",
  resetCredentialLockout: "withheld",
  updateUserDisplayName: "withheld",
};

export interface CompaniesMockOptions {
  /** The shared storage, where the server and the account session live (default `window.localStorage`). */
  local?: Storage;
  /** The tab's storage (default `window.sessionStorage`). */
  session?: Storage;
  locks?: LockManagerLike;
  ownershipWaitMs?: number;
  events?: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null;
  /** Base latency of the session routes, ms (default 80). */
  latencyMs?: number;
  now?: () => number;
}

type SessionMethods = Pick<
  TaskaApi,
  | "logout"
  | "hasSession"
  | "onSessionExpired"
  | "getTenancy"
  | "signIn"
  | "listTenants"
  | "enterCompany"
  | "leaveCompany"
  | "currentWorkspace"
  | "settleWorkspace"
  | "onWorkspaceChange"
  | "onWorkspaceClosed"
  | "onWorkspacePending"
  | "onWorkspaceLeft"
  | "onWorkspaceRestricted"
  | "lastCompanyHint"
  | "listBillingPlans"
  | "createTenant"
  | "getTenant"
  | "getTenantOperation"
  | "cancelTenantCreation"
  | "listTenantMembers"
  | "setTenantMemberRole"
  | "setTenantMemberState"
  | "removeTenantMember"
  | "leaveTenant"
  | "listTenantInvitations"
  | "createTenantInvitation"
  | "resendTenantInvitation"
  | "revokeTenantInvitation"
  | "getTenantQuotas"
  | "reenterCompany"
  | "renameTenant"
  | "pauseTenant"
  | "resumeTenant"
  | "transferTenantOwnership"
  | "getSubscription"
>;

type AnyMethod = (...args: unknown[]) => unknown;

/**
 * The companies build's `TaskaApi` over the mock. Every call that is a request
 * goes through `WebSessionClient.call` with the credential the REST leg would
 * send; `MockTenantServer.serve` then checks that credential as the blueprint
 * says the gateway will, and runs the method on the store it opens.
 */
export function createCompaniesMockApi(options: CompaniesMockOptions = {}): TaskaApi {
  const local = options.local ?? window.localStorage;
  const accountStore = new MockTaskaStore();
  const server = new MockTenantServer({
    storage: local,
    accountStore,
    latencyMs: options.latencyMs,
    now: options.now,
  });
  const web = new WebSessionClient({
    transport: server.transport(),
    local,
    session: options.session ?? window.sessionStorage,
    locks: options.locks,
    ownershipWaitMs: options.ownershipWaitMs,
    events: options.events === undefined ? window : options.events,
  });
  const apis = new Map<MockTaskaStore, MockTaskaApi>();
  const apiFor = (store: MockTaskaStore) => {
    let api = apis.get(store);
    if (!api) {
      api = new MockTaskaApi(store, { restoreSession: false });
      apis.set(store, api);
    }
    return api;
  };
  const base = apiFor(accountStore);
  const methodOf = (api: MockTaskaApi, name: keyof TaskaApi) => (api[name] as AnyMethod).bind(api);

  const sessionMethods: SessionMethods = {
    logout: () => web.signOut(),
    hasSession: () => web.hasSession(),
    onSessionExpired: (listener) => web.onSessionExpired(listener),
    getTenancy: () => B2B_TENANCY,
    signIn: (input) => web.signIn(input),
    listTenants: (params) => web.listTenants(params),
    enterCompany: (tenantId) => web.enterCompany(tenantId),
    leaveCompany: () => web.leaveCompany(),
    currentWorkspace: () => web.currentWorkspace(),
    settleWorkspace: () => web.settleWorkspace(),
    onWorkspaceChange: (listener) => web.onWorkspaceChange(listener),
    onWorkspaceClosed: (listener) => web.onWorkspaceClosed(listener),
    onWorkspacePending: (listener) => web.onWorkspacePending(listener),
    onWorkspaceLeft: (listener) => web.onWorkspaceLeft(listener),
    onWorkspaceRestricted: (listener) => web.onWorkspaceRestricted(listener),
    lastCompanyHint: () => web.lastCompanyHint(),
    listBillingPlans: (params) => web.listBillingPlans(params),
    createTenant: (input, key) => web.createTenant(input, key),
    getTenant: (tenantId) => web.getTenant(tenantId),
    getTenantOperation: (tenantId, operationId) => web.getTenantOperation(tenantId, operationId),
    cancelTenantCreation: (tenantId, version, key) => web.cancelTenantCreation(tenantId, version, key),
    listTenantMembers: (tenantId, params) => web.listTenantMembers(tenantId, params),
    setTenantMemberRole: (tenantId, userId, role, version, key) => web.setTenantMemberRole(tenantId, userId, role, version, key),
    setTenantMemberState: (tenantId, userId, state, version, key) => web.setTenantMemberState(tenantId, userId, state, version, key),
    removeTenantMember: (tenantId, userId, version, key) => web.removeTenantMember(tenantId, userId, version, key),
    leaveTenant: (tenantId, key) => web.leaveTenant(tenantId, key),
    listTenantInvitations: (tenantId, params) => web.listTenantInvitations(tenantId, params),
    createTenantInvitation: (tenantId, input, key) => web.createTenantInvitation(tenantId, input, key),
    resendTenantInvitation: (tenantId, invitationId, key) => web.resendTenantInvitation(tenantId, invitationId, key),
    revokeTenantInvitation: (tenantId, invitationId, version, key) => web.revokeTenantInvitation(tenantId, invitationId, version, key),
    getTenantQuotas: (tenantId) => web.getTenantQuotas(tenantId),
    reenterCompany: (tenantId) => web.reenterCompany(tenantId),
    renameTenant: (tenantId, name, version, key) => web.renameTenant(tenantId, name, version, key),
    pauseTenant: (tenantId, version, key) => web.pauseTenant(tenantId, version, key),
    resumeTenant: (tenantId, version, key) => web.resumeTenant(tenantId, version, key),
    transferTenantOwnership: (tenantId, newOwnerUserId, version, key) =>
      web.transferTenantOwnership(tenantId, newOwnerUserId, version, key),
    getSubscription: (tenantId) => web.getSubscription(tenantId),
  };

  const api: Record<string, unknown> = {};
  for (const name of Object.keys(MOCK_COMPANY_ROUTES) as (keyof TaskaApi)[]) {
    const route = MOCK_COMPANY_ROUTES[name];
    switch (route) {
      case "session": {
        const method: unknown = sessionMethods[name as keyof SessionMethods];
        if (typeof method !== "function") throw new Error(`${name} is routed to the session layer, which has no such method`);
        api[name] = method;
        break;
      }
      case "withheld":
        api[name] = () => Promise.reject(new TenancyUnavailableError(name));
        break;
      case "sync":
        api[name] = methodOf(base, name);
        break;
      case "public":
        api[name] = (...args: unknown[]) => web.call("none", () => Promise.resolve(methodOf(base, name)(...args)));
        break;
      default:
        api[name] = (...args: unknown[]) =>
          web.call(
            "session",
            (bearer) => server.serve(bearer, route, name, (store) => Promise.resolve(methodOf(apiFor(store), name)(...args))),
            // The company's project content: a refusal is an answer about the
            // company (§4.35), and an answer lifts a pause's mark (TAS-504).
            { read: route === "tenant-read", content: route === "tenant-read" },
          );
    }
  }
  return api as unknown as TaskaApi;
}
