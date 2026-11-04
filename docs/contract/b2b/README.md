# The B2B target contract

`b2b-openapi.yaml` and `contracts.md` are vendored from the backend's
`docs/b2b/contracts/` — the analysis package TAS-268 finished on 2026-11-03. They
describe companies (tenants), memberships, invitations, per-tab tenant sessions,
billing and the GLOBAL_ADMIN surface **as the backend intends to build them**.
None of it is on the gateway yet.

They are here for the same reason `docs/contract/pending/` exists: the frontend
is asked to be ready before the backend, and a read-only reviewer can only audit
"this matches the target" against a version that is in the repository, pinned by
commit.

## What they are not

- **Not the gateway contract.** `docs/contract/openapi.yml` outranks them. When a
  route here arrives in the gateway contract, the gateway's version is the truth;
  a disagreement is this copy being out of date, not the gateway being wrong.
- **Not served.** On the stand every route here is a 404. Work built against
  them runs on the mock behind a build flag, and each gap is an entry in
  `docs/ai/API-DIVERGENCE.md` naming the backend story that removes it.
- **Not frozen.** The backend edits these files as implementation PRs land
  (TAS-310 and TAS-311 both did, the day the package merged). `npm run
  contract:pins` reports when develop's copy has moved past the pin.

## How they are refreshed

Copy both files from the backend at the new develop commit, keep the header,
update its `Backend commit:` line, and re-read the stories written against the
old pin. `contracts.md` is the backend's `contracts/README.md` unchanged; its
relative links point into the backend repository.
