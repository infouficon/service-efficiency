# Recipes: commands and rules for working in this repo

Verified against `package.json`, `README.md`, `compose.dev.yml` and the Dockerfiles at `1c9eaf1`.

## 1. Before you edit

```sh
git fetch && git status -sb        # fast-forward if behind: git pull --ff-only
```

- The default branch is `main`, and **a push to `main` deploys to production** (H-16). Work on a branch, open a PR, and never push straight to `main`.
- Read the files named in AGENTS.md rules 2–3 first: `docs/requirements.md`, `docs/decisions.md`. Then read [CONTEXT.md](../../CONTEXT.md) and [hazards.md](hazards.md).
- If a business rule is missing, **do not invent it**. Add an `OQ-xx` entry to `docs/open-questions.md` (rule 4) and ask the user.

## 2. Local environment (first time)

```sh
npm install
cp .env.example .env.mysql                        # set two DIFFERENT random passwords
cp apps/api/.env.example apps/api/.env.development
```

`apps/api/.env.example` ships an active `DATABASE_URL` for a `booking` DB on port 3306 (H-14). **Replace it** with the commented 3307 line:
`mysql://service_efficiency:<MYSQL_PASSWORD>@127.0.0.1:3307/service_efficiency` (URL-encode special characters).

```sh
docker compose --env-file .env.mysql -f compose.dev.yml -p service-efficiency-dev up -d   # wait until healthy
npx prisma generate
npx prisma migrate deploy
npm run build:api                                  # bootstrap.mjs imports dist/, so build first
BOOTSTRAP_STAFF_ID=0001 BOOTSTRAP_PASSWORD='<temp, ≥8 chars>' npm run db:bootstrap --workspace=@service-efficiency/api
npm run dev:api        # terminal 1, http://127.0.0.1:3001
npm run dev            # terminal 2, http://localhost:5173 (Vite proxies /api)
```

Bootstrap only works on an **empty** Staff table; the first login forces a password change. No
branch or staff is seeded: create them in the Admin UI. The catalog **is** auto-seeded on API start
when `Product` is empty (H-17).

## 3. Validation (rule 13: run before saying "done")

```sh
npm run lint
npm run format:check
npm run build              # web (tsc --noEmit + vite build) then api (nest build)
npx prisma validate
npm run test               # builds api, then API integration tests, then web unit tests
```

- API tests need the isolated DB **`service_efficiency_test`** and `apps/api/.env.test`; they refuse any other DB name. Setup is in README §Validation:
  ```sh
  docker compose --env-file .env.mysql -f compose.dev.yml -p service-efficiency-dev exec -T mysql sh -c \
   'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "CREATE DATABASE IF NOT EXISTS service_efficiency_test; GRANT ALL ON service_efficiency_test.* TO service_efficiency;"'
  cp apps/api/.env.development apps/api/.env.test      # then change ONLY the DB name to service_efficiency_test
  node --env-file=apps/api/.env.test node_modules/prisma/build/index.js migrate deploy
  ```
- Web only: `npm run test --workspace=@service-efficiency/web`.
- Never point the tests, or a destructive script, at the dev or production database.
- Only `accounts.test.mjs` is a real integration test. For workflow changes, **add a real test first** (H-15).
- Don't claim completion if any command above fails (rule 14). Say which one failed and show its output.

## 4. Schema changes (rule 6)

1. Edit `apps/api/prisma/schema.prisma`.
2. Create a migration with Prisma against the **dev** DB: `npx prisma migrate dev --name <yyyymmddnnnn_snake_name>`. Existing names look like `202610090002_add_accessories_category`. Commit the generated SQL.
3. Keep migrations **additive and backwards-compatible with the previous release**. Production runs `prisma migrate deploy` in the container entrypoint under `set -e` *before* the server starts, so a failing migration takes the API down (H-16). Apply a risky migration separately and in advance.
4. Update `docs/erd.md` or CONTEXT.md and add a decision entry.
5. Update the API DTO, the web mapper (`mapApiSessionToMockSession`) and `types/session.ts`.

## 5. Adding or changing a decision (the docs workflow)

