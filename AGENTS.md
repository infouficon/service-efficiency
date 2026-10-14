# Service Efficiency System — Coding Rules

## Stack

- npm
- React + TypeScript + Vite
- NestJS + TypeScript
- Prisma
- MySQL
- Monorepo

## Rules

1. Do not invent business requirements.
2. Read docs/requirements.md before implementing business logic.
3. Read docs/decisions.md before making architecture decisions.
4. If a requirement is missing, add it to docs/open-questions.md.
5. Do not modify unrelated modules.
6. Do not change database schema without updating Prisma migration.
7. Server time is the source of truth for workflow timestamps.
8. Never trust client-provided actor/staff identity.
9. Use TypeScript strict mode.
10. Avoid `any`.
11. Validate input with DTOs.
12. Keep domain boundaries clear.
13. Run relevant tests/build after changes.
14. Do not claim completion if validation fails.

## Agent docs

Start at [docs/agents/README.md](docs/agents/README.md). Domain language and invariants are in
[CONTEXT.md](CONTEXT.md); keep it updated when a term or entity changes. Architectural decisions go in
[docs/adr/](docs/adr/README.md); business decisions go in `docs/decisions.md` (next free number: D74).

Source of truth when documents disagree: the code, then `docs/decisions.md` (newer D-numbers win),
then the rest of `docs/`. Known gaps are listed in [docs/agents/hazards.md](docs/agents/hazards.md); do not
"fix" one as a drive-by, because most need a business decision first.

Never push directly to `main`: a push deploys to production through Coolify.
