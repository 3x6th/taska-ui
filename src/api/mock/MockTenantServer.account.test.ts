import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../test/memoryStorage";
import { WorkspaceClosedError, apiErrorFacts, refusalCode, refusalViolations } from "../errors";
import type { TaskaApi } from "../TaskaApi";
import { createLocalLockManager } from "../webSession";
import { MOCK_ACCOUNT_IDS } from "./MockTaskaApi";
import {
  MOCK_ACCOUNTS_KEY,
  MOCK_MAILBOX_KEY,
  MOCK_SERVER_KEY,
  MOCK_TENANT_HOOKS_KEY,
  MOCK_TENANT_IDS,
  type MockMailboxEntry,
} from "./MockTenantServer";
import { MOCK_COMPANY_ROUTES, createCompaniesMockApi } from "./mockCompanies";

/*
 * The companies mock's account credentials (TAS-527, api-contract-guard §8):
 * the five routes, their own two keys beside `taska.mockServer` (F6), the
 * enumeration-safe recovery, single-use links and codes, and the address
 * confirmed in one tab read in every other.
 */

const PASSWORD = "a long new password";

function browser() {
  const local = new MemoryStorage();
  const locks = createLocalLockManager();
  const open = () => createCompaniesMockApi({ local, session: new MemoryStorage(), locks, events: null, latencyMs: 0, ownershipWaitMs: 25 });
  return { local, open };
}

const mailbox = (local: MemoryStorage): MockMailboxEntry[] => JSON.parse(local.getItem(MOCK_MAILBOX_KEY) ?? "[]") as MockMailboxEntry[];
const tokenOf = (entry: MockMailboxEntry | undefined) => new URL(entry?.link ?? "http://x/").searchParams.get("token") ?? "";
const hooks = (local: MemoryStorage, value: Record<string, unknown>) => local.setItem(MOCK_TENANT_HOOKS_KEY, JSON.stringify(value));

const caught = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (error: unknown) => error,
  );

const violated = (error: unknown) => refusalViolations(error).map((violation) => violation.field);

async function signedIn(api: TaskaApi, email = "anna@example.com", password = "mock-accepts-anything") {
  return api.signIn({ email, password });
}

describe("the five routes are routed and keep their own keys (F6)", () => {
  it("each is the session layer's, and the server's record stays at v5", async () => {
    for (const name of [
      "requestPasswordRecovery",
      "completePasswordRecovery",
      "changeAccountPassword",
      "requestAccountEmailChange",
      "confirmAccountEmailChange",
      "onAccountChanged",
    ] as const) {
      expect(MOCK_COMPANY_ROUTES[name], name).toBe("session");
    }
    expect(MOCK_SERVER_KEY).toBe("taska.mockServer.v5");
    expect(MOCK_ACCOUNTS_KEY).toBe("taska.mockAccounts.v1");
    expect(MOCK_MAILBOX_KEY).toBe("taska.mockMailbox.v1");
  });
});

