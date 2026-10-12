# Codebase map

A file-level map for agents (`main` @ `1c9eaf1`, 2026-10-12). Line numbers drift, so search by
symbol name if a line has moved. Vocabulary: [CONTEXT.md](../../CONTEXT.md). Endpoint semantics:
[workflow-as-built.md](workflow-as-built.md).

## 1. Shape

```text
service-efficiency/                 npm workspaces monorepo (Node ≥22.12, npm ≥10)
├── AGENTS.md / CLAUDE.md           agent rules + entry point (CLAUDE.md imports AGENTS.md)
├── CONTEXT.md                      domain glossary + model (grill-with-docs writes here)
├── package.json                    root scripts: dev, dev:api, build, test, lint, prisma:*
├── prisma.config.ts                Prisma CLI → apps/api/prisma/schema.prisma; loads apps/api/.env.development
├── compose.dev.yml                 dev MySQL 8.4 on 127.0.0.1:3307 (project name service-efficiency-dev)
├── tsconfig.base.json              strict: true (no noUnusedLocals, so dead code is not caught)
├── eslint.config.mjs, .prettierrc.json
├── apps/api/                       NestJS 11 + Prisma 6.19 + MySQL      → §2
├── apps/web/                       React 19 + Vite 7, no router lib, lucide-react icons → §3
├── packages/shared/src/index.ts    EMPTY (`export {}`), imported by nothing (H-11)
└── docs/                           requirements, decisions D1–D51, OQs, Phase-1 design, guides
    └── agents/                     agent-facing docs (this folder)
```

## 2. Backend: `apps/api`

| File | Lines | Role |
| --- | --- | --- |
| `src/main.ts` | 19 | listen on `HOST:PORT` (default 0.0.0.0:3001) |
| `src/bootstrap.ts` | 26 | global prefix `/api` (except `/health`), helmet, CORS from `CORS_ORIGINS` with credentials, global `ValidationPipe({whitelist, forbidNonWhitelisted, transform})` |
| `src/app.module.ts` | 25 | Accounts + Products + Sessions modules; ConfigModule loads `.env.development` then `.env` (prod: `.env` only) |
| `src/config/environment.ts` | 41 | validates PORT, the DATABASE_URL (`mysql:` scheme) and each CORS origin |
| `src/health.controller.ts` | 9 | `GET /health` liveness only (no DB check) |
| `src/prisma/*` | 24 | `PrismaService` (connect on init) |
| `src/accounts/accounts.controller.ts` | 160 | `OriginGuard` (the only CSRF guard, H-03) + auth/staff/branch/audit routes; cookie `se_session` |
| `src/accounts/accounts.service.ts` | 519 | `authenticate()` (used by **every** controller), `transaction()` with the AccountLock mutex (H-02), login/lockout, staff/branch management + D39 guards, `getAuditLogs()` |
| `src/accounts/password.ts` | 29 | scrypt hash/verify, SHA-256 token hash, `IDLE_MS` 8 h, `LOCK_MS` 15 min |
| `src/accounts/dto.ts` | 55 | Login/ChangePassword/Reset/Staff/Branch DTOs |
| `src/sessions/sessions.controller.ts` | 135 | 12 Customer Session routes, thin: authenticate → service |
| `src/sessions/sessions.service.ts` | 1231 | **the workflow engine**: `STEPS` table (:22), role/branch checks (:113-125), every action (see workflow-as-built.md) |
| `src/sessions/dto.ts` | 166 | `STEP_ACTIONS`, action DTOs (free-string option values, H-11) |
| `src/erp/erp-sync.service.ts` | ~600 | **ERP import** (D53/D54): OData client (quoted `%20` names, no `$filter`, a timeout is final), pure parsers (`parseBranches`, `parsePeople`, `rolesForPosition` = the provisional role table), plan + apply inside the `AccountLock` transaction (dry run = throw inside the callback to roll back), 30 s tick with DB slot claim (`claim`), run log |
| `src/erp/erp.controller.ts`, `erp.module.ts` | 45 | `GET /admin/erp-sync/status`, `POST /admin/erp-sync/run` (ADMIN, `OriginGuard`) |
| `src/products/products.controller.ts` | 182 | catalog + branch inventory routes; `assertAdmin` / `assertManagerOrAdmin` |
| `src/products/products.service.ts` | 531 | boot seed + inventory sync (H-17), branch-filtered catalog, cascade deactivation (D42) |
| `src/products/dto.ts` | 118 | catalog DTOs |
| `prisma/schema.prisma` | 291 | 18 models / 5 enums (see CONTEXT §3) |
| `prisma/migrations/` | — | `2026092800{01..05}` accounts → stock review, `2026100900{01,02}` branch inventory, Accessories category |
| `scripts/bootstrap.mjs` | 52 | creates the first ADMIN only when Staff is empty; imports `../dist/accounts/password.js`, so **build the API first** |
| `docker-entrypoint.sh` | — | `set -e`; `prisma migrate deploy`; optional bootstrap; `exec node apps/api/dist/main.js` (H-16) |
| `tests/accounts.test.mjs` | 519 | **real** HTTP + MySQL integration test (needs the `service_efficiency_test` DB) |
| `tests/erp-sync.test.mjs` | ~450 | 5 pure tests + a real-MySQL test against a **fake ERP** (node `http`): plan/apply, passwords, leavers, closed branch, adoption, ERP down/401, mass guard, async run, slot claim |
| `tests/sessions.test.mjs` | 144 | constant-only assertions; does not exercise the API (H-15) |

