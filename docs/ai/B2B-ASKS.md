# Backend asks from the companies (B2B) frontend — where each one stands

The companies build (TAS-500 and on) ran ahead of the backend and put its questions to the backend as numbered
comments on backend stories in Jira: **A1 … A132**. This file is the reconciliation of those asks against backend
develop **`a0499412`** (2026-11-18), made for [TAS-537](https://jira.ozero.dev/browse/TAS-537) on 2026-11-20. The
divergence record (`docs/ai/API-DIVERGENCE.md`, entries «TAS-500» … «TAS-537») says what each open ask still costs
the UI; this file says where each ask stands.

How it was made: every ask was read from its Jira comment (the comment id is in each row) and checked against the
backend with `git show` / `git grep` at `a0499412` — the gateway's `openapi.yml`, the blueprint
`docs/b2b/contracts/`, and the services' Java and docs. Jira statuses are as of 2026-11-20. A verdict is a reading of
code, not a stand measurement: on the stand none of the company routes can be called yet (`API-DIVERGENCE.md`
«TAS-537»).

Verdicts:

- **ANSWERED** — merged code or the contract settles the ask; the row says which way and whether only at gRPC level.
- **OPEN** — merged code leaves it unanswered or contradicts what was asked; **OPEN-unclear** — merged code says two
  things.
- **OVERTAKEN** — made moot; here, the payment asks on merged stories after the owner's MVP decision of 2026-11-20
  (TAS-267, comment 15101: no payments, FREE companies only).
- **WAITING** — the story's code is not merged at `a0499412`.

**Refresh this file** with the next re-pin of `docs/contract/b2b/`: re-check every OPEN and WAITING row, and add new
asks below the last number.

## Asks filed by TAS-537 (2026-11-20)

| id | where | ask | status |
|---|---|---|---|
| A127 | TAS-536 (comments 15109, addendum 15111) | Credential refusals keep their code: `MEMBERSHIP_INACTIVE`, `TENANT_MISMATCH`, `MFA_REQUIRED` arrive as 403 `SCOPE_DENIED` with the code only in `message` (`GatewayCredentialResolver`, `GrpcMembershipAuthority`); put it in `code` / `details.code`. Addendum (same day): `TOKEN_REVOKED` (arrives as 401 `AUTHENTICATION_REQUIRED`), `ADMIN_GRANT_REQUIRED`, and the gateway's bare `PERMISSION_DENIED`s in `GatewayContextFactory` / `TenantRegistryClient` | OPEN |
| A128 | TAS-333 (comment 15110) | renameTenant has no restriction gate (`TenantRenameService`): a paused or blocked company is renamed with 200, while the access matrix (`tenant.update`, policy NORMAL) says 403 `READ_ONLY` — gate it, or change the blueprint | OPEN |
| A129 | TAS-536 (comment 15109) | `TenantDto` drops the proto's `creationOperationId`, `creationKind` and `planVersionId`; publish them (removes A11's client-side record of the operation id) | OPEN |
| A130 | TAS-536 (comment 15109) | Deploy tenant-service and turn the trusted RPC context on together with TAS-536's session routes and the isolation stories, and say in the release note that it refuses today's HMAC tokens and unbound PATs | OPEN |
| A131 | TAS-478 (comment 15112) | A content read of a company awaiting its first payment answers 403 `READ_ONLY` [`PENDING_FIRST_PAYMENT`] (or 403 `INVALID_STATE` while provisioning) from the shared `CapabilityEvaluator`, where contracts «Unpaid creation errors» and `requireWorking` say 409 `PAYMENT_PENDING` — the second answer of A14. Out of the MVP (no paid creation) | OPEN |
| A132 | TAS-480 (comment 15113) | pauseTenant / resumeTenant under a block or dispute answer 403 `CAPABILITY_DISABLED` [reason], while the same company's `getTenantCapabilities` and the access matrix (OWNER_CONTROL) say `READ_ONLY` [reason] — one code for both | OPEN |
| — | [TAS-541](https://jira.ozero.dev/browse/TAS-541) | Filed as a story: trusted mode rewrites `code` and the HTTP status of errors on every legacy route, against `openapi.yml` | To Do, blocks TAS-537 |

## Summary

124 located asks (A1–A126 minus 5 not found, plus A2b, A2c and the colliding “A17” on TAS-310).

| verdict | count |
|---|---|
| ANSWERED | 31 |
| OPEN | 15 |
| OPEN-unclear | 2 |
| OVERTAKEN | 24 |
| WAITING | 52 |
| not found (A28, A105, A117, A118, A119) | 5 |

ANSWERED breakdown: 10 partial, 9 full, 7 gRPC/doc only, REST not published, 3 settled differently from the proposal, 2 conditional (trusted-context switch / tenant-storage profile) (see each row).

Merged stories: 22 of 37 (72 asks). OVERTAKEN = the 24 payment asks on merged stories (A53–A76); a further 21 payment asks sit on unmerged stories and are WAITING but equally out of MVP (see the MVP column).

Caveat for every “now” below: at a0499412 the gateway publishes only listTenants, getTenant, renameTenant, pause/resume, setPlatformBlock and getTenantCapabilities, and no REST route issues the WEB_GLOBAL / WEB_TENANT session they need (TAS-536). So “remove an assumption now” means the frontend’s code and mock can change now; nothing is reachable on the stand until TAS-536.

### ANSWERED — assumption removable now, on the published REST surface

- **A1** (TAS-338) — show the role in the picker; drop «the list = companies you may try to enter»
- **A26** (TAS-338) — stop deriving the own role from the full members directory or from ownerId
- **A18** (TAS-315) — on 401 TOKEN_REVOKED re-enter the company instead of closing it
- **A38** (TAS-333) — one client name rule for create and rename; same-name rename is a no-op
- **A31** (TAS-333) — use Tenant.version from getTenant for rename, pause and resume
- **A34** (TAS-480) — same-key retry of pause/resume is safe; keep Resume under the own pause with the flag off
- **A21** (TAS-497) — drop deriving management controls from the reader's role; read capabilities by action name
- **A30** (TAS-497) — drop always showing Pause and Transfer; hide Transfer for FREE and Pause with the flag off
- **A45** (TAS-460) — drop «no per-project task count»; read taskQuota (optional field)
- **A115** (TAS-460) — as A45; still re-read context/stats after a create
- **A50** (TAS-460) — for createIssue only: stop inferring the quota from the refused action
- **A110** (TAS-460) — stop parsing QUOTA_EXCEEDED / IDEMPOTENCY_CONFLICT from message
- **A6** (TAS-316) — read both envelopes only until the trusted-context cutover, then Problem
- **A7** (TAS-340) — nothing to build client-side: show all company projects with ADMIN for owner and TENANT_ADMIN
- **A2c** (TAS-316) — keep allowing reads under restriction; expect READ_ONLY + reason if the flag is off

### ANSWERED — semantics settled at gRPC/doc level; mock and client can follow now, REST arrives with TAS-536

- **A2** (TAS-315) — branch the selection refusal: 404 hide / 403 MEMBERSHIP_INACTIVE end / SCOPE_DENIED wrong credential; select with the account session (mock + client, REST in TAS-536)
- **A2b** (TAS-315) — a foreign company link can show «Page not found», not «access revoked» (mock now; REST in TAS-536)
- **A3** (TAS-315) — refresh 401 = re-enter the company, 403 = close it; expect a role change to drop the tab session
- **A4** (TAS-315) — the mock may model logout with cascade; no route to call yet
- **A9** (TAS-315) — the owner can open a not-yet-open company in a tab for status and cancel
- **A12** (TAS-337) — read state/updatedAt/failureCode from the create replay; FAILED = operator follow-up, FREE not refunded
- **A13** (TAS-337) — split the refusal by details.field instead of one combined phrase
- **A15** (TAS-315) — create with the account session; do not expect a distinct refusal code
- **A16** (TAS-313) — once catalogue REST ships (TAS-536): drop the PUBLISHED filter and «zero price = free», read kind
- **A17** (TAS-312) — never close the company on a member-action 409; treat it as target state
- **A20** (TAS-312) — send leave without If-Match
- **A24** (TAS-323) — re-read invitations after all four events (only when the target was TENANT_ADMIN)
- **A37** (TAS-314) — drop the «meaning undefined» note; a past paidThrough does not mean paid
- **A52** (TAS-319) — drop the «validUntil leak» concern

ANSWERED but nothing to remove yet: **A10** (FREE eligibility read exists only as gRPC), **A11** (creation fields only in proto; the published REST TenantDto omits them).

### Points that cut against the frontend’s current assumptions

- **A14 is answered twice, differently.** Docs and the tenant member RPC: AWAITING_PAYMENT → 409 PAYMENT_PENDING + PENDING_FIRST_PAYMENT. The shared capability evaluator behind native project reads: 403 READ_ONLY / INVALID_STATE. Key the «not open yet» card on the reason or lifecycle, not on the status code.
- **A2c / A35:** with the read flag off, a content read under pause/block is 403 **READ_ONLY** + reason, not CAPABILITY_DISABLED; only one reason is ever sent (`GatewayErrorHandler.java:85-88`, `TenantDecisionFacts.java:320-323`).
- **A37:** after an owner change autopay becomes **SUSPENDED**, not DISABLED.
- **A110:** after a downgrade the READ_ONLY/OVER_QUOTA refusal on createIssue is **400**, not 403; numbering exhaustion is still 429.
- **A2b / A15 (inferred from code, not run):** MEMBERSHIP_INACTIVE and «Global web session required» are raised without details, so on REST they may surface as 403 SCOPE_DENIED.
- **A45 / A115:** with `taska.rpc.context.enabled` on, a failed quota read or more than 100 projects fails the whole stats/context response instead of omitting taskQuota (`TaskQuotaClient.java:34-35`).
- **A18 vs A27:** the edge check that gives A18 its 401 also blocks the lost-leave replay A27 needs; still unresolved.
- **A34(c), A35, A42** are parked in backend story TAS-535 (To Do) — a business decision, not code.

### Backend replies in Jira

- TAS-497/14403 (2026-11-10) — A21, A30: «A21/A30: опубликован CapabilityAction в gateway OpenAPI». Verified in code.
- TAS-460/14249 (2026-11-06) — A45, A50 moved to TAS-343: «frontend A45 taskQuota в bulk stats/context и A50 Problem quota». A45 landed in daff83cc; A50 only for TASK_LIFETIME.
- TAS-321/14302 (2026-11-06) — A19 blocked on TAS-316/317: «затем композиция профиля на страницу/изменённого участника (A19) и подписанный avatar URL».
- TAS-535 (filed by the backend, To Do) — A34(c), A35/A42: «Комментарий TAS-480 A34(c) предлагает разрешить resume под platform block».
- In-repo doc replies naming asks: `docs/b2b/contracts/README.md:184` (TAS-501 A16), `:198` (TAS-478 / A14), `billing-service/SUBSCRIPTIONS.md:37` (TAS-504 A37).
- No other backend comment after 2026-11-04 names an ask.

### Not found

- **A28** — No Jira comment labels A28. The only mention is taska-ui branch feature/TAS-524-company-activity docs/ai/API-DIVERGENCE.md:2495-2496 ('Kind labels and the kind filter's options are this build's ... Removal: ask A28'). The closest Jira text is the unlabelled TAS-523 proposal, comment 14225 (2026-11-05), whose kind list 'растёт без версии'. Not counted as a located ask.
- **A105** — No Jira comment labels A105. The only mention is taska-ui branch feature/TAS-527-account-credentials docs/ai/API-DIVERGENCE.md:2355 ('the contract confirms by an 8-digit code typed in Settings (A105, owner's call; the contract wins)'). TAS-479/14536 states the same fact in its preamble without a number; TAS-527/14537 says the asks A98-A107 are on TAS-327, TAS-477, TAS-479, and none of them carries A105.
- **A117** — Not in any Jira comment (TAS-460/459 carry A110-A116, TAS-496 starts at A120) and not in any taska-ui branch.
- **A118** — Not in any Jira comment and not in any taska-ui branch.
- **A119** — Not in any Jira comment and not in any taska-ui branch.

## Table

Columns: id | story | Jira status (2026-11-20) | story code merged in a0499412 | verdict | evidence (path:line at a0499412) and backend reply | frontend consequence | MVP scope (owner decision TAS-267/15101). Paths shortened with `…/` inside `src/main/java`.

| id | story | status | merged in a0499412 | verdict | evidence / backend reply | frontend consequence | MVP |
|---|---|---|---|---|---|---|---|
| A1 | TAS-338 | Done | yes — 247e680b (PR #331); REST GET published | **ANSWERED** | REST listTenants: ACTIVE memberships in every lifecycle except DELETED; SUSPENDED/REMOVED not listed; each item carries the caller's membership. `api-gateway/src/main/resources/static/openapi.yml:5075-5078` «SUSPENDED and REMOVED memberships are not listed»; `:5636` TenantCallerMembershipDto. | show the role in the picker; drop «the list = companies you may try to enter» | in |
| A2 | TAS-315 | Done | yes, gRPC only — 999e535e (PR #288) + f4adf672; sessions off by default, REST is TAS-536 | **ANSWERED (partial, gRPC only)** | Rules exist, no published table: wrong credential → 403 SCOPE_DENIED; missing/foreign/DELETED company → 404 TENANT_NOT_FOUND; SUSPENDED/REMOVED → 403 MEMBERSHIP_INACTIVE; PROVISIONING/AWAITING_PAYMENT admitted. `docs/b2b/auth-sessions-implementation.md:35`; credential settled as WEB_GLOBAL + tenants:select (`auth-service/…/session/AuthSessionGrpcService.java:107-116`), but the blueprint still says `x-policy: WEB_ACCOUNT` (`docs/b2b/contracts/b2b-openapi.yaml:1475`). AUTO_CLOSED/OWNER_CANCELLED/DELETING are admitted only because there is no lifecycle check besides DELETED (`TenantMembershipService.java:251`). | branch the selection refusal: 404 hide / 403 MEMBERSHIP_INACTIVE end / SCOPE_DENIED wrong credential; select with the account session (mock + client, REST in TAS-536) | in |
| A2b | TAS-315 | Done | yes, gRPC only — 999e535e (PR #288) + f4adf672; sessions off by default, REST is TAS-536 | **ANSWERED (gRPC only)** | Unknown or never-member company → 404 TENANT_NOT_FOUND; SUSPENDED and REMOVED → 403 MEMBERSHIP_INACTIVE. `auth-service/…/session/WebSessionStore.java:194-196`; `auth-service/…/trust/GrpcMembershipAuthority.java:81-85`. Caveat (inferred, not run): that error is built without details, so on REST it may surface as 403 SCOPE_DENIED (`GatewayErrorHandler.java:74-80`). | a foreign company link can show «Page not found», not «access revoked» (mock now; REST in TAS-536) | in |
| A2c | TAS-316 | Done | yes — ddd5cc56 | **ANSWERED (differently)** | READ_WHILE_RESTRICTED defaults to true (`tenant-service/PLATFORM-FLAGS.md:11`); false closes ordinary members' content reads under pause/block with 403 READ_ONLY and the reason, not CAPABILITY_DISABLED; entering the company is never refused (`tenant-service/RESTRICTIONS.md:13`). | keep allowing reads under restriction; expect READ_ONLY + reason if the flag is off | in |
| A3 | TAS-315 | Done | yes, gRPC only — 999e535e (PR #288) + f4adf672; sessions off by default, REST is TAS-536 | **ANSWERED (gRPC only)** | Revoked, reused, expired, parent-revoked and stale-generation refresh → 401 TOKEN_REVOKED; inactive membership → 403 MEMBERSHIP_INACTIVE; a role change bumps the membership version and so ends the tenant session. `WebSessionStore.java:98-100`, `:506-511`; `TenantMembershipMutationService.java:403`. | refresh 401 = re-enter the company, 403 = close it; expect a role change to drop the tab session | in |
| A4 | TAS-315 | Done | yes, gRPC only — 999e535e (PR #288) + f4adf672; sessions off by default, REST is TAS-536 | **ANSWERED (gRPC only)** | `RevokeWebSession` revokes the global session with cascade to tenant sessions; no REST route. `grpc-common-lib/src/main/proto/v1/b2b-auth-session.proto:50`; `WebSessionStore.java:713-728`; `docs/b2b/auth-sessions-implementation.md:37` «The public REST route is not implemented by this PR». | the mock may model logout with cascade; no route to call yet | in |
| A5 | TAS-345 | To Do | no — no TAS-345 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (platform admin TAS-526, admin MFA) |
| A6 | TAS-316 | Done | yes — ddd5cc56 | **ANSWERED (behind a switch)** | With `taska.rpc.context.enabled=true` (default false) every legacy REST error is application/problem+json with code, title, status, requestId, reasons plus legacy message/details; X-Request-Id kept. `docs/security/trusted-rpc-context.md:88`; `api-gateway/…/error/GatewayErrorHandler.java:30-31,74-81,116`. | read both envelopes only until the trusted-context cutover, then Problem | in |
| A7 | TAS-340 | Done | yes — da5b0385 (PR #324) | **ANSWERED (tenant-storage profile)** | An ACTIVE owner/TENANT_ADMIN has effective ADMIN on every company project without a grant; listMyProjects includes them; getProject authorizes them. `project-service/TENANT-API.md:11`; `project-service/…/projectstorage/TenantProjectApi.java:89,224-229`. | nothing to build client-side: show all company projects with ADMIN for owner and TENANT_ADMIN | in |
| A8 | TAS-315 | Done | yes, gRPC only — 999e535e (PR #288) + f4adf672; sessions off by default, REST is TAS-536 | **OPEN** | Provider sign-in is not wired to B2B sessions: `docs/b2b/auth-sessions-implementation.md:27` «legacy login, social login … are not switched to it»; `:37` «Social login exchange and GA MFA remain separate adapters». | — | in |
| A9 | TAS-315 | Done | yes, gRPC only — 999e535e (PR #288) + f4adf672; sessions off by default, REST is TAS-536 | **ANSWERED (gRPC only; REST getTenant only)** | ACTIVE members may select a PROVISIONING/AWAITING_PAYMENT company; getTenant, getTenantOperation, cancelTenantCreation, getSubscription accept that session. `auth-sessions-implementation.md:35`; `tenant-service/PROVISIONING.md:23`; `tenant-service/CREATION-CLOSURE.md:7`; `billing-service/SUBSCRIPTIONS.md:31`. | the owner can open a not-yet-open company in a tab for status and cancel | in |
| A10 | TAS-472 | Done | yes, gRPC only — 202c2692 (PR #299) | **ANSWERED (gRPC only)** | `GetTenantCreationOptions` (WEB_GLOBAL) returns plans + free_eligibility AVAILABLE/USED, never naming the company: `grpc-common-lib/src/main/proto/v1/free-eligibility.proto:9-11,26`. REST route only intended: `tenant-service/FREE-ELIGIBILITY.md:33`. | — (keep offering FREE until the REST route exists; TAS-536) | in |
| A11 | TAS-337 | Done | yes, gRPC only — 7ae29a1a (PR #301) | **ANSWERED (gRPC only; REST TenantDto omits them)** | Proto Tenant has plan_version_id (10), creation_operation_id (11), creation_kind (12): `grpc-common-lib/src/main/proto/v1/tenant-registry.proto:76-79`; `tenant-service/PROVISIONING.md:3`. The published REST TenantDto (`openapi.yml:5604-5637`) and the closed blueprint Tenant (`b2b-openapi.yaml:4232-4291`) lack them. | — (REST still lacks the fields) | in |
| A12 | TAS-337 | Done | yes, gRPC only — 7ae29a1a (PR #301) | **ANSWERED (partial, gRPC only)** | Replays read the real operation (`PROVISIONING.md:3`); FAILED is terminal for operator investigation and keeps FREE consumed (`:17`); SUCCEEDED and ACTIVE in one transaction (`:13`). MANUAL_REVIEW is not explained. | read state/updatedAt/failureCode from the create replay; FAILED = operator follow-up, FREE not refunded | in |
| A13 | TAS-337 | Done | yes, gRPC only — 7ae29a1a (PR #301) | **ANSWERED (differently, gRPC only)** | 120 code points; edge whitespace still refused, not trimmed; no violations[], details carry field=name or field=planVersionId; unpublished plan is 400 VALIDATION_FAILED with field=planVersionId. `TenantRegistryService.java:120-126`; `tenant-service/…/GrpcPublishedPlans.java:85`. | split the refusal by details.field instead of one combined phrase | in |
| A14 | TAS-478 | Done | yes — 28ed870f (PR #302) | **OPEN-unclear** | Doc and tenant member RPC: AWAITING_PAYMENT → 409 PAYMENT_PENDING with reason PENDING_FIRST_PAYMENT, PROVISIONING → 409 INVALID_STATE (`docs/b2b/contracts/README.md:198-200`, a doc reply titled «TAS-478 / A14»; `TenantCreationLifecycle.java:536-543`). But the shared evaluator behind native project reads gives 403 READ_ONLY/INVALID_STATE for the same states (`grpc-common-lib/…/capability/CapabilityEvaluator.java:311-320,365`; `TenantDecisionFacts.java:324-328`). Two answers in merged code. — Backend doc reply: README.md:198 «Unpaid creation errors (TAS-478 / A14)» | — (key the «not open yet» card on reason PENDING_FIRST_PAYMENT or lifecycle, not on status) | in |
| A15 | TAS-315 | Done | yes, gRPC only — 999e535e (PR #288) + f4adf672; sessions off by default, REST is TAS-536 | **ANSWERED (partial, gRPC only)** | The account session carries `tenants:create` (`auth-service/…/session/TenantAccessIssuer.java:61`); createTenant accepts only WEB_GLOBAL, else 403 PERMISSION_DENIED «Global web session required» with no code (`tenant-service/…/TenantCreationTransaction.java:28-32`). No REST createTenant. | create with the account session; do not expect a distinct refusal code | in |
| A16 | TAS-313 | Done | yes — 0db5be2d (PR #291) | **ANSWERED (gRPC only)** | ListBillingPlans returns only the latest published version per code; PlanVersion.kind FREE/PAID. `billing-service/README.md:7,9`; `BillingCatalog.java:104-107`; blueprint `b2b-openapi.yaml:5529-5531`; doc reply `docs/b2b/contracts/README.md:184` «(TAS-501 A16)». — Backend doc reply: README.md:184 cites «TAS-501 A16» | once catalogue REST ships (TAS-536): drop the PUBLISHED filter and «zero price = free», read kind | in |
| A17 (TAS-310) | TAS-310 | Done | yes — 4199a69d (PR #283, 2026-11-03, before the ask) | **OPEN** | No rate limiter on createTenant (`TenantRegistryService.java:147-200`); gateway still takes Retry-After only from details.retryAfterSeconds (`api-gateway/…/error/GatewayErrorHandler.java:117-121`); blueprint still promises 429 (`docs/b2b/contracts/README.md:81`). | — | in |
| A17 | TAS-312 | Done | yes — 11f14d87 (PR #287) + 8f730545 | **ANSWERED** | Role change, state change or removal of a non-ACTIVE target → ABORTED INVALID_STATE (409). `tenant-service/src/main/java/ru/taska/tenant/TenantMembershipMutationService.java:343-344` «!"ACTIVE".equals(oldStatus) … "INVALID_STATE"»; `tenant-service/README.md:30`. | never close the company on a member-action 409; treat it as target state | in |
| A18 | TAS-315 | Done | yes, gRPC only — 999e535e (PR #288) + f4adf672; sessions off by default, REST is TAS-536 | **ANSWERED** | Stale generation of an active member → 401 TOKEN_REVOKED at the edge resolver, membership writes, getTenant and refresh. `auth-service/…/gateway/GatewayCredentialResolver.java:281-282`; `TenantMembershipMutationService.java:263-266`. Caveat: tenant-service members list still maps a stale generation to 404 (`TenantMembershipService.java:148,175-177`), reachable only if the edge check is skipped. | on 401 TOKEN_REVOKED re-enter the company instead of closing it | in |
| A19 | TAS-321 | In Review | no — no TAS-321 commit in a0499412 | **WAITING** | Story code not merged at a0499412. — Backend reply TAS-321/14302 (2026-11-06), blocked on TAS-316/317: «затем композиция профиля на страницу/изменённого участника (A19) и подписанный avatar URL» | — | in |
| A20 | TAS-312 | Done | yes — 11f14d87 (PR #287) + 8f730545 | **ANSWERED** | Leave needs no If-Match; its precondition is the signed membership generation. `TenantMembershipMutationService.java:184-193` «if (!leave && !mutation.hasExpectedVersion()) … claims.getMembershipGeneration()»; `tenant-service/README.md:30`. | send leave without If-Match | in |
| A21 | TAS-497 | Done | yes — 43d6c89d (PR #322); REST capabilities published | **ANSWERED** | Closed CapabilityAction enum published in the gateway OpenAPI; member role changes are membership.role_update, no membership.write alias. `openapi.yml:5445-5447,5459`; `docs/security/public-capabilities.md:12-14`; `docs/b2b/contracts/README.md:57`. — Backend reply TAS-497/14403 (2026-11-10): «A21/A30: опубликован CapabilityAction в gateway OpenAPI» | drop deriving management controls from the reader's role; read capabilities by action name | in |
| A22 | TAS-335 | To Do | no — no TAS-335 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | in |
| A23 | TAS-335 | To Do | no — no TAS-335 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | in |
| A24 | TAS-323 | Done | yes — 8ef20639 (PR #325) | **ANSWERED (partial)** | Code revokes a TENANT_ADMIN's pending invitations on demotion, suspension, removal and leave: `TenantMembershipMutationService.java:376-380`; `tenant-service/README.md:40`. Contracts §8 still names only suspend/remove: `docs/b2b/contracts/README.md:98`. | re-read invitations after all four events (only when the target was TENANT_ADMIN) | in |
| A25 | TAS-321 | In Review | no — no TAS-321 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | in |
| A26 | TAS-338 | Done | yes — 247e680b (PR #331); REST GET published | **ANSWERED** | Items of GET /tenants and the member GET /tenants/{id} carry membership {role,state,isOwner,version}. `openapi.yml:5636`; `:5239` «A member read includes the caller's membership». | stop deriving the own role from the full members directory or from ownerId | in |
| A27 | TAS-315 | Done | yes, gRPC only — 999e535e (PR #288) + f4adf672; sessions off by default, REST is TAS-536 | **OPEN** | The service replays the stored leave receipt before the actor check (`TenantMembershipMutationService.java:283`), but the edge refuses a departed member's token and the narrow receipt path is deferred: `docs/b2b/auth-sessions-implementation.md:37` «self-leave receipt replay must use a narrowly scoped receipt path in TAS-316/317». Contracts §6/§8 unchanged. Conflict with A18 unresolved. | — | in |
| A29 | TAS-335 | To Do | no — no TAS-335 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | in |
| A30 | TAS-497 | Done | yes — 43d6c89d (PR #322); REST capabilities published | **ANSWERED (partial)** | GET capabilities returns tenant.update, pause, resume, transfer_ownership; flag off → CAPABILITY_DISABLED, transfer without active paid coverage → READ_ONLY (PAYMENT_EXPIRED if expired), restriction → READ_ONLY with restrictions[]. `CapabilityEvaluator.java:101-106,354-359,492-493,520`; `openapi.yml:5694-5711`. Not done: the content-read capability from the 14173 refinement. — Backend reply TAS-497/14403 (2026-11-10): «A21/A30: опубликован CapabilityAction в gateway OpenAPI» | drop always showing Pause and Transfer; hide Transfer for FREE and Pause with the flag off | in (capabilities); its transfer part follows transfer |
| A31 | TAS-333 | Done | yes — b1363141 (PR #327); REST PATCH published | **ANSWERED (partial)** | Rename, pause, resume and platform-block take strong quoted Tenant.version as If-Match and bump it (`openapi.yml:5272`; `tenant-service/RESTRICTIONS.md:7`; `TenantRestrictionService.java:239,258-259`); blueprint: version advances on name, owner, restrictions, lifecycle (`b2b-openapi.yaml:4280`). Transfer is not implemented, and Tenant also exposes a separate ownerVersion. | use Tenant.version from getTenant for rename, pause and resume | in |
| A32 | TAS-473 | In Review | no — no TAS-473 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | not named (ownership transfer of a paid company) |
| A33 | TAS-473 | In Review | no — no TAS-473 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | not named (ownership transfer of a paid company) |
| A34 | TAS-480 | Done | yes — a0499412 (PR #336); REST pause/platform-block published | **ANSWERED (partial)** | (a) pause on paused / resume on unpaused with the current version → 200 unchanged (`TenantRestrictionService.java:252,267`; `RESTRICTIONS.md:7`); (b) the OWNER_PAUSE flag gates only a new pause (`RESTRICTIONS.md:9`); (d) flag off → 403 CAPABILITY_DISABLED with reasons [] (`TenantRestrictionService.java:182,198-199`). (c) OPEN: resume under platform block is refused, deferred to TAS-535 (`RESTRICTIONS.md:11`). — Backend filed TAS-535 (To Do): «Комментарий TAS-480 A34(c) предлагает разрешить resume под platform block»; proposal.md:22 «Бизнес-вопросы A34/A42 записаны в TAS-535» | same-key retry of pause/resume is safe; keep Resume under the own pause with the flag off | not named (pause / platform block) |
| A35 | TAS-480 | Done | yes — a0499412 (PR #336); REST pause/platform-block published | **OPEN** | Settled: getTenant (CONTROL), getSubscription (FINANCE_READ), leave (LEAVE) never refused for a restriction (`access-matrix.json:3641,3665,3671`). Not as asked: content read with the flag off → 403 READ_ONLY + one reason (`RESTRICTIONS.md:13`); pause/resume/transfer refused under platform block (`access-matrix.json:3677-3682`); tenant.update capability denied under any restriction (`CapabilityEvaluator.java:455`) while rename itself has no gate; directory/inbox follow content read. Deferred to TAS-535. — Backend filed TAS-535 (To Do): «Комментарий TAS-480 A34(c) предлагает разрешить resume под platform block»; proposal.md:22 «Бизнес-вопросы A34/A42 записаны в TAS-535» | — | not named (pause / platform block) |
| A36 | TAS-473 | In Review | no — no TAS-473 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | not named (ownership transfer of a paid company) |
| A37 | TAS-314 | Done | yes — 9272fc84 (PR #292) | **ANSWERED (differently)** | paidThrough = exclusive end instant, absent for FREE and before first payment, not rewritten by pause/block: `billing-service/SUBSCRIPTIONS.md:37` «(TAS-504 A37)». After an owner change autopay becomes SUSPENDED, not DISABLED: `billing-service/AUTOPAY.md:59-60`. gRPC/blueprint only. — Backend doc reply: SUBSCRIPTIONS.md:37 cites «TAS-504 A37» | drop the «meaning undefined» note; a past paidThrough does not mean paid | mostly moot: FREE companies omit paidThrough |
| A38 | TAS-333 | Done | yes — b1363141 (PR #327); REST PATCH published | **ANSWERED** | One validator for create and rename: 1–120 code points, VALIDATION_FAILED with field name; same-name rename → 200 with version unchanged. `TenantRegistryService.java:118-126`; `TenantRenameService.java:41`; `openapi.yml:5309` «Same-name requests preserve the current version»; legacy names up to 128 may still come back (`openapi.yml:5614`). | one client name rule for create and rename; same-name rename is a no-op | in |
| A39 | TAS-338 | Done | yes — 247e680b (PR #331); REST GET published | **OPEN** | TenantDto has no owner display name. `openapi.yml:5604-5637` (fields id … membership); `tenant-service/README.md:51` «без данных других участников и directory». | — | in |
| A40 | TAS-480 | Done | yes — a0499412 (PR #336); REST pause/platform-block published | **OPEN** | Tenant.restrictions is still a bare code list (`openapi.yml:5617-5620`; `tenant-registry.proto:71`); the block reason stays in private audit (`RESTRICTIONS.md:3`). | — | not named (pause / platform block) |
| A41 | TAS-473 | In Review | no — no TAS-473 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | not named (ownership transfer of a paid company) |
| A42 | TAS-480 | Done | yes — a0499412 (PR #336); REST pause/platform-block published | **OPEN** | Deferred: `openspec/changes/archive/2026-11-18-tas-480-tenant-restrictions/proposal.md:22`; DIRECTORY and INBOX inherit CONTENT_READ (`access-matrix.json:3572-3573,3732-3733`). — Backend filed TAS-535 (To Do): «Комментарий TAS-480 A34(c) предлагает разрешить resume под platform block»; proposal.md:22 «Бизнес-вопросы A34/A42 записаны в TAS-535» | — | not named (pause / platform block) |
| A43 | TAS-319 | Done | yes — 8ebcf0c1 (PR #303) | **OPEN** | Subscription and Entitlement still carry only planVersionId/scheduledPlanVersionId, no plan snapshot: `grpc-common-lib/src/main/proto/v1/billing-catalog.proto:78-92,256-268`. Only the RETIRED part is settled: the public list never returns history (`billing-service/README.md:9`), so a lookup by id can miss a grandfathered version. | — | in |
| A44 | TAS-359 | Done | yes — 8ab229d3 (PR #305) | **OPEN** | No /tenants/{id}/plan route in the gateway (`openapi.yml:5069-5328`) or the blueprint. | — | in |
| A45 | TAS-460 | Done | yes — efed95aa (PR #308); REST part via TAS-343 daff83cc (PR #328) | **ANSWERED** | taskQuota {used, limit?, unlimited} in ProjectStatsDto and ProjectContextResponseDto, filled from batched GetProjectTaskQuotas (landed in TAS-343 daff83cc). `openapi.yml:7262,7282,7549`; `api-gateway/…/ProjectStatsService.java:72`. Native mode only; with taska.rpc.context.enabled a failed quota read or >100 projects fails the whole response (`TaskQuotaClient.java:34-35`). — Backend reply TAS-460/14249 (2026-11-06) moved it to TAS-343: «frontend A45 taskQuota в bulk stats/context и A50 Problem quota» | drop «no per-project task count»; read taskQuota (optional field) | in |
| A46 | TAS-480 | Done | yes — a0499412 (PR #336); REST pause/platform-block published | **OPEN** | No restrictionDetails/since/quotaKinds (`tenant-registry.proto:71`); admin bypass text unchanged (`docs/b2b/contracts/README.md:102`); model→wire names mapped only in code (`TenantRestrictions.java:24-26`), model doc unchanged (`docs/b2b/target-data-model.md:266`). | — | not named (pause / platform block) |
| A47 | TAS-483 | To Do | no — no TAS-483 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (paid plan terms) |
| A48 | TAS-319 | Done | yes — 8ebcf0c1 (PR #303) | **OPEN** | Entitlement has no coverage_state (`billing-catalog.proto:256-268`); restriction split described only in `billing-service/ENTITLEMENTS.md:19,23`. | — | in |
| A49 | TAS-359 | Done | yes — 8ab229d3 (PR #305) | **OPEN-unclear** | No ETag, no plan read, no entitlementVersion on Tenant (`b2b-openapi.yaml:4281`); REST capabilities carries entitlementVersion with expiry ≤30 s (`openapi.yml:5720,5725`), which could be polled but is not offered as the watch signal. | — | in |
| A50 | TAS-460 | Done | yes — efed95aa (PR #308); REST part via TAS-343 daff83cc (PR #328) | **ANSWERED (partial)** | RestErrorResponse.quota {kind, limit, used} exists only for TASK_LIFETIME on create-issue: `openapi.yml:7582-7588` pattern `^TASK_LIFETIME$`; `GatewayErrorHandler.java:94`. Create-project and upload-link refusals do not carry it. — Backend reply TAS-460/14249 (2026-11-06) moved it to TAS-343: «frontend A45 taskQuota в bulk stats/context и A50 Problem quota» | for createIssue only: stop inferring the quota from the refused action | in |
| A51 | TAS-319 | Done | yes — 8ebcf0c1 (PR #303) | **OPEN** | CONTROL and FINANCE_READ deny on no restriction (`docs/b2b/inventory/access-matrix.json:3665,3671`), but no guarantee for getEntitlement/getTenantQuotas; GetTenantQuotas pulls the task summary through `issue-service/…/LifetimeTaskQuota.java:516-517`, which fails UNAVAILABLE once paidThrough is past; no summary read. | — | in |
| A52 | TAS-319 | Done | yes — 8ebcf0c1 (PR #303) | **ANSWERED** | Intended: Entitlement is the member-safe read, owner-only applies to subscription and invoices. `billing-service/ENTITLEMENTS.md:7` «safe tenant-member response»; `:11` adds paid_through. | drop the «validUntil leak» concern | in |
| A53 | TAS-337 | Done | yes, gRPC only — 7ae29a1a (PR #301) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **no** — nothing issues INITIAL; PAID stays AWAITING_PAYMENT (`tenant-service/PROVISIONING.md:12`); CreateTenantRequest has no buyer (`b2b-openapi.yaml:4349-4360`). | — | out (payments) |
| A54 | TAS-348 | Done | yes — 55e8ca00 (PR #323) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **no** — static env URLs (`billing-service/…/StripePaymentProvider.java:97-98`; `billing-service/PAYMENT-PROVIDER.md:37-38`). | — | out (payments) |
| A55 | TAS-349 | Done | yes — 1041465c (PR #315) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **partial** — unique per (tenant, kind, key), so two tabs collapse (`0010-payment-attempts.sql:19`); blueprint wording unchanged (`docs/b2b/contracts/README.md:88`). | — | out (payments) |
| A56 | TAS-349 | Done | yes — 1041465c (PR #315) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **partial** — expired+unpaid session → DECLINED → attempt FAILED, but only on a read after Stripe's 24 h; checkout.session.expired still rejected (`StripePaymentProvider.java:189-192,209-210`). | — | out (payments) |
| A57 | TAS-349 | Done | yes — 1041465c (PR #315) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **no** — second key → generic conflict (`PaymentAttemptStore.java:181`); no activeCheckout on Invoice. | — | out (payments) |
| A58 | TAS-349 | Done | yes — 1041465c (PR #315) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **no** — Checkout = id, invoiceId, state, redirectUrl, expiresAt (`b2b-openapi.yaml:6123-6153`). | — | out (payments) |
| A59 | TAS-349 | Done | yes — 1041465c (PR #315) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **no** — hostedUrl dropped, only state and payment id persisted (`PaymentAttemptStore.java:268`). | — | out (payments) |
| A60 | TAS-349 | Done | yes — 1041465c (PR #315) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **no** — one IDEMPOTENCY_CONFLICT for all three cases (`PaymentAttemptStore.java:151,181,290-291`). | — | out (payments) |
| A61 | TAS-354 | Done | yes — c664c79b (PR #311) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **no** — no preview RPC (`billing-catalog.proto:318-333`). | — | out (payments) |
| A62 | TAS-354 | Done | yes — c664c79b (PR #311) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **partial** — service doc: owner issues the PLAN_CHANGE invoice (`billing-service/PLAN-CHANGES.md:14-15`); blueprint silent, invoiceId never filled. | — | out (payments) |
| A63 | TAS-354 | Done | yes — c664c79b (PR #311) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **no** — no pendingPlanChange (`b2b-openapi.yaml:5654-5699`). | — | out (payments) |
| A64 | TAS-354 | Done | yes — c664c79b (PR #311) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **no** — fields undocumented (`b2b-openapi.yaml:5682-5687`). | — | out (payments) |
| A65 | TAS-354 | Done | yes — c664c79b (PR #311) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **no** — nothing writes VOID; checkout accepts any OPEN invoice (`PaymentAttemptStore.java:121`). | — | out (payments) |
| A66 | TAS-354 | Done | yes — c664c79b (PR #311) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **no** — cancel flips flags only; issued RENEWAL stays payable (`SubscriptionPlanChanges.java:722`; `RenewalCalendar.java:71`). | — | out (payments) |
| A67 | TAS-355 | Done | yes — 195e2c36 (PR #329) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **no** — nothing writes payment_methods, no terms read (`billing-service/AUTOPAY.md:85`). | — | out (payments) |
| A68 | TAS-355 | Done | yes — 195e2c36 (PR #329) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **partial** — service doc/code allow revoke under pause/block/dispute (`AUTOPAY.md:21`; `AutopayStore.java:185`), access-matrix still denies (`access-matrix.json:3711-3716`). | — | out (payments) |
| A69 | TAS-355 | Done | yes — 195e2c36 (PR #329) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **partial** — charged invoices, one try per period, SUSPENDED writer, no self re-enable documented (`AUTOPAY.md:40,44,60,67-68`); timing and exit from SUSPENDED not. | — | out (payments) |
| A70 | TAS-354 | Done | yes — c664c79b (PR #311) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **no** — billing-only codes, no mapping (`SubscriptionPlanChanges.java:130,163,716`; `b2b-openapi.yaml:3929-3961`). | — | out (payments) |
| A71 | TAS-354 | Done | yes — c664c79b (PR #311) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **no** — no x-version-source on change/cancel/resume (`b2b-openapi.yaml:2052-2214`). | — | out (payments) |
| A72 | TAS-354 | Done | yes — c664c79b (PR #311) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **no** — cancel/resume always bump version (`SubscriptionPlanChanges.java:722`). | — | out (payments) |
| A73 | TAS-354 | Done | yes — c664c79b (PR #311) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **no** — FREE apply leaves renewal_cancelled (`SubscriptionPlanChanges.java:547`). | — | out (payments) |
| A74 | TAS-354 | Done | yes — c664c79b (PR #311) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **no** — latest-version filter before the same-plan check → 404 (`SubscriptionPlanChanges.java:136`; `SubscriptionStore.java:222-230`). | — | out (payments) |
| A75 | TAS-354 | Done | yes — c664c79b (PR #311) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **no** — no aggregated read (`billing-catalog.proto:318-333`). | — | out (payments) |
| A76 | TAS-354 | Done | yes — c664c79b (PR #311) | **OVERTAKEN (MVP 2026-11-20: no payments)** | Code check (light): answered-in-code **no** — later choice supersedes paid changes unchecked (`SubscriptionPlanChanges.java:221,260`). | — | out (payments) |
| A77 | TAS-356 | To Do | no — no TAS-356 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A78 | TAS-357 | To Do | no — no TAS-357 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A79 | TAS-482 | To Do | no — no TAS-482 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A80 | TAS-357 | To Do | no — no TAS-357 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A81 | TAS-358 | To Do | no — no TAS-358 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A82 | TAS-357 | To Do | no — no TAS-357 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A83 | TAS-358 | To Do | no — no TAS-358 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A84 | TAS-482 | To Do | no — no TAS-482 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A85 | TAS-357 | To Do | no — no TAS-357 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A86 | TAS-357 | To Do | no — no TAS-357 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A87 | TAS-358 | To Do | no — no TAS-358 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A88 | TAS-357 | To Do | no — no TAS-357 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A89 | TAS-358 | To Do | no — no TAS-358 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A90 | TAS-358 | To Do | no — no TAS-358 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A91 | TAS-490 | To Do | no — no TAS-490 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A92 | TAS-490 | To Do | no — no TAS-490 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A93 | TAS-490 | To Do | no — no TAS-490 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A94 | TAS-358 | To Do | no — no TAS-358 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A95 | TAS-358 | To Do | no — no TAS-358 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A96 | TAS-358 | To Do | no — no TAS-358 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A97 | TAS-357 | To Do | no — no TAS-357 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (payments) |
| A98 | TAS-477 | To Do | no — no TAS-477 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | not named (password change / email change) |
| A99 | TAS-327 | To Do | no — no TAS-327 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | in |
| A100 | TAS-479 | To Do | no — no TAS-479 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | not named (password change / email change) |
| A101 | TAS-327 | To Do | no — no TAS-327 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | in |
| A102 | TAS-327 | To Do | no — no TAS-327 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | in |
| A103 | TAS-477 | To Do | no — no TAS-477 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | not named (password change / email change) |
| A104 | TAS-479 | To Do | no — no TAS-479 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | not named (password change / email change) |
| A106 | TAS-479 | To Do | no — no TAS-479 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | not named (password change / email change) |
| A107 | TAS-327 | To Do | no — no TAS-327 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | in |
| A108 | TAS-327 | To Do | no — no TAS-327 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | in |
| A109 | TAS-479 | To Do | no — no TAS-479 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | not named (password change / email change) |
| A110 | TAS-460 | Done | yes — efed95aa (PR #308); REST part via TAS-343 daff83cc (PR #328) | **ANSWERED (partial)** | At the limit 422 QUOTA_EXCEEDED with quota and empty reasons; same key/other body 409 IDEMPOTENCY_CONFLICT (`LifetimeTaskQuota.java:196-208`; `RestErrorMapper.java:31-38`; `TenantIssueStore.java:410-411`). Still different: after a downgrade READ_ONLY/OVER_QUOTA goes out as 400, not 403 (`LifetimeTaskQuota.java:117-127`; `RestErrorMapper.java:58`); only the first reason (`TenantDecisionFacts.java:320-323`); numbering exhaustion still 429 (`LifetimeTaskQuota.java:209`). | stop parsing QUOTA_EXCEEDED / IDEMPOTENCY_CONFLICT from message | in |
| A111 | TAS-460 | Done | yes — efed95aa (PR #308); REST part via TAS-343 daff83cc (PR #328) | **OPEN** | `LifetimeTaskQuota.terms` still treats a past paidThrough as UNAVAILABLE (`issue-service/…/LifetimeTaskQuota.java:516-517`), hitting the single-project quota RPC, the tenant summary and admin-bypass create. Published REST mostly avoids it: ordinary create is refused earlier with 403 READ_ONLY [PAYMENT_EXPIRED] (`CapabilityEvaluator.java:338-340`), and stats/context read through a lease (`EntitlementProjection.java:108-109`). | — | in |
| A112 | TAS-459 | To Do | no — no TAS-459 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | not named (project hard delete) |
| A113 | TAS-459 | To Do | no — no TAS-459 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | not named (project hard delete) |
| A114 | TAS-460 | Done | yes — efed95aa (PR #308); REST part via TAS-343 daff83cc (PR #328) | **OPEN** | GetTenantQuotas still adds a KIND_TASK_LIFETIME row (`tenant-service/…/SeatQuotaStore.java:599`); blueprint QuotaSnapshot still allows only SEAT/PROJECT/STORAGE_BYTES (`b2b-openapi.yaml:4720-4736`). | — | in |
| A115 | TAS-460 | Done | yes — efed95aa (PR #308); REST part via TAS-343 daff83cc (PR #328) | **ANSWERED (partial)** | taskQuota in context and stats (as A45); the 201 createIssue IssueResponseDto has none (`openapi.yml:6167`). | as A45; still re-read context/stats after a create | in |
| A116 | TAS-460 | Done | yes — efed95aa (PR #308); REST part via TAS-343 daff83cc (PR #328) | **OPEN** | Quota reads still take FOR UPDATE, may write, use a random request id; no per-project version. `LifetimeTaskQuota.java:426,248,414-415`; `issue-service.proto:2726-2731`. | — | in |
| A120 | TAS-496 | To Do | no — no TAS-496 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (account deletion) |
| A121 | TAS-496 | To Do | no — no TAS-496 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (account deletion) |
| A122 | TAS-496 | To Do | no — no TAS-496 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (account deletion) |
| A123 | TAS-496 | To Do | no — no TAS-496 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (account deletion) |
| A124 | TAS-496 | To Do | no — no TAS-496 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (account deletion) |
| A125 | TAS-496 | To Do | no — no TAS-496 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (account deletion) |
| A126 | TAS-496 | To Do | no — no TAS-496 commit in a0499412 | **WAITING** | Story code not merged at a0499412. | — | out (account deletion, activity TAS-523/524) |