describe("password recovery (requestPasswordRecovery, completePasswordRecovery)", () => {
  it("the same 202 for an existing, an unknown, a locked and an invited address — mail only for the existing ACTIVE one (B4)", async () => {
    const { local, open } = browser();
    const api = open();
    const answers = [];
    for (const email of ["anna@example.com", "nobody@example.com", "omar@example.com", "leo@example.com"]) {
      answers.push(await api.requestPasswordRecovery(email, crypto.randomUUID()));
    }
    expect(answers).toEqual(Array(4).fill({ retryAfterSeconds: 60 }));
    const box = mailbox(local);
    expect(box.map((entry) => [entry.to, entry.kind])).toEqual([["anna@example.com", "PASSWORD_RECOVERY"]]);
    // The A99 shape at the page's origin and base; 32 bytes of base64url.
    expect(box[0].link).toMatch(/^http:\/\/localhost(:\d+)?\/reset-password\?token=[A-Za-z0-9_-]{43}$/);
    // Nothing of the token in the server's own record — only its digest.
    expect(local.getItem(MOCK_ACCOUNTS_KEY)).not.toContain(tokenOf(box[0]));
  });

  it("a key replays its 202 without a second mail; another body under it is 409; a bad address is a violation on email", async () => {
    const { local, open } = browser();
    const api = open();
    await api.requestPasswordRecovery("anna@example.com", "key-1");
    await api.requestPasswordRecovery("anna@example.com", "key-1");
    expect(mailbox(local)).toHaveLength(1);
    expect(refusalCode(await caught(api.requestPasswordRecovery("sofia@example.com", "key-1")))).toBe("IDEMPOTENCY_CONFLICT");
    const bad = await caught(api.requestPasswordRecovery("not an address", "key-2"));
    expect(apiErrorFacts(bad).status).toBe(400);
    expect(violated(bad)).toEqual(["email"]);
  });

  it("the link sets the password once: sign-in then takes only it, the link is spent, and every session of the account is revoked", async () => {
    const { local, open } = browser();
    const signedInTab = open();
    await signedIn(signedInTab);
    await signedInTab.enterCompany(MOCK_TENANT_IDS.northwind);
    const api = open();
    await api.requestPasswordRecovery("anna@example.com", "key-1");
    const token = tokenOf(mailbox(local)[0]);

    // A weak password is refused before the link is looked at, and does not spend it.
    const weak = await caught(api.completePasswordRecovery(token, "short", "key-2"));
    expect(violated(weak)).toEqual(["newPassword"]);
    await api.completePasswordRecovery(token, PASSWORD, "key-3");
    // The same key and body again is the same 204; the link with a new key is dead.
    await api.completePasswordRecovery(token, PASSWORD, "key-3");
    const reused = await caught(api.completePasswordRecovery(token, PASSWORD, "key-4"));
    expect(apiErrorFacts(reused)).toMatchObject({ status: 401, code: "AUTHENTICATION_REQUIRED" });

    // Every session of the account is gone: the tab that held one finds it dead.
    const projects = await caught(signedInTab.listProjects());
    expect(projects).toBeInstanceOf(WorkspaceClosedError);
    expect(signedInTab.hasSession()).toBe(false);

    const fresh = open();
    await expect(signedIn(fresh, "anna@example.com", "anything at all")).rejects.toMatchObject({ status: 401 });
    await expect(signedIn(fresh, "anna@example.com", PASSWORD)).resolves.toMatchObject({ status: "SIGNED_IN" });
    expect(local.getItem(MOCK_ACCOUNTS_KEY)).not.toContain(PASSWORD);
  });

  it("an expired link, a malformed one and one nobody holds: 401, 400 on token, 401", async () => {
    const { local, open } = browser();
    const api = open();
    await api.requestPasswordRecovery("anna@example.com", "key-1");
    const token = tokenOf(mailbox(local)[0]);
    expect(violated(await caught(api.completePasswordRecovery("too-short", PASSWORD, "key-2")))).toEqual(["token"]);
    expect(apiErrorFacts(await caught(api.completePasswordRecovery("x".repeat(43), PASSWORD, "key-3"))).status).toBe(401);
    hooks(local, { clockOffsetMs: 16 * 60_000 });
    expect(apiErrorFacts(await caught(api.completePasswordRecovery(token, PASSWORD, "key-4"))).status).toBe(401);
  });

  it("a lost answer: applied, then a dropped connection; the same key and body replays the 204", async () => {
    const { local, open } = browser();
    const api = open();
    await api.requestPasswordRecovery("anna@example.com", "key-1");
    const token = tokenOf(mailbox(local)[0]);
    hooks(local, { loseAnswer: ["completePasswordRecovery"] });
    const lost = await caught(api.completePasswordRecovery(token, PASSWORD, "key-2"));
    expect(apiErrorFacts(lost).status).toBeNull();
    await expect(api.completePasswordRecovery(token, PASSWORD, "key-2")).resolves.toBeUndefined();
  });
});