**Patterns to follow (and their limits):**
- Controllers stay thin: `const user = await this.accounts.authenticate(req)`, then call the service. Authorization lives in the service (sessions) or in controller helpers (products).
- Each workflow action is one `prisma.$transaction` that updates state and timestamp and nests `events: { create }`. Keep that, but **recheck state inside the transaction** (H-01).
- Errors: Nest `BadRequestException` / `ForbiddenException` / `NotFoundException`. Messages are English in sessions and Thai in products and accounts. The web client shows `message` verbatim.
- No repository layer and no CQRS (architecture.md forbids them). Keep logic in the owning service (repo cohesion rule).

## 3. Frontend: `apps/web/src`

### 3.1 Boot, routing and polling
- `main.tsx` → `ToastProvider` → `AuthGate` (`features/auth/AuthGate.tsx`): `/auth/me`, then `pages/Login.tsx`, then `PasswordChange` if `mustChangePassword`, then `App`.
- `app/App.tsx` (666 lines) is the shell. It uses **hash routing** with `#/<view>` and a `view` state, and has no router library (`parseHashView` :31-45, `hashchange` :98-115). The products and admin sub-views are state only, so a refresh loses them.
- **Polling:** `GET /sessions` every **4 s** (:118-160). For unconfirmed sessions the merge keeps the *local* `phone` and `selection` over the server copy (:131-145).
- Default view: ADMIN/MANAGER → logs, else STAFF → staff, STOCK → stock, CASHIER → cashier.

| `#/view` | Component | Visible to (UI) |
| --- | --- | --- |
| `staff` | `features/session/StaffWorkspace.tsx` (976) | STAFF |
| `stock` | `features/stock/StockWorkspace.tsx` (815) | STOCK |
| `cashier` | `features/cashier/CashierWorkspace.tsx` (525) | CASHIER |
| `logs` | `features/logs/SessionLogsWorkspace.tsx` (1644); deep link `#/logs?ref=SES-…` | everyone |
| `products` | `features/products/ProductWorkspace.tsx` (1298), sub-views MAIN/STOCK | ADMIN, MANAGER |
| `admin` | `features/admin/AdminHub.tsx` (605) + `SystemAuditLogs.tsx` (491) | ADMIN, MANAGER (branches and audit: ADMIN) |

The UI does **not** give ADMIN the workspace views unless ADMIN also holds that role, while the API
lets ADMIN pass every role check. Keep this in mind when testing with an ADMIN-only account.

### 3.2 Data access
- `services/api.ts` (43 lines): `api(path, method, body)` → `fetch('/api'+path)`, `credentials:'include'`, always sends `X-Requested-With: ServiceEfficiency`. A 401 dispatches the `auth-expired` window event. Error text comes from `data.message`.
- `services/sessionApi.ts` (303 lines): one function per session endpoint. Every response goes through `mapApiSessionToMockSession` (:76-157), which converts the API shape (camelCase `*At`) to the UI's `MockSession` (snake_case `timestamps`). **Read this mapper before you change any API response shape.**
- `recordOutOfStockApi` is never called. The UI uses only the D40 report-missing path (relevant to H-09).
- Dev: Vite proxy `/api` → `127.0.0.1:3001`. Prod: nginx `apps/web/nginx.conf.template`, `location /api/` → `API_URL`.

