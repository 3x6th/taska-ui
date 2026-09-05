# Contracts that are not the contract yet

`docs/contract/openapi.yml` is the vendored gateway contract: what the backend's
`develop` says today. This directory holds one file per **open** backend pull
request that changes that contract — what it *will* say if that PR merges as it
stands.

They exist for one reason. This frontend is asked to be ready on the day a
backend PR merges, which means writing against a contract that has not landed.
`api-contract-guard` and `release-reviewer` are read-only and work without
network access, so a claim like "this matches TAS-131" is unauditable unless the
version it was written against is in the repository. These files are that
version, pinned by head commit.

## What they are not

- **Not authority.** The authority order in `AGENTS.md` is unchanged:
  `docs/contract/openapi.yml` outranks these, and the backend repository
  outranks it. A pending file losing an argument with the snapshot is the
  pending file being wrong.
- **Not a promise.** Every one of these is on a PR that can still change, be
  rewritten, or be closed. `pr-118-TAS-125.yml` is on a PR in
  `CHANGES_REQUESTED` for a missing access check, so its shape is the least
  settled of the four.
- **Not complete files.** Each is an extract: the paths and schemas that are new
  in that PR, or whose text differs from `develop`. Everything they `$ref` that
  they do not define is in the snapshot.

## How they are produced

Mechanically, by diffing the PR head's `api-gateway/src/main/resources/static/openapi.yml`
against `develop` block by block. Two things are deliberately not reported as
changes: a block whose only difference is whitespace, and a trailing comment
banner that belongs to the next section. A branch that is far behind `develop`
also shows unrelated endpoints as "removed" when they are only absent from a
stale base — `pr-118-TAS-125.yml` is restricted to the two routes its PR
actually adds for that reason, and says so in its own header.

The extract is a reading aid, not a source. Where an extract and the PR disagree,
the PR wins; where the PR's `openapi.yml` and the PR's Java disagree, the Java
wins, because that is what goes on the wire. Both of those have already happened
on this set, and both are recorded in `docs/ai/API-DIVERGENCE.md`.

## Keeping the pins honest

A pull-request head moves on every force-push and `develop` moves on every merge.
When either happens, a file here quietly starts describing a commit nobody can
see any more — while reading exactly as authoritative as it did the day it was
written. `npm run contract:pins` is what makes that loud: it re-reads every
header, asks GitHub for the live head of each pinned PR and for `develop`, and
fails on a mismatch, on a PR that has merged or closed, and on a header it
cannot parse.

It is **not** part of `npm run check`, on purpose. The gate has to run offline
and has to be deterministic, and this needs the network and an authenticated
`gh`; worse, its answer changes when the *backend* changes rather than when this
repository does, and a gate that goes red because someone else pushed is a gate
people learn to ignore. Run it when refreshing a pin, before writing a story
against one, and before merging work that was written against one.

## Housekeeping

When a PR merges: refresh `docs/contract/openapi.yml` from `develop`, delete that
PR's file here, and strike the matching lines from `docs/ai/API-DIVERGENCE.md`.
When a PR closes without merging: delete the file and say so in the story that
was written against it.

| File | Backend PR | Story | Frontend story |
| --- | --- | --- | --- |
| `pr-146-TAS-108.yml` | [#146](https://github.com/VladislavYurin/taska-backend/pull/146) | TAS-107, TAS-108 | TAS-188 |
| `pr-148-TAS-116.yml` | [#148](https://github.com/VladislavYurin/taska-backend/pull/148) | TAS-116 | TAS-189 |
| `pr-147-TAS-131.yml` | [#147](https://github.com/VladislavYurin/taska-backend/pull/147) | TAS-131 | TAS-190 |
| `pr-118-TAS-125.yml` | [#118](https://github.com/VladislavYurin/taska-backend/pull/118) | TAS-125 | TAS-191 |