describe("the password change (changeAccountPassword)", () => {
  it("bounds as violations; once set, a wrong current password is a violation on currentPassword (never a 401)", async () => {
    const { open } = browser();
    const api = open();
    await signedIn(api);
    const both = await caught(api.changeAccountPassword("x".repeat(129), "short", "key-1"));
    expect(violated(both)).toEqual(["currentPassword", "newPassword"]);
    // No password set yet: any current one is taken, as sign-in takes any.
    await api.changeAccountPassword("whatever it was", PASSWORD, "key-2");
    const wrong = await caught(api.changeAccountPassword("not it", "another long password", "key-3"));
    expect(apiErrorFacts(wrong).status).toBe(400);
    expect(refusalViolations(wrong)).toEqual([{ field: "currentPassword", code: "MISMATCH", message: "The current password is not correct." }]);
    expect(api.hasSession()).toBe(true);
    await api.changeAccountPassword(PASSWORD, "another long password", "key-4");
  });

  it("keeps the family that sent it — this browser's tabs — and revokes another browser's", async () => {
    const here = browser();
    const tab = here.open();
    const sibling = here.open();
    // Another browser on the same server: the mock's server lives in `local`, so it shares that.
    const other = here.open();
    await signedIn(tab);
    await tab.enterCompany(MOCK_TENANT_IDS.northwind);
    await sibling.enterCompany(MOCK_TENANT_IDS.globex);
    // A second sign-in is a second family — the other browser's — whose record replaces ours in this shared storage;
    // keep ours aside and put it back, so the two families both stay alive in the server.
    const ours = here.local.getItem("taska.webSession");
    await signedIn(other);
    const theirs = here.local.getItem("taska.webSession");
    here.local.setItem("taska.webSession", ours ?? "");

    await tab.changeAccountPassword("anything", PASSWORD, "key-1");
    await expect(tab.listProjects()).resolves.toBeDefined();
    await expect(sibling.listProjects()).resolves.toBeDefined();
    here.local.setItem("taska.webSession", theirs ?? "");
    await expect(caught(other.listTenants())).resolves.toBeInstanceOf(WorkspaceClosedError);
  });
});

