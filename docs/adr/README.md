# Architecture Decision Records (ADRs)

This folder holds **architecture-level** decisions: choices that are costly to reverse or that shape
how the code is built (locking strategy, how stock movement is modelled, how scoping is enforced).
It is where `/grill-with-docs` writes its ADRs.

## How this relates to `docs/decisions.md`

| | `docs/decisions.md` | `docs/adr/` |
| --- | --- | --- |
| Content | **Business** decisions confirmed by the owner (D1–D65): rules, permissions, UI behaviour | **Technical** decisions with alternatives and consequences |
| Id | `D##` | `NNNN-kebab-title.md` |
| Written by | agent, after the owner confirms | agent, after a grilling or design session |

A technical decision that implements a business one links to it (`Implements D41`). If an ADR
changes a business rule, the rule also gets a `D##` entry. Domain words belong in
[CONTEXT.md](../../CONTEXT.md), not here.

## Rules
- One decision per file. Numbering is sequential; never renumber. The first real ADR is `0001`.
- Status is one of `proposed`, `accepted`, `superseded by NNNN`. To change a decision, write a new ADR and mark the old one superseded. Don't edit history.
- Keep it short (about one page): context, decision, alternatives considered, consequences.
- Link the hazards (`H-##`) and open questions (`OQ-##`) it resolves.

## Template

Copy [0000-template.md](0000-template.md).

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-atomic-daily-counters-for-queue-numbers.md) | Allocate queue numbers and references with an atomic counter row | accepted |
