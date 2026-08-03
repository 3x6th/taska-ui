# Verification evidence

Screenshots and verification records for completed stories, one directory per
Jira key: `docs/ai/evidence/TAS-140/`.

## What to capture

Evidence is proportional to risk, not to effort. A CSS token rename does not
need six viewports; a change to the board's drag behaviour does.

For visual work:

- `<screen>-<width>x<height>-<theme>.jpg` — for example
  `board-1440x900-dark.jpg`
- the three reference viewports from `AGENTS.md`: 1440×900 desktop, 1280×800
  laptop, 390×844 phone portrait
- both themes wherever colour or contrast could differ

For behavioural work:

- the exact commands run and their output
- the changed files and commit SHAs
- the reviewer verdict

## What evidence does not prove

Record what the method could not see. A screenshot proves a layout rendered at
one width in one theme with one dataset; it does not prove the empty state, the
error state, the `VIEWER` variant, a long summary, a project with forty issues,
or anything at all about keyboard operation.

When a check was skipped, name it and say why. `lake-landing` shipped three
defects past a complete evidence matrix, and each was found by a human opening
the running site — a full matrix is a floor, not a ceiling.

## Naming and size

Keep captures under roughly 300KB each; JPEG at quality 80 is enough to audit
layout and contrast. This directory is committed, so it grows forever — prune
superseded captures when a story closes rather than accumulating every
intermediate state.