describe("the email change (requestAccountEmailChange, confirmAccountEmailChange)", () => {
  it("201 with the challenge and the code mailed to the new address; the account's own and a taken address are 409", async () => {
    const { local, open } = browser();
    const api = open();
    await signedIn(api);
    const challenge = await api.requestAccountEmailChange("anna.new@example.com", "p", "key-1");
    expect(challenge).toMatchObject({ delivery: "EMAIL", maskedDestination: "a•••@example.com" });
    expect(Date.parse(challenge.expiresAt ?? "")).toBeGreaterThan(Date.now());
    const [mail] = mailbox(local);
    expect(mail).toMatchObject({ to: "anna.new@example.com", kind: "EMAIL_CHANGE_CODE", challengeId: challenge.challengeId });
    expect(mail.code).toMatch(/^[0-9]{8}$/);
    expect(local.getItem(MOCK_ACCOUNTS_KEY)).not.toContain(mail.code);
    for (const taken of ["sofia@example.com", "ANNA@example.com"]) {
      const error = await caught(api.requestAccountEmailChange(taken, "p", crypto.randomUUID()));
      expect(apiErrorFacts(error)).toMatchObject({ status: 409, code: "INVALID_STATE" });
    }
    expect(violated(await caught(api.requestAccountEmailChange("nope", "p", "key-2")))).toEqual(["newEmail"]);
    // The same key and body replay the same challenge; another body under it is 409.
    await expect(api.requestAccountEmailChange("anna.new@example.com", "p", "key-1")).resolves.toEqual(challenge);
    expect(refusalCode(await caught(api.requestAccountEmailChange("anna.other@example.com", "p", "key-1")))).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("confirmed, the new address is in every tab and every row, signs in, and the old one signs in to nothing", async () => {
    const { local, open } = browser();
    const api = open();
    await signedIn(api);
    await api.enterCompany(MOCK_TENANT_IDS.northwind);
    const other = open();
    await other.enterCompany(MOCK_TENANT_IDS.globex);
    expect((await other.getCurrentUser()).email).toBe("anna@example.com");

    const challenge = await api.requestAccountEmailChange("anna.new@example.com", "p", "key-1");
    await api.confirmAccountEmailChange(challenge.challengeId, mailbox(local)[0].code ?? "", "key-2");
    expect((await api.getCurrentUser()).email).toBe("anna.new@example.com");
    // Another tab — another page with its own stores — reads the shared record on its next operation.
    expect((await other.getCurrentUser()).email).toBe("anna.new@example.com");
    const members = await api.listTenantMembers(MOCK_TENANT_IDS.northwind);
    expect(members.items.find((member) => member.userId === MOCK_ACCOUNT_IDS.anna)?.email).toBe("anna.new@example.com");
    expect((await api.getNotificationPreferences()).email).toBe("anna.new@example.com");
    // Revokes nothing: both tabs still work.
    await expect(other.listProjects()).resolves.toBeDefined();

    const fresh = open();
    await expect(signedIn(fresh, "anna@example.com")).rejects.toMatchObject({ status: 401 });
    await expect(signedIn(fresh, "anna.new@example.com")).resolves.toMatchObject({ status: "SIGNED_IN" });
    // The old address is nobody's now: a recovery for it mails nobody.
    await fresh.requestPasswordRecovery("anna@example.com", "key-3");
    expect(mailbox(local).filter((entry) => entry.kind === "PASSWORD_RECOVERY")).toEqual([]);
  });

  it("a wrong code is a violation on code; the fifth is 422; an expired one 422; an unknown or superseded challenge 404", async () => {
    const { local, open } = browser();
    const api = open();
    await signedIn(api);
    const first = await api.requestAccountEmailChange("anna.new@example.com", "p", "key-1");
    const code = mailbox(local)[0].code ?? "";
    const wrong = code === "00000000" ? "11111111" : "00000000";
    expect(violated(await caught(api.confirmAccountEmailChange(first.challengeId, "1234", "k")))).toEqual(["code"]);
    for (let attempt = 1; attempt < 5; attempt += 1) {
      const error = await caught(api.confirmAccountEmailChange(first.challengeId, wrong, crypto.randomUUID()));
      expect(refusalViolations(error)).toEqual([{ field: "code", code: "MISMATCH", message: "The code is not correct." }]);
    }
    const fifth = await caught(api.confirmAccountEmailChange(first.challengeId, wrong, crypto.randomUUID()));
    expect(apiErrorFacts(fifth)).toMatchObject({ status: 422, code: "CONFIRMATION_EXPIRED" });
    // Exhausted: even the right code is refused now.
    expect(refusalCode(await caught(api.confirmAccountEmailChange(first.challengeId, code, crypto.randomUUID())))).toBe("CONFIRMATION_EXPIRED");

    const second = await api.requestAccountEmailChange("anna.new@example.com", "p", "key-2");
    const third = await api.requestAccountEmailChange("anna.new@example.com", "p", "key-3");
    // Start over supersedes: the second's code no longer counts.
    const superseded = await caught(api.confirmAccountEmailChange(second.challengeId, mailbox(local)[1].code ?? "", "k2"));
    expect(apiErrorFacts(superseded)).toMatchObject({ status: 404, code: "RESOURCE_NOT_FOUND" });
    expect(refusalCode(await caught(api.confirmAccountEmailChange(crypto.randomUUID(), code, "k3")))).toBe("RESOURCE_NOT_FOUND");
    hooks(local, { clockOffsetMs: 11 * 60_000 });
    const expired = await caught(api.confirmAccountEmailChange(third.challengeId, mailbox(local)[2].code ?? "", "k4"));
    expect(apiErrorFacts(expired)).toMatchObject({ status: 422, code: "CONFIRMATION_EXPIRED" });
  });

  it("once a password is set, the email change asks for it: a wrong one is a violation, none at all too", async () => {
    const { open } = browser();
    const api = open();
    await signedIn(api);
    await api.changeAccountPassword("anything", PASSWORD, "key-1");
    expect(violated(await caught(api.requestAccountEmailChange("anna.new@example.com", "not it", "key-2")))).toEqual(["currentPassword"]);
    expect(violated(await caught(api.requestAccountEmailChange("anna.new@example.com", null, "key-3")))).toEqual(["currentPassword"]);
    await expect(api.requestAccountEmailChange("anna.new@example.com", PASSWORD, "key-4")).resolves.toMatchObject({ delivery: "EMAIL" });
  });

  it("the hooks: refuseNext once, then the route as it is", async () => {
    const { local, open } = browser();
    const api = open();
    await signedIn(api);
    hooks(local, { refuseNext: { requestAccountEmailChange: { status: 503, code: "DEPENDENCY_UNAVAILABLE" } } });
    expect(apiErrorFacts(await caught(api.requestAccountEmailChange("anna.new@example.com", "p", "key-1")))).toMatchObject({ status: 503 });
    await expect(api.requestAccountEmailChange("anna.new@example.com", "p", "key-1")).resolves.toMatchObject({ delivery: "EMAIL" });
  });
});
