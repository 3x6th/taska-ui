# The B2B target contract

`b2b-openapi.yaml` and `contracts.md` are vendored from the backend's
`docs/b2b/contracts/` — the analysis package TAS-268 finished on 2026-11-03. They
describe companies (tenants), memberships, invitations, per-tab tenant sessions,
billing and the GLOBAL_ADMIN surface **as the backend intends to build them**.
Pinned at develop `a0499412` (2026-11-18, re-pinned by TAS-537). At that commit
seven of its 86 operations are on the gateway and in its `openapi.yml`:
`listTenants`, `getTenant`, `renameTenant` (TAS-338, TAS-333), `pauseTenant`,
`resumeTenant`, `setPlatformBlock` (TAS-480) and `getTenantCapabilities`
(TAS-497). The rest is not.

They are here for the same reason `docs/contract/pending/` exists: the frontend
is asked to be ready before the backend, and a read-only reviewer can only audit
"this matches the target" against a version that is in the repository, pinned by
commit.

## What they are not

- **Not the gateway contract.** `docs/contract/openapi.yml` outranks them. When a
  route here arrives in the gateway contract, the gateway's version is the truth;
  a disagreement is this copy being out of date, not the gateway being wrong.
- **Not served, mostly.** On the stand every route here except the seven above
  is a 404 "No static resource", and those seven need the B2B session
  credentials (`WEB_GLOBAL` for the list, a `WEB_TENANT` bound to the company
  for the rest) that no REST route issues yet (TAS-536); a token from today's
  sign-in does not reach them. Work built against them runs on the mock behind a build flag, and
  each gap is an entry in `docs/ai/API-DIVERGENCE.md` naming the backend story
  that removes it.
- **Not frozen.** The backend edits these files as implementation PRs land
  (TAS-310 and TAS-311 both did, the day the package merged). `npm run
  contract:pins` reports when develop's copy has moved past the pin.

## How they are refreshed

Copy both files from the backend at the new develop commit, keep the header,
update its `Backend commit:` line, and re-read the stories written against the
old pin. `contracts.md` is the backend's `contracts/README.md` unchanged; its
relative links point into the backend repository.
