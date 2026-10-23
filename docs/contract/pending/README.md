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
| `pr-155-TAS-145.yml` | [#155](https://github.com/VladislavYurin/taska-backend/pull/155) | TAS-145 | TAS-148 |
| `pr-219-TAS-388.yml` | [#219](https://github.com/VladislavYurin/taska-backend/pull/219) | TAS-388 | TAS-389 |

`pr-215-TAS-387.yml` was here for TAS-387 and was deleted on 2026-10-23, the same day
it was written, when backend PR #215 merged (`9a735db`) and the snapshot was refreshed to it.
The merge carried the extract's two hunks byte for byte; the only file whose change differs
from the reviewed head `34589adf` is `api-gateway/pom.xml`, the conflict with #212. What the
PR's Java says that the yml does not moved to `docs/ai/API-DIVERGENCE.md`.

`pr-118-TAS-125.yml` was here for TAS-125 / TAS-191 and was deleted on 2026-09-09
when backend PR #118 merged and the snapshot was refreshed to develop
`5941499203ae`.

`pr-148-TAS-116.yml` was here for TAS-116 / TAS-189 and was deleted on 2026-09-11
when backend PR #148 merged with its `openapi.yml` half restored and the snapshot
was refreshed to develop `21a0d9d177a1`. The merged declarations are the ones the
extract pinned at `79187f94d135`, checked by diffing the two snapshots rather than
by re-reading the PR — the lesson above, applied in the other direction.

`pr-150-TAS-129.yml` was here for TAS-129 / TAS-220 and was deleted on 2026-09-14
when backend PR #150 merged and the snapshot was refreshed to develop
`368ae77355bd`. The PR was one commit that never moved, so the merge brought in
exactly the head the extract pinned at `12e909d42dcc`, and the four avatar paths
and five schemas in the refreshed snapshot are byte-identical to that head's.
That was checked against the head rather than against the extract, and the
distinction earned its keep: the extract was not the mechanical copy its own
header claimed. It was missing fourteen `example` and `description` lines and the
`$ref` under `default:` on `GET /users/{userId}/avatar`. None of that is on the
wire, but an extract is worth only as much as its fidelity, so the other three
were measured the same day, block by block against their pinned heads.
`pr-147-TAS-131.yml` is complete. `pr-152-TAS-137.yml` and `pr-155-TAS-145.yml`
each leave out one operation on a path their PR extends: `POST` on
`/projects/{projectId}/members` and `GET` on `/projects/{projectId}`. Both are
already in the snapshot unchanged, so a reader who has the snapshot loses
nothing.

`pr-147-TAS-131.yml` (TAS-131 / TAS-190) and `pr-152-TAS-137.yml` (TAS-137 /
TAS-219) were deleted together on 2026-09-16, in TAS-224, when the snapshot was
refreshed to develop `1cfe4d79f074`. PR #147 merged on 2026-09-14 as a squash of
the head the extract pinned, `deeedbf3fff8`; PR #152 merged on 2026-09-16 as a
merge commit whose PR side is the pinned `7fa04ba94096`. Neither head moved after
it was pinned, and the check went one step further than the byte comparison
above: both YAML files were parsed and compared as data. Every path and schema
that differs between the old snapshot (`f16e77292cac`) and the new one is equal
to its counterpart at one of those two heads, and nothing else differs. That is
five attachment paths and six schemas from #147, and from #152 the members `GET`,
`ProjectResponseDto`, `AvatarDto`, `ProjectMemberDetailsDto` and
`ListProjectMemberDetailsDto`. Both were also measured deployed the same day
without a token: `GET …/members` and `GET …/attachments` answered 401, with
`GET /users/me` answering 401 as the control. Before the deploy they answered 405
and the static-resource 404.

`pr-193-TAS-223.yml` (TAS-223 / TAS-263), `pr-194-TAS-228.yml` (TAS-228 /
TAS-263) and `pr-195-TAS-200.yml` (TAS-200 / TAS-263) were deleted together on
2026-10-19, in TAS-263, when backend PRs #193, #194 and #195 merged as merge
commits `b88150f`, `95b1f35` and `447a7ed` and the snapshot was refreshed to
develop `7d4f7395565c`. Every block of the three extracts is byte-identical on
develop, checked block by block against the pinned heads `3bd33ca`, `a33ed5d`
and `45c22ee`. The refreshed snapshot also
gained `GET /api/v1/meta` and its six `MetaResponseDto` / `*MetaPairDto`
schemas from #196 (TAS-217), which no extract pinned and no screen calls yet.
Two of the three were measured deployed the same day with a token: `GET
/users/me` carries `avatar` and `avatarUnavailable`
(`0f9c038b-d0d5-458f-98b0-adb3af15d13f`), and the problematic summary carries
`retryable` on every event (`c28ef6d3-83df-48fb-a4af-821cdc731ea9`); #194 is
contract text only. Backend PR #172 closed unmerged and was replaced by #197
(TAS-160), so `pr-172-TAS-160.yml` now pins a closed PR and is left for the
next pass, which re-extracts #197, rather than deleted under the rule above.
`pr-155-TAS-145.yml` stays stale, as `docs/ai/BACKLOG.md` records.

`pr-172-TAS-160.yml` (TAS-160 / TAS-251) was deleted on 2026-10-19, in TAS-265.
#197 never needed an extract of its own: it and #198, #199 and #200 all merged
the same afternoon, before the next pass began, and the snapshot was refreshed to
develop `398285cde074` instead. All four PRs branched from `7d4f7395565c`, so
every path and schema that differs between the two snapshots must come from one
of their heads, and it does: 32 blocks, each byte-identical to its counterpart
at `3eafb22` (#197: `/readonly/audit-entries`, `ListAuditEntriesResponseDto`,
`AuditEntryDto`), `c99ff19` (#199: `RestErrorResponse`) or `7cdcf28` (#200:
`info`, seven paths, twenty schemas), and nothing else differs. #198 changes no
contract text. The four were measured deployed the same day with a token:
`/meta` lists twenty-three notification types and five user statuses
(`f2739711-8300-4418-938c-146716a67cf8`), the audit read answers 200 with an
`id` on every entry (`04613bb7-a862-4115-b0b7-0d8118f3bf9f`), and the error
envelope carries `details: null` (`fe5a4cc1-92cf-45a1-bc48-6fdcc4289d78`).

The snapshot was refreshed again on 2026-10-19, in TAS-297, to develop
`e8a8d316b326`, after backend PRs #204 (TAS-204, merge `0f7a937`), #201 (TAS-264,
merge `9aea7e3`), #202 (TAS-241, merge `a864b50`) and #203 (TAS-266, CI only)
merged that evening. No extract had been written for them: each merged before
a frontend pass began. The same check as above holds: 15 blocks differ from
`398285cde074`, each byte-identical to its counterpart at a merged head — 7 at
`a01e10d` (#204: `/auth/invitations`, `/users`, four new schemas and the accept
route's text), 7 at `9dc0a4a` (#201: the `/meta` pair schemas, `selectable`,
`linkViewTypes`), 1 at `cbdd726` (#202: the board's `includeDone` text) — and
nothing else differs.

`pr-208-TAS-381.yml` (TAS-381 / TAS-382) was deleted on 2026-10-22, in TAS-382,
when backend PR #208 merged as merge commit `594f637` and the snapshot was
refreshed to develop `594f63791565`. The PR's head never moved from the pinned
`9a04e99`, and develop's `openapi.yml` at the merge is byte-identical to that
head's: the old snapshot (`e8a8d316b326`) and the new one differ by exactly the
three workflow paths and seven schemas the extract pinned, plus the comment banner
the extract deliberately left out. #206 (TAS-300) and #207 (TAS-298), merged
minutes earlier, change no contract text.

