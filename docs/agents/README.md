# Agent docs: start here

Orientation for AI agents (and new humans) working in this repo, written 2026-10-12 against `main` @ `1c9eaf1`
by reading the code. These files describe **what the code really does**; the older Phase-1 docs
(`docs/state-machine.md`, `erd.md`, `architecture.md`) describe the original design, and parts of them are stale.

## Reading order

| # | File | Read it when |
| --- | --- | --- |
| 1 | [../../AGENTS.md](../../AGENTS.md) | always: the 14 rules |
| 2 | [../../CONTEXT.md](../../CONTEXT.md) | before any design or grilling work: glossary, entities, invariants (built vs documented) |
| 3 | [workflow-as-built.md](workflow-as-built.md) | before touching sessions, stock or cancellation: every endpoint, role and side effect |
| 4 | [hazards.md](hazards.md) | before changing code: 32 known gaps, each with a `file:line`, impact and fix direction |
| 5 | [codebase-map.md](codebase-map.md) | to find where something lives and what else to update |
| 6 | [recipes.md](recipes.md) | to run, test, migrate or ship |
| 7 | [grilling-backlog.md](grilling-backlog.md) | to start a `/grill-with-docs` session: the open decisions in priority order |
| 8 | [erp-integration.md](erp-integration.md) | before any work on ERP stock (warroom) or FMP staff login (OData, daily 10:00) |
| 9 | [warroom-products.md](warroom-products.md) | products and stock read from the warroom database: modes, rules, switching on |
| 10 | [meeting-feedback-2026-10-13.md](meeting-feedback-2026-10-13.md) | the 17 requests from the 2026-10-13 meeting (queue numbers, phone first, multiple products, receipt/QR, cancel/reject, A/B, U POS) with current behaviour, impact and open questions |
| — | [../adr/README.md](../adr/README.md) | when recording an architectural decision |

## Source of truth (when documents disagree)

1. **The code** and `apps/api/prisma/schema.prisma` (what actually runs).
2. `docs/decisions.md`: **newer D-numbers win** (D39–D51 are the current state; D1–D38 are the original answers).
3. `docs/permissions.md`, `docs/requirements.md`.
4. `docs/state-machine.md`, `docs/erd.md`, `docs/architecture.md`: Phase-1 design, partly outdated (hazards H-14).
5. `README.md`, `apps/web/README.md`: partly outdated.

If you find a disagreement that is not already in [hazards.md](hazards.md), add it there.

## Working agreement for a grilling or implementation session

1. `git fetch && git status -sb`; branch from `main`; never push to `main` (H-16).
2. Read CONTEXT.md + the relevant section of workflow-as-built.md. Use the vocabulary exactly.
3. Do not invent business rules (AGENTS rule 1). Ask, then record the answer as a `D##` and in CONTEXT.md.
4. Write a failing real integration test before changing workflow behaviour (H-15).
5. Run lint, build, `prisma validate` and test; report failures honestly (rule 14).
6. Update the docs you invalidated in the same PR (CONTEXT.md, workflow-as-built.md, hazards.md status).

## Keeping these files true

These are snapshots with `file:line` references. When you change code that one of them cites, fix
the citation or the statement in the same PR. Each file carries the commit it was verified against;
update that line when you re-verify.