- Business decisions go in `docs/decisions.md` as the next `D##` (last is **D51**). Use the format of D40–D51: title, date, numbered bullets.
- Architecture-level or hard-to-reverse choices (a locking strategy, how to model stock movement) also get an ADR: see [docs/adr/README.md](../adr/README.md).
- New vocabulary or a changed entity: edit [CONTEXT.md](../../CONTEXT.md) in the same change.
- A newly found risk: add an `H-##` entry to [hazards.md](hazards.md). When fixed, mark it `fixed in <sha>/PR#`, never delete it.

## 6. Shipping

1. Branch: `git switch -c <type>/<short-name>` (commit types seen in the log: `feat`, `fix`, `refactor`, `style`, `docs`, `build`).
2. Commit with a Conventional-Commit style subject, for example `fix(session): …`.
3. Open a PR. Coolify rebuilds `web` and `api` after the merge to `main`.
4. After deploy, verify on `https://ses.uficon.com`: `/healthz` (web), `/health` (api), and a real login (a bad-password login should return **401**, not 403).
5. Production env for the API is in Coolify. A new Web domain needs `CORS_ORIGINS` updated and the API **restarted**; otherwise logins fail with 403 `Invalid request origin` (docs/coolify-deployment.md).

## 6b. Running the API tests without Docker (macOS, Homebrew MariaDB)

Docker is not required; any throwaway MySQL-compatible server on an unused port works (CI/prod are MySQL 8.4; MariaDB returns JSON columns as text, handled in `toDto`):
```sh
mariadb-install-db --no-defaults --datadir=/tmp/ses-mariadb/data --auth-root-authentication-method=normal
mariadbd --no-defaults --datadir=/tmp/ses-mariadb/data --port=3399 --bind-address=127.0.0.1 --socket=/tmp/ses-mariadb/sock &
mariadb --no-defaults -uroot --socket=/tmp/ses-mariadb/sock -e "CREATE DATABASE service_efficiency_test; CREATE USER 'ses_test'@'127.0.0.1' IDENTIFIED BY '<local only>'; GRANT ALL ON service_efficiency_test.* TO 'ses_test'@'127.0.0.1';"
# apps/api/.env.test (git-ignored): DATABASE_URL=mysql://ses_test:<pw>@127.0.0.1:3399/service_efficiency_test and CORS_ORIGINS=http://localhost:5173,http://localhost:5174
DATABASE_URL=<same url> npx prisma migrate deploy && npm run build:api && (cd apps/api && node --test tests/erp-sync.test.mjs)
```
`erp-sync.test.mjs` needs no ERP: it starts a fake OData server. **Never point the tests (or a dry run) at a database that holds real data.**

## 6c. ERP import: first run on an environment
1. Set `ERP_ODATA_BASE_URL`, `ERP_ODATA_USER`, `ERP_ODATA_PASS` (Coolify env of the `api` app) and restart.
2. Admin → "ซิงก์ ERP" → **ทดลองรัน**; read created/skipped counts; only then "ซิงก์ตอนนี้". Do it outside shop peak hours and only when the ERP answers normally (H-29).
3. The scheduled run is 10:00 Bangkok (`ERP_SYNC_TIMES`). Roles come from `POSITION_ROLE_RULES` in `erp-sync.service.ts` (provisional, D54).

## 7. Gotchas

- `Prisma Json?` columns: use `Prisma.DbNull` to clear (H-08); use `Prisma.DbNull` (not `null`) in `where` filters.
- Branch parameters accept the **UUID or the Branch Code**. Don't assume which one the web sends: `MockUser.branchCode` may hold a UUID (see the frontend notes in hazards.md).
- `GET /sessions` returns everything (H-06): don't build a feature that depends on it staying small.
- The web client polls every 4 s, so each extra field in the session payload costs bandwidth on all open tabs.
- All user-facing text is Thai. Keep Thai strings exactly as in `constants/options.ts` and the docs: they are compared as values (`'อื่น ๆ'`).
- Not in git: `.env*` files (git-ignored), `node_modules`, `dist`.
