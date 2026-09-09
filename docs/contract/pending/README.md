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
  rewritten, or be closed. Both halves of that have now happened. `pr-118-TAS-125.yml`
  sat on a PR in `CHANGES_REQUESTED` for a missing access check; it merged on
  2026-09-09 — with the check added a level below the gateway rather than in it —
  and the file is gone, as this section's housekeeping requires. `pr-148-TAS-116.yml`
  had its head move the same day without a byte of its `openapi.yml` changing,
  which is the other lesson: a moved pin is not by itself a moved contract, and
  the way to tell is to diff the two heads rather than to re-extract on faith.
- **Not complete files.** Each is an extract: the paths and schemas that are new
  in that PR, or whose text differs from `develop`. Everything they `$ref` that
  they do not define is in the snapshot.

## How they are produced

Mechanically, by diffing the PR head's `api-gateway/src/main/resources/static/openapi.yml`
against `develop` block by block. Two things are deliberately not reported as
changes: a block whose only difference is whitespace, and a trailing comment
banner that belongs to the next section. A branch that is far behind `develop`
also shows unrelated endpoints as "removed" when they are only absent from a
stale base — `pr-118-TAS-125.yml` was restricted to the one route its PR actually
added for that reason, and said so in its own header. That extract first claimed
two, and the second was a route the branch had merely not caught up on being
renamed; the story is kept here now that the file is deleted, because a stale
branch producing a plausible-looking addition is the trap this whole directory
can walk into.

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
PR's file here, and go through `docs/ai/API-DIVERGENCE.md` — striking **only the
entries whose own `Removal:` or `Removed by` line names that merge**, and
re-reading the rest.

Both labels, because the file uses both — `Removal:` in the older field-per-line
entries and `Removed by` in the newer prose ones — and grepping for one of them
misses entries written in the other style. That is not hypothetical: the first
version of this paragraph named only `Removed by`, and the entry the merge
actually closes is a `Removal:` one.

The clause itself is not pedantry either. Writing against a pending contract
turns up two kinds of divergence and the merge closes only one of them. Backend
PR #146 is the worked example — four entries touch it, and they split two and
two:

- **Closed by the merge:** the undeployed-route compensation for the three
  admin writes, and `UserStatus` growing a fourth value.
- **Not closed by it:** a refusal the backend answers with `400` while its own
  test asserts `409`, which needs the backend to fix one or the other; and
  `GET /users/me` reporting `UNSPECIFIED` for a locked account, which needs a
  gateway change that is not in PR #146 at all.

A mechanical strike-on-merge would have deleted two true divergences and
orphaned the code compensating for them.

That is no longer hypothetical: PR #146 merged on 2026-09-07 and TAS-196 did the
housekeeping on 2026-09-08. The split held exactly as written — two entries
closed, two left open — and the pass turned up a third trap the paragraph above
does not cover. The closing entry's own `Removal:` line named two symbols to
delete along with it, and by the time it was followed **both had acquired a
second caller** (the attachment routes, TAS-190). Deleting on the note's
instruction would have removed a live compensation. A removal note names the
code to delete on the day the divergence is found; read the callers, not the
note.

When a PR closes without merging: delete the file and say so in the story that
was written against it.

| File | Backend PR | Story | Frontend story |
| --- | --- | --- | --- |
| `pr-148-TAS-116.yml` | [#148](https://github.com/VladislavYurin/taska-backend/pull/148) | TAS-116 | TAS-189 |
| `pr-147-TAS-131.yml` | [#147](https://github.com/VladislavYurin/taska-backend/pull/147) | TAS-131 | TAS-190 |

`pr-118-TAS-125.yml` was here for TAS-125 / TAS-191 and was deleted on 2026-09-09
when backend PR #118 merged and the snapshot was refreshed to develop
`5941499203ae`.

One open PR deliberately has no extract: backend
[#150](https://github.com/VladislavYurin/taska-backend/pull/150) (TAS-129, user
avatars) changes the contract and is open, but nothing in this repository is
written against it, and an extract nobody audits is a pin to keep current for
free. Write one the day a story here needs it.