### 3.3 Feature folders
- **session/**: `StaffWorkspace` (walk-in → DEMO → BUY/NOT_BUY → phone autosave at 10 digits → `SelectionEditor` → review → confirm; stock-review banner with 3 choices), `SelectionEditor` (flattens `/products`, hides inactive SKUs and `branchActive=false`, disables stock ≤ 0; falls back to `mocks/data.ts` products if the API fails), `ReasonForm`, `Summary`, `workflow.ts` (a client-side state machine, "mock presentation only", plus validators, `isToday`, `getSessionMissingDescription`).
- **stock/**: today's queue (STOCK_REQUESTED/SEARCHING/FOUND). The user ticks the found items; "FOUND" appears only when every item is ticked, otherwise "report missing" sends strings like `"Case (x2)"`. Cancel alerts are dismissed in **localStorage** only.
- **cashier/**: today's queue (SENT_TO_CASHIER → BILL_OPENED), 4-step stepper.
- **logs/**: history table built from App's polled `sessions` (no fetch of its own); search, date and branch filters, paging 15/25/50, event timeline, CSV export (ADMIN/MANAGER, UTF-8 BOM).
- **products/**: catalog CRUD, branch stock breakdown modal with the unsaved-changes guard and Save-all (D44).
- **admin/**: users and branches with the D39 rules mirrored in the UI; audit log viewer (300 rows, filtered in the client).
- Shared: `components/ui.tsx` (Modal, Button, Panel, MultiSelect, Notice), `components/Toast.tsx` (`useToast`), `constants/options.ts` (**the fixed business option lists**), `types/session.ts` (hand-copied enums, `MockSession`), `types/accounts.ts`.
- `app/styles.css` (3007 lines): global kebab-case classes, `:root` tokens (`--primary #0abab5`), sticky `th` (D49/D50), IBM Plex Sans Thai loaded from Google Fonts.
- Empty placeholder folders (only `.gitkeep`): `hooks/`, `layouts/`, `permissions/`, `utils/`.

## 4. Where do I change…?

| Task | Backend | Frontend | Also update |
| --- | --- | --- | --- |
| A workflow step (new or changed) | `STEPS` + `STEP_ACTIONS` (`sessions.service.ts`, `sessions/dto.ts`); `EventType`/`WorkflowState` enums + a migration | `sessionApi.ts` (call + mapper), the workspace for that role, `types/session.ts`, `workflow.ts`, badge filters in `App.tsx` | CONTEXT §3–4, workflow-as-built, a decision entry, logs/CSV columns |
| A selection field | `UpdateSelectionDto`, `updateSelection`, schema + migration | `SelectionEditor`, `Summary`, mapper | CONTEXT glossary, ERD |
| A fixed option list | (today: none; see H-11) | `constants/options.ts` | requirements/ERD option table |
| A permission | `checkRole`/`checkBranchAccess`, cancel table, products `assert*` | `App.tsx` view guards, buttons in the workspace | permissions.md, a decision entry |
| Stock and inventory rules | `products.service.ts`, inventory side effects in `sessions.service.ts` | `ProductWorkspace`, `SelectionEditor`, `StockWorkspace` | D41/D42 follow-up decision |
| Account rules | `accounts.service.ts` (inside `transaction()`) | `AdminHub`, `AuthGate` | `accounts.test.mjs` (real test, keep it green) |
| Reports/export | — (no endpoint; export is client-side CSV) | `SessionLogsWorkspace` `ExportModal` | OQ-11 must be answered first |

## 5. Size hotspots (read in slices, don't rewrite wholesale)

`styles.css` 3007 · `SessionLogsWorkspace.tsx` 1644 · `ProductWorkspace.tsx` 1298 ·
`sessions.service.ts` 1231 · `StaffWorkspace.tsx` 976 · `StockWorkspace.tsx` 815 ·
`App.tsx` 666 · `AdminHub.tsx` 605 · `products.service.ts` 531 · `CashierWorkspace.tsx` 525 ·
`accounts.service.ts` 519.
