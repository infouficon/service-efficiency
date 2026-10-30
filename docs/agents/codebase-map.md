# Codebase map

A file-level map for agents (`main` @ `ecd82e0` plus the D56/D57 change, 2026-10-13). Line numbers drift, so search by
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
└── docs/                           requirements, decisions D1–D60, OQs, Phase-1 design, guides
    └── agents/                     agent-facing docs (this folder)
```

## 2. Backend: `apps/api`

| File | Lines | Role |
| --- | --- | --- |
| `src/main.ts` | 19 | listen on `HOST:PORT` (default 0.0.0.0:3001) |
| `src/bootstrap.ts` | 26 | global prefix `/api` (except `/health`), helmet, CORS from `CORS_ORIGINS` with credentials, global `ValidationPipe({whitelist, forbidNonWhitelisted, transform})` |
| `src/app.module.ts` | 30 | Accounts, Erp, Warroom, Products, Queue, Settings, Sessions modules; ConfigModule loads `.env.development` then `.env` (prod: `.env` only) |
| `src/config/environment.ts` | 41 | validates PORT, the DATABASE_URL (`mysql:` scheme) and each CORS origin |
| `src/health.controller.ts` | 9 | `GET /health` liveness only (no DB check) |
| `src/prisma/*` | 24 | `PrismaService` (connect on init) |
| `src/accounts/accounts.controller.ts` | 160 | `OriginGuard` (the only CSRF guard, H-03) + auth/staff/branch/audit routes; cookie `se_session` |
| `src/accounts/accounts.service.ts` | 569 | `authenticate()` (used by **every** controller), `transaction()` with the AccountLock mutex (H-02), login/lockout, staff/branch management + D39 guards, `getAuditLogs()` |
| `src/accounts/password.ts` | 29 | scrypt hash/verify, SHA-256 token hash, `IDLE_MS` 8 h, `LOCK_MS` 15 min |
| `src/accounts/dto.ts` | 55 | Login/ChangePassword/Reset/Staff/Branch DTOs |
| `src/sessions/sessions.controller.ts` | 135 | 12 Customer Session routes, thin: authenticate → service |
| `src/sessions/sessions.service.ts` | 1090 | **the workflow engine**: the `STEPS` table, `sessionInclude` (the one response shape), role/branch checks, every action (see workflow-as-built.md). `createWalkIn` takes the phone, the customer type, the queue number and the reference in one READ COMMITTED transaction; the stock side effects live in `takeItemsFromShelf` / `returnItemsToShelf` / `zeroShelf` and the per-item `legacyMissingItems` (D61) |
| `src/queue/queue.service.ts`, `queue.controller.ts`, `dto.ts`, `queue.module.ts` | 270 | **customer types and queue numbers** (D57): `bangkokDay`, `formatQueue`, `QueueService.nextNumber` (atomic `DailyCounter`, ADR 0001) / `allocate` / type CRUD; `GET/POST/PUT /customer-types` (ADMIN writes, `OriginGuard`) |
| `src/pos/pos.controller.ts`, `dto.ts`, `pos.module.ts` | 130 | **the U POS door** (D60, F17): `PosKeyGuard` (bearer `POS_API_KEY`, constant-time, 404 when unset), `GET /integrations/pos/orders`, `POST /integrations/pos/bills`; the logic is `SessionsService.posOrders` / `recordPosBill` (the workflow engine owns the transitions) |
| `src/payments/payments.service.ts`, `payments.controller.ts`, `dto.ts`, `payments.module.ts` | 190 | **payment methods** (F6, D66): list / add / switch on-off / move, ADMIN writes (`OriginGuard`); names are history, never renamed; `fmpType` (D89) files a method under an FMP payment type |
| `src/settings/settings.service.ts`, `settings.controller.ts`, `dto.ts`, `settings.module.ts` | 110 | **global ADMIN switches** (D59): `stockUnlimited` (no row = on); `GET /settings` (everyone), `PUT /settings` (ADMIN, `OriginGuard`); `SettingsService.stockUnlimited(tx?)` is read by `ProductsService.findByBranch` and by the stock side effects in `SessionsService` (`takeFromShelf`, `unitsTakenAtFound`) |
| `src/sessions/dto.ts` | 180 | `STEP_ACTIONS`, action DTOs (free-string option values, H-11); `CreateSessionDto` requires `phone` (D56) |
| `src/erp/erp-sync.service.ts` | ~600 | **ERP import** (D53/D54): OData client (quoted `%20` names, no `$filter`, a timeout is final), pure parsers (`parseBranches`, `parsePeople`, `rolesForPosition` = the provisional role table), plan + apply inside the `AccountLock` transaction (dry run = throw inside the callback to roll back), 30 s tick with DB slot claim (`claim`), run log |
| `src/warroom/warroom-sync.service.ts` | ~600 | **products/stock from the warroom DB** (D52/D55): read-only `pg` reader of `mart.stock_mv`, pure rules (`mapCategory`, `buildCatalog`, `shortName`, `parseMode`), catalog create/update (mode `on`), bulk `INSERT … ON DUPLICATE KEY` of `erpReady/erpTransfer/erpAsOf`, zeroing, guards (empty / older / lost half), 60 s tick per snapshot (`claim` kind `warroom-products`) |
| `src/warroom/warroom.controller.ts`, `warroom.module.ts` | 80 | `GET /admin/warroom-sync/status`, `POST /admin/warroom-sync/run`, `POST /admin/warroom-sync/reset-catalog` (`?dryRun=true` counts; a real run needs `{confirm: "ล้างข้อมูล"}`, D73) (ADMIN, `OriginGuard`) |
| `src/erp/erp.controller.ts`, `erp.module.ts` | 45 | `GET /admin/erp-sync/status`, `POST /admin/erp-sync/run` (ADMIN, `OriginGuard`) |
| `src/products/products.controller.ts` | 182 | catalog + branch inventory routes; `assertAdmin` / `assertManagerOrAdmin` |
| `src/sms/sms.service.ts`, `sms-webhook.controller.ts`, `sms.module.ts` | 190 | **ThaiBulkSMS** (D85): `SmsService.send` (API v2, Basic auth, form body), `normalizeThaiMobile`, and the public delivery webhook `/api/webhooks/thaibulksms/:token` |
| `src/fmp/fmp.service.ts`, `fmp.controller.ts`, `fmp.module.ts`; `src/sessions/order-view.ts` | 420 | **orders to FileMaker** (D88): transactional outbox `FmpOutbox`, worker with retries, Data API login/create/logout, admin status/retry/resend; `orderView` is the one description of an order used by the U POS door and the FileMaker push |
| `src/erp/dto.ts`, `erp.controller.ts` (extras + staff-search routes), `erp-sync.service.ts` (`extraMap`, `listExtras`, `addExtra`, `removeExtra`, `searchErpStaff`) | — | **extra ERP people picked by hand** (D87): `ErpExtraStaff`, `parsePeople`'s `extras` argument, `ErpPerson.sesBranchId` |
| `src/accounts/staff-sheet.ts` | 130 | **staff spreadsheet** (D86): the column list of the export, and the pure readers for the import's cells (`parsePhoneCell`, `parseRolesCell`, `parseActiveCell`); the export / import methods are `AccountsService.exportStaff` / `importStaff` (all or nothing, same rules as the form via `createStaffIn` / `updateStaffIn`) |
| `src/accounts/otp.service.ts` | 200 | **SMS OTP login** (D85): request / verify (hash only, 5 min, 5 tries, per-staff and system limits), admin status and test SMS; sessions are started by `AccountsService.createSession` (12 h) |
| `src/docs/api-docs.ts` | 130 | **API documentation pages** (D84): `/api/docs` (all endpoints, ADMIN only, read-only) and `/api/pos-docs` (U POS contract, public); OpenAPI from `@nestjs/swagger` (CLI plugin in `nest-cli.json` introspects `*dto.ts` + comments) |
| `src/categories/categories.service.ts`, `categories.controller.ts`, `dto.ts`, `categories.module.ts` | 230 | **product categories** (D72): `GET /categories` (everyone: active; ADMIN `?all=true` with product counts), add / switch on-off / flag accessory / move (ADMIN, `OriginGuard`); names are never renamed |
| `src/products/products.service.ts` | 500 | inventory sync (H-17), branch-filtered catalog (active categories only, D72), category check on create/update, cascade deactivation (D42); no demo seed (D73) |
| `src/products/dto.ts` | 118 | catalog DTOs |
| `prisma/schema.prisma` | 354 | 21 models / 5 enums (see CONTEXT §3) |
| `prisma/migrations/` | — | `2026092800{01..05}` accounts → stock review, `2026100900{01,02}` branch inventory, Accessories category, `2026101200{01,02}` ERP import / warroom products, `202610130001` customer types + queue numbers + daily counters (seeds types A/B, back-fills `queueNo`, seeds the `reference` counters), `202610130002` `Setting` table, `202610150001` `ProductSku.memory`, `202610140003` `Category` table (seeded with the five Apple categories) + `Product.category` enum → string + `ProductSku.upc`, `202610130007` `posBillNo` / `posBillOpenedAt`, `202610130006` `Branch.registrationUrl`, `202610130005` `PaymentMethod` (seeded with the 11 methods), `202610130004` stock acknowledgement + `rebuyOfId` + two event types, `202610130003` `SessionItem` (+ copies every existing main product into an item, `deducted` from the STOCK_FOUND event) |
| `scripts/bootstrap.mjs` | 52 | creates the first ADMIN only when Staff is empty; imports `../dist/accounts/password.js`, so **build the API first** |
| `docker-entrypoint.sh` | — | `set -e`; `prisma migrate deploy`; optional bootstrap; `exec node apps/api/dist/main.js` (H-16) |
| `tests/accounts.test.mjs` | 519 | **real** HTTP + MySQL integration test (needs the `service_efficiency_test` DB) |
| `tests/warroom-sync.test.mjs` | ~520 | 6 pure tests + real MySQL against a **Postgres stub of `mart.stock_mv`**: shadow vs on, availability with sessions, locks, zeroing, mass-loss and stale guards, unreachable warroom, `tick()` once per snapshot |
| `tests/erp-sync.test.mjs` | ~450 | 5 pure tests + a real-MySQL test against a **fake ERP** (node `http`): plan/apply, passwords, leavers, closed branch, adoption, ERP down/401, mass guard, async run, slot claim |
| `tests/queue.test.mjs` + `tests/support.mjs` | 500 + 146 | **real** HTTP + MySQL: walk-in at the phone number, queue numbers (per branch/type/day, 8 parallel walk-ins, the Bangkok midnight boundary, a taken reference), customer types. `support.mjs` is the shared harness for new workflow tests (boot, seed a world with one account per role, `cleanup` also stops the app, `TEST_LOG=1`) |
| `tests/pos-integration.test.mjs` | 230 | **real**: closed without the key (404) and the key checked (401), the orders waiting at the cashier with their lines, the bill moving the order on at the real time, the cashier-pressed-first case, idempotence and conflicts, what U POS may not do |
| `tests/branch-registration.test.mjs` | 90 | **real**: ADMIN sets / clears a branch's registration URL, validation, ERP-managed branches take it, sessions carry it to the receipt |
| `tests/payment-methods.test.mjs` | 120 | **real**: the seeded list, ADMIN-only writes, a name once (case-insensitive), switch off / on, move, at least one active |
| `tests/cancel-reject-rebuy.test.mjs` | 300 | **real** end-to-end for any-role cancel at every stage, the stock acknowledgement (who, once, auto when stock cancels before picking), the cashier's reject (units back, milestones restart, history kept, a second round to COMPLETED, too late at BILL_OPENED) and "buy again" (same queue number, old data, once, only for change reasons, counters untouched) |
| `tests/session-items.test.mjs` | 330 | **real** end-to-end for several main products (D61): items replace each other and validate, confirm needs one, FOUND/cancel per item with the switch on and off, stock review by item id (ACCEPT_PARTIAL, CHANGE_ITEMS), a review without ids, the out-of-stock endpoint, availability by quantity |
| `tests/stock-unlimited.test.mjs` | 150 | **real** end-to-end through the step engine (walk-in → … → FOUND → cancel) for the D59 switch: who may change it, `stockSource`, FOUND/cancel with the switch on and off, a toggle between FOUND and cancel, events from before D59. The first test that drives `advanceStep` |
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
| `staff` | `features/session/StaffWorkspace.tsx` (975) + `WalkInForm.tsx` | STAFF |
| `stock` | `features/stock/StockWorkspace.tsx` (815) | STOCK |
| `cashier` | `features/cashier/CashierWorkspace.tsx` (525) | CASHIER |
| `logs` | `features/logs/SessionLogsWorkspace.tsx` (1656); deep link `#/logs?ref=SES-…` (the internal reference) | everyone |
| `products` | `features/products/ProductWorkspace.tsx` (1298), sub-views MAIN/STOCK | ADMIN, MANAGER |
| `admin` | `features/admin/AdminHub.tsx` (729) + `SystemAuditLogs.tsx`, `ErpSyncPanel.tsx`, `WarroomSyncPanel.tsx`, `CustomerTypesPanel.tsx`, `PaymentMethodsPanel.tsx`, `StockUnlimitedPanel.tsx` (the D59 switch, also a one-line banner on the product pages) | ADMIN, MANAGER (branches, audit, ERP sync, the switch and customer types: ADMIN) |

The UI does **not** give ADMIN the workspace views unless ADMIN also holds that role, while the API
lets ADMIN pass every role check. Keep this in mind when testing with an ADMIN-only account.

### 3.2 Data access
- `services/api.ts` (43 lines): `api(path, method, body)` → `fetch('/api'+path)`, `credentials:'include'`, always sends `X-Requested-With: ServiceEfficiency`. A 401 dispatches the `auth-expired` window event. Error text comes from `data.message`.
- `services/sessionApi.ts` (347 lines): one function per session endpoint (+ customer types). Every response goes through `mapApiSessionToMockSession`, which converts the API shape (camelCase `*At`) to the UI's `MockSession` (snake_case `timestamps`). **Read this mapper before you change any API response shape.**
- `recordOutOfStockApi` is never called. The UI uses only the D40 report-missing path (relevant to H-09).
- Dev: Vite proxy `/api` → `127.0.0.1:3001`. Prod: nginx `apps/web/nginx.conf.template`, `location /api/` → `API_URL`.

### 3.3 Feature folders
- **session/**: `Receipt.tsx` (`ReceiptPrint` button + the 80 mm print sheet in a portal on `<body>`, `QrCodeSvg`; print CSS at the end of `styles.css`), `SelectionEditor` (D61/D62: the list of chosen main products with `−` / `+`, and the step-by-step picker: category → product → model → capacity/colour tiles; accessories, Ontop, Points, Payment below), `WalkInForm` (step 1 of a walk-in: phone number + customer type → "รับคิว", D56/D57), `StaffWorkspace` (queue number → DEMO → BUY/NOT_BUY → the phone, pre-filled, can be corrected → `SelectionEditor` → review → confirm; stock-review banner with 3 choices), `SelectionEditor` (flattens `/products`, hides inactive SKUs and `branchActive=false`, disables stock ≤ 0; falls back to `mocks/data.ts` products if the API fails), `ReasonForm`, `Summary`, `workflow.ts` (a client-side state machine, "mock presentation only", plus validators, `isToday`, `getSessionMissingDescription`).
- **stock/**: today's queue (STOCK_REQUESTED/SEARCHING/FOUND). The user ticks the found items; "FOUND" appears only when every item is ticked, otherwise "report missing" sends strings like `"Case (x2)"`. Cancel alerts are dismissed in **localStorage** only.
- **cashier/**: today's queue (SENT_TO_CASHIER → BILL_OPENED), 4-step stepper.
- **logs/**: history table built from App's polled `sessions` (no fetch of its own); search, date and branch filters, paging 15/25/50, event timeline, CSV export (ADMIN/MANAGER, UTF-8 BOM).
- **products/**: catalog CRUD, branch stock breakdown modal with the unsaved-changes guard and Save-all (D44).
- **admin/**: users and branches with the D39 rules mirrored in the UI; audit log viewer (300 rows, filtered in the client).
- `utils/qr.ts`: `qrCode(text)` → the QR as one SVG path (library `qrcode-generator` 2.0.4, MIT, the only runtime dependency of the web app besides React and lucide; its own byte encoder keeps only the low byte of each character, so the text is encoded as UTF-8 here).
- Shared: `components/ui.tsx` (Modal, Button, Panel, MultiSelect, Notice), `components/Toast.tsx` (`useToast`), `constants/options.ts` (**the fixed business option lists**), `types/session.ts` (hand-copied enums, `MockSession`), `types/accounts.ts`.
- `app/styles.css` (3227 lines): global kebab-case classes, `:root` tokens (`--primary #0abab5`), sticky `th` (D49/D50), IBM Plex Sans Thai loaded from Google Fonts.
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
| Reports/export | — (no endpoint; export is client-side CSV) | `SessionLogsWorkspace` `ExportModal` (`EXPORT_CATEGORIES`) | OQ-11 must be answered first |
| A global ADMIN switch | `settings/` module (add a field to `SettingsUpdateDto`, `SettingsService`, a row name) | `StockUnlimitedPanel` (admin → ซิงก์ ERP), read via `fetchSettingsApi` | a D-entry, CONTEXT glossary, `stock-unlimited.test.mjs` as the model test |
| Queue numbers / customer types | `queue/` module, `createWalkIn`, `CustomerType` / `DailyCounter` | `WalkInForm`, `CustomerTypesPanel`, `formatQueue` in `workflow.ts` (keep it equal to the API's), every screen that shows `s.queue` | D57, ADR 0001, `queue.test.mjs` |

## 5. Size hotspots (read in slices, don't rewrite wholesale)

`styles.css` 3227 · `SessionLogsWorkspace.tsx` 1656 · `ProductWorkspace.tsx` 1410 ·
`sessions.service.ts` 975 · `StaffWorkspace.tsx` 975 · `StockWorkspace.tsx` 815 ·
`App.tsx` 718 · `AdminHub.tsx` 729 · `products.service.ts` 727 · `CashierWorkspace.tsx` 525 ·
`accounts.service.ts` 569.
