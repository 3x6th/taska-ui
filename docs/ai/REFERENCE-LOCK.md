# Taska reference lock

This document constrains how external design references may influence Taska UI.
It exists because `art-director` can reach the Refero MCP
(`api.refero.design`), a searchable library of real product interfaces, and an
unbounded reference library is the most reliable way to dissolve a locked
design system one screenshot at a time.

It is a constraint, not a moodboard.

## The system is already locked

`DESIGN.md` is the system. `design_handoff_taska/Taska.dc.html` is the hi-fi
prototype it was derived from — every colour, type step, spacing value, radius,
and animation in it is final and was signed off at handoff.

References rank **below both**, and below the Jira story. A reference may
sharpen a critique. It may never introduce a token, a component pattern, or a
layout that contradicts `DESIGN.md` §2.

## Permitted use

- Calibrating whether a state is weak: "this empty column is doing less work
  than the category norm" is a legitimate finding.
- Checking whether an interaction has a well-established convention the design
  misses — keyboard shortcuts, bulk selection, filter persistence.
- Density comparisons: whether 13px base and 312px columns read as comfortable
  or cramped against comparable trackers.
- Resolving a genuine gap where `DESIGN.md` is silent, as a proposal to add to
  `DESIGN.md` — never as an unrecorded implementation decision.

## Prohibited use

- Importing a colour, shadow, radius, or type scale from a reference.
- Restyling an existing component to look more like a reference screenshot.
- Introducing a pattern `DESIGN.md` §1 rules out: decorative illustration,
  emoji, gradient fills, heavy card shadows, more than one accent per screen.
- Justifying a change by reference alone. The argument has to stand on the
  user's task; the reference is at most corroboration.

## Comparison set

**Accepted:** Linear-class issue trackers — quiet chrome, keyboard-first,
meaning-bearing colour, compact controls with generous outer spacing. This is
the family `DESIGN.md` §1 already describes.

**Rejected:**

- *Marketing-site chrome.* Hero type, animated gradients, and scroll
  choreography belong to a landing page. Taska is a tool people keep open all
  day.
- *Dense enterprise-Jira patterns.* Nested toolbars, tabbed panels, and
  eight-level information hierarchies are exactly the clutter the product
  positions against.
- *Decorative illustration and spot art.* `DESIGN.md` §1 rule 5 allows one
  gradient in the entire product: the login radial glow.
- *Terminal and dashboard cosplay.* Monospace is for `issueKey` and tokens, not
  atmosphere.

## Acceptance test

If a change can only be justified by pointing at another product, it is not
justified. If a reviewer cannot name which `DESIGN.md` section a reference-led
change serves, the change does not ship.

## Recording

When a reference does change a decision, record it in the review verdict with
the source and what specifically it changed. A reference that influenced the
product without leaving a trace is indistinguishable from drift.
