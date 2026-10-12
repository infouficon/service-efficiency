# Hazards register: known gaps, risks and doc drift

A numbered list of problems found by reading the code (`main` @ `1c9eaf1`, 2026-10-12; updated 2026-10-13).
Items marked `fixed in …` have been fixed (H-05, H-19 so far); **everything else is still open.** Each item is a candidate topic for `/grill-with-docs` or a
GitHub issue. Fixing one usually needs a business decision first, so record that decision
as a new `D5x` entry in [docs/decisions.md](../decisions.md) before or with the code.

Severity: **S1** = wrong data or a security gap in production paths · **S2** = an invariant broken in
edge cases, or a scaling problem · **S3** = maintainability or doc drift.
Status: **confirmed** = proven by reading the code path end to end · **verify** = plausible,
reproduce it before acting.

When you fix an item, change its status to `fixed in <sha>/PR#`. Do not delete it.

## Top priorities

1. **H-01** concurrent and duplicate actions double-apply (stock deducted twice).
2. **H-13** cancellation permissions differ from the confirmed matrix.
3. **H-03** the CSRF/Origin guard is missing on the session and product mutations.
4. **H-06** `GET /sessions` is unbounded and ignores the STAFF history rule.
5. **H-15** the session workflow has no real automated tests, so every fix above needs tests first.

---

### H-01: State is checked outside the transaction, so actions can double-apply · S1 · confirmed
- **Where:** `apps/api/src/sessions/sessions.service.ts`: each mutating method calls `getById()` (a plain read) and then `$transaction(... update({ where: { id } }))` without re-checking state inside the transaction. Example: `advanceStep` reads with `getById`, checks `state === from`, and only then writes in `$transaction`.
- **Impact:** a double-click or a retry of `found` deducts `BranchInventory.stock` twice and writes two `STOCK_FOUND` events, and the second request overwrites `stockFoundAt`. `cancel` and `found` racing can leave the stock off by one. This breaks state-machine.md: "Duplicate clicks/retries must not overwrite timestamps or create a second accepted transition".
- **Fix direction:** a conditional write inside the transaction, `updateMany({ where: { id, state: from, outcome: null } })`, then treat `count === 0` as 409 Conflict (or `SELECT … FOR UPDATE` on the row). Decide the HTTP contract for a duplicate (409 or idempotent 200); that is OQ-06.

### H-02: Every authenticated request takes a global lock · S2 · confirmed
- **Where:** `AccountsService.authenticate()` → `transaction()` runs `SELECT id FROM AccountLock WHERE id = 1 FOR UPDATE` (`accounts.service.ts:43-60`), and also writes `LoginSession.lastSeenAt` on every request (`:103-106`).
- **Impact:** every API call from every branch (including GETs and UI polling) is serialized on one row lock. The latency floor grows with the number of users. D39 meant this lock for account *mutations* only ("deliberately limited to this initial account module").
- **Fix direction:** authenticate without the mutex (read the session and staff, update `lastSeenAt` without locking, or only when it is older than about 1 minute). Keep the mutex for account writes.

### H-03: The CSRF/Origin guard covers only `/auth`, `/staff` and `/branches` · S1 · confirmed
- **Where:** `OriginGuard` is applied with `@UseGuards` on `AccountsController` only (`accounts.controller.ts:36-57`). `SessionsController` and `ProductsController` have no guard.
- **Impact:** the README and D39 say "Unsafe requests require allowed Origin plus custom header". The cookie is `SameSite=Lax`, which blocks most cross-site POSTs, but the documented defence-in-depth is missing on the endpoints that change business data.
- **Fix direction:** move `OriginGuard` to a shared file and register it globally (`APP_GUARD`) or on all three controllers. Check that the web client always sends `X-Requested-With: ServiceEfficiency` (see codebase-map §Frontend).

### H-04: "One active DEMO per Staff" (D5) is not enforced · S2 · confirmed
- **Where:** the `startDemo` entry of the `STEPS` map (`sessions.service.ts`) checks only the session's own state.
- **Fix direction:** inside the transaction, count the actor's sessions in `DEMO` with `outcome IS NULL` and reject when the count is above 0. Concurrency needs the same care as H-01. OQ-06 (ownership and handoff) affects whose workload counts.

### H-05: The session reference allocator collides under concurrency and uses server-local time · S2 · **fixed in the D56/D57 PR** (feat/queue-types-phone-first)
- **Was:** `createWalkIn` read the day's highest reference and added 1 with no lock; two walk-ins at the same moment produced P2002 → HTTP 500, and the date prefix came from the container's time zone.
- **Fix:** the reference and the new queue number (D57) both come from `DailyCounter` rows incremented atomically inside the walk-in transaction, per Asia/Bangkok day ([ADR 0001](../adr/0001-atomic-daily-counters-for-queue-numbers.md)). A number that is already taken is skipped; the migration seeds the `reference` counters from existing sessions. Covered by `apps/api/tests/queue.test.mjs` (8 parallel walk-ins, the Bangkok midnight boundary, a taken reference).

### H-06: `GET /sessions` is unbounded, and history visibility exists only in the UI · S2 · confirmed
- **Where:** `list()` `sessions.service.ts:127-171` returns every session of the branch (ADMIN: all branches) with all child rows and the full event history. There is no date filter and no paging.
- **Impact:** (a) the payload and query time grow forever. (b) D3 says STAFF must not see historical sessions, and D47 says Stock/Cashier queues are today-only, but both are UI filters. Any branch user can read the branch's full history through the API.
- **Fix direction:** server-side filters (`date`, `state`, `mine`) chosen by role, plus paging for the logs view. This needs a decision on the STAFF "own current work" predicate (OQ-06).

### H-07: Branch stock can go negative, and stock changes leave no audit trail · S2 · confirmed
- **Where:** `stock: { decrement: 1 }` in `advanceStep` (`found`), `recordOutOfStock` (partial) and `resolveStockReview` (ACCEPT_PARTIAL) has no floor. ADMIN `PUT …/stock` sets an absolute value (`products.service.ts:358-377`) with no event. Cancelling after FOUND adds `+1` (`cancelSession`) even when out-of-stock or missing-item handling already set the stock to 0.
- **Impact:** the inventory can drift from reality, and nobody can tell who changed a quantity or when.
- **Update 2026-10-13 (D59):** a cancel now gives back exactly the units the STOCK_FOUND event recorded (`metadata.deducted`), so it can no longer add a unit that was never taken (the switch "stock unlimited"). The floor and the audit trail are still missing.
- **Fix direction:** guard with `stock > 0` (or decide that negative stock is allowed and shown). Add an inventory movement log if the business wants an audit trail (this needs a decision).

### H-08: Clearing `stockReview` with a plain `null` · S1 if real · verify
- **Where:** `stockReview: null as unknown as undefined` in the three branches of `resolveStockReview` (`sessions.service.ts`). Prisma requires `Prisma.DbNull`/`Prisma.JsonNull` to null a `Json?` column. The cast hides the type error, but the runtime may still reject the value, and then all three resolve actions would return 500.
- **Verify:** call resolve-stock-review against the dev DB. If it works, mark this item "not a bug" and replace the cast with `Prisma.DbNull` for clarity.

### H-09: Two divergent "partial fulfilment" paths that match items by display name · S2 · confirmed
- **Where:** the STOCK path `POST /out-of-stock {action:'partial'}` (`:644-715`) matches `'MAIN_PRODUCT'`, the SKU code or the product name. The D40 path, report-missing and then resolve (`:848-1179`), matches `'สินค้าหลัก'`, the model, SKU name or code, and strips accessory names with the regex `\s*\(x\d+\)$`. The `isMainProductMissing` closure is copied three times.
- **Impact:** renaming a product or model changes the matching behaviour, and the two paths can treat the same report differently.
- **Fix direction:** decide whether D40 replaces the STOCK-only partial path. Send stable identifiers (`{ kind:'MAIN' } | { kind:'ACCESSORY', name }`) instead of display strings.

### H-10: The selection API accepts any SKU · S2 · confirmed
- **Where:** `updateSelection` `:507-542` resolves `skuId` by UUID or SKU code across **all** branches. It does not check `BranchInventory.active`, `stock > 0`, or whether the SKU, model or product is active. An unknown SKU is silently ignored and the old value kept. Changing the model without a SKU is a no-op once a model is already set.
- **Impact:** D41's selectability rule is enforced only by the UI.
- **Fix direction:** validate against the branch's inventory inside the transaction, and return 400 for an unknown or unavailable SKU.

### H-11: Fixed option lists are not validated by the server · S3 · confirmed
- **Where:** `UpdateSelectionDto` (`sessions/dto.ts:95-130`), plus the NOT_BUY and cancel `reason` fields, accept any string. Payments are not filtered for `None`. Duplicates are allowed (OQ-09).
- **Fix direction:** move the fixed lists (currently in `apps/web/src/constants/options.ts`) into `packages/shared` (it is empty: `export {}`) and validate with `@IsIn` in the DTOs.

### H-12: One `reason`/`otherReason` pair serves three meanings · S3 · confirmed
- NOT_BUY result, cancellation reason, and out-of-stock reason (which defaults to `'OUT_OF_STOCK'`) share the same two columns. docs/erd.md says NOT_BUY text and cancellation text "must not be merged into an ambiguous shared reason field". Today `outcome` tells them apart, so reports must always read `reason` together with `outcome`. Decide whether to keep this (and update the ERD) or to split the columns.

### H-13: Cancellation permissions differ from the confirmed matrix · S1 · confirmed
- **Where:** `cancelSession` (the role check by state, `sessions.service.ts`).
- **Differences:** (a) STAFF cannot cancel in the Stock and Cashier stages without the STOCK or CASHIER role, although requirements §25 and permissions.md confirm STAFF *can* cancel in DEMO, PRODUCT_SELECTION, STOCK and CASHIER. (b) In WALK_IN and DECISION there is **no role check at all**: any authenticated user of the branch (for example a CASHIER-only account) can cancel. Cancelling in those states is not in the confirmed flow either. (c) OQ-02 (which exact substates allow cancellation) is still open.
- **Fix direction:** settle OQ-02 and record it as a decision, then encode one explicit `stage → allowedRoles` table.

### H-14: Documentation drift: several docs describe an older phase · S3 · confirmed
- `README.md:3` says "Customer Session, Product and workflow are still mock in memory", which is false: they are in MySQL. `README.md:97` "Coolify — later phase" is false: it is live at `ses.uficon.com`. `README.md:5` links to `docs/manual-test-staff-journey.md`, which does not exist.
- `docs/erd.md` says "Workflow models remain unimplemented" and lists the D27 event set. `docs/architecture.md` says "No Prisma changes". `docs/state-machine.md` has CONFIRMATION and CLOSED nodes and the `STOCK_REQUESTED` event.
- `apps/api/.env.example` has an *active* `DATABASE_URL` pointing at a `booking` DB on port 3306, while the README says to use the isolated MySQL on 3307.
- **Rule for agents:** trust the code, then decisions D39–D51 (newest wins), then the other docs. See AGENTS.md "Source of truth".

### H-15: The session and product workflow has no real tests · S2 · confirmed
- **Update 2026-10-12:** `apps/api/tests/accounts.test.mjs`, the one real integration test, **fails on `main`** (7 of 8 subtests): `StaffUpdateDto.firstName/lastName` are `@IsString()` without `@IsOptional()` (added by migration `202609280004_staff_names`) but the test's `account()` helper does not send them, so `POST /staff` returns 400. Not caused by the ERP work. **Fixed on `feat/erp-sync`**: the helpers now send the names and the suite passes 8/8 (note: its last-ADMIN test counts ADMIN accounts in the whole database, so run it on an empty test DB). Whether the DTO fields should be optional is still open (`createStaff` already supports `?? ''`).
- `apps/api/tests/sessions.test.mjs` asserts literal constants (for example "an array of strings does not include `stockRequestedAt`") and never calls the API or the database. Only `accounts.test.mjs` is a real HTTP + MySQL integration test. `apps/web/tests/workflow.test.mjs` tests the pure helpers in `features/session/workflow.ts`.
- **Update 2026-10-13:** `apps/api/tests/queue.test.mjs` is the first real integration test of the session workflow (walk-in, queue numbers, customer types); it uses the shared harness `apps/api/tests/support.mjs` (boot the app, seed a branch world with one account per role, clean up; `TEST_LOG=1` shows server errors). The step/stock/cancel paths are still untested.
- **Rule:** before fixing H-01, H-04, H-07, H-10 or H-13, add a failing integration test in the style of `accounts.test.mjs`. It uses an isolated `service_efficiency_test` DB and refuses any other DB name.

### H-16: A push to `main` deploys production, and a bad migration stops the API · S1 (process) · confirmed
- Coolify auto-deploys the `web` and `api` apps from `main` (webhook observed 2026-10-08). The API container's entrypoint (`apps/api/docker-entrypoint.sh`) runs `prisma migrate deploy` under `set -e` **before** it starts the server, so a failing migration means the API never starts. There is **no CI** (no `.github/`).
- **Rule:** never push straight to `main`. Use a branch and a PR, run lint, build, `prisma validate` and tests locally, and keep migrations additive. See [recipes.md](recipes.md).

### H-17: The product service seeds and back-fills data at boot and on every read · S2 · confirmed
- `ProductsService.onModuleInit()` seeds a hard-coded demo catalog when `Product` is empty, **in production too** (`products.service.ts:9-12, 53-233`). `findByBranch()` calls `syncBranchInventory()` (a full Branch × SKU scan plus `createMany`) on every product list request (`:235-236`). Both catch and ignore all errors.
- **Fix direction:** create the BranchInventory rows when a branch or SKU is created (D41 says "Defaults when a new SKU or Branch is created"), and move the seed behind an explicit script.

### H-18: Weak trail for stock review resolution and alert acknowledgment · S3 · confirmed
- "Assigned staff" means `session.staffId === actor`, with no role check . The session creator is the only Staff link, and there is no reassignment (OQ-06). `acknowledgeAlert` runs outside a transaction and writes no `SessionEvent`; the acknowledgment survives only inside the JSON blob, which resolve then wipes.

### H-19: Copy-pasted Prisma `include` blocks · S3 · **fixed in the D56/D57 PR** (feat/queue-types-phone-first)
- **Was:** the same `include: { branch, staff, product, model, sku…, events }` block appeared 15 times in `sessions.service.ts` with small differences, so responses differed in shape between endpoints.
- **Fix:** one `sessionInclude` constant (`satisfies Prisma.CustomerSessionInclude`) used by every method; every endpoint now returns the same shape (sku with model and product, `customerType`, events oldest first).

### H-20: ADMIN walk-in silently picks a branch · S3 · confirmed
- `createWalkIn`: an ADMIN with no `branchId` and no home branch gets the first active branch ordered by code, so sessions can land in an arbitrary branch. Prefer requiring `branchId` for ADMIN (400).

---

## Frontend hazards (`apps/web`)

### H-21: The UI fakes success on API errors · S1 · confirmed
- **Where:** `CashierWorkspace.tsx:85-130`: when `advanceStepApi` or `cancelSessionApi` throws, the `catch` is empty and the code falls through to a **local** `advance()` / local cancel. `StaffWorkspace.tsx:808-842`: when `recordNotBuyApi` fails, the error is shown, but there is no `return`, so the code goes on to apply a local NOT_BUY. Similar local fallbacks exist for stock-review resolution (`Staff:142-149, 213-221`) and Stock cancel (`Stock:244-254`).
- **Impact:** a rejected action (403, 400 "wrong state", network error) looks accepted on that screen, then the next 4-second poll replaces it with the server state. The user sees the state "jump back". The local copy also invents timestamps and `cancelledBy` in the browser, which breaks AGENTS rules 7 and 8.
- **Fix direction:** show the error and stop (`return`). Delete the offline fallbacks; the `!session.id` branches never run for API-loaded sessions.

### H-22: The 4 s poll merges local `phone`/`selection` over the server copy · S2 · confirmed
- **Where:** `App.tsx:131-145`. For an unconfirmed, non-terminal session the local `phone` and `selection` win. Another device's edit is therefore hidden until the first device saves again.
- **Impact:** two devices on one session overwrite each other (last write wins, and `updateSelection` replaces whole lists). No conflict handling exists.

### H-23: Dismissal state lives in `localStorage` or component state · S3 · confirmed
- Stock cancel alerts are dismissed only in `localStorage` (`service_efficiency_stock_dismissed_cancels`, `Stock:29-54`). The manager banner's "dismiss" calls `acknowledge-alert` per session but swallows errors (`App.tsx:210-226`). Different browsers/devices see different alerts.

### H-24: Event names in the CSV export don't match the real enum · S2 · verify
- `SessionLogsWorkspace.tsx:311-414` looks up event types such as `DECISION`, `CASHIER_SCAN`, `STOCK_STARTED`, while Prisma has `DECISION_MADE`, `CASHIER_SCANNED`, `STOCK_SEARCHING`. Some exported timestamp columns may come out empty if the fallback is not the milestone fields. Export a real session and compare before trusting the CSV (OQ-11).

### H-25: "Today" is computed in the browser, inconsistently · S2 · partly verify
- Two `isToday` implementations (`workflow.ts:177-190` and `isTodaySession` in `StaffWorkspace.tsx:48-79`); the Logs "Today" quick filter uses the UTC date via `toISOString` (`Logs:930`), while `SystemAuditLogs` uses the local date (`:36-42`) and compares it with `timestamp.slice(0,10)` (`:106`). In UTC+7 this can be a day off between 00:00 and 07:00 (verify what the API returns: it serialises JS `Date` as UTC ISO).
- The queue badges and workspaces depend on the user's device clock and timezone (D47).

### H-26: Client identity/branch quirks · S3 · confirmed
- `MockUser.branchCode` falls back to `account.branchId`, a UUID (`App.tsx:87`); `createWalkInApi` sends it as `branchId`. It works only because the server accepts a UUID or a code and ignores it for non-admins.
- `user` is rebuilt on every render and is a dependency of the hash effect (`App.tsx:85-115`), so the `hashchange` listener is re-bound on every render.
- API request paths in `ProductWorkspace` don't pass IDs through `encodeURIComponent`.

### H-27: Stale and dead frontend code · S3 · confirmed
- `apps/web/README.md` still says Staff/Stock/Cashier are mock and nothing is saved; this is wrong (H-14).
- Unused: `recordOutOfStockApi`, `partialFulfillStock` (imported in Stock, never called), `resolveSessionStatusText`, `handleSaveBranchStock`, most of `mocks/data.ts` (only `products` is used, as a fallback catalog), `categories` and `cancellationStages` in `options.ts`, about 10 icon imports in `CashierWorkspace`, a commented block in `App.tsx:630-660`. `tsconfig` lacks `noUnusedLocals`.
- `Mock*` type names and `previewTime()` are used for live data. Rename only as part of a feature change, never as a drive-by.
- `ui.tsx` `Modal` always uses `id="modal-title"`, so two open modals give duplicate IDs. `ExportModal` validates with `alert()`. `.spin` has no CSS rule (only `@keyframes spin`).

### H-28: The fallback catalog sends IDs that don't exist · S3 · confirmed
- If `/products` fails or is empty, `SelectionEditor` uses `mocks/data.ts` products (`sku-1`, …). `updateSelectionApi` sends them, and the server tries to match them as a SKU id or code. An unknown value is **silently ignored** (H-10), so the UI shows a product that the server never saved. Remove the fallback or show an error.

### H-29: The ERP's OData service can hang, and a filtered query is the prime suspect · S1 (shared with the shops) · partly verified
- On 2026-10-12 at about 15:35 FileMaker OData stopped answering (`branch/$count`, normally 0.05 s, and the unauthenticated OData root timed out; the web root still answered). It was first suspected to follow a draft query with `$filter=status eq 'active' or …` on `staff`, but warroom's own freshness shows its 15:15 slot never loaded (last stock load 12:31, sales 12:21), so the ERP was probably already unhealthy; warroom itself sends `or` filters on a far bigger table every slot. Cause and recovery time unproven.
- **Rules:** no `$filter` on ERP fields (select narrow, filter in code); one request at a time; a timeout is final (never retry an overloaded ERP); keep scheduled imports away from shop peak hours; run a dry run first on every new environment. See `apps/api/src/erp/erp-sync.service.ts` (`STAFF_QUERY`, `odataRows`) and warroom's `docs/ODATA_FINDINGS.md` §5, §10.

### H-30: Prettier baseline is red · S3 · confirmed
- Before the ERP work, `npx prettier --check` already failed for 18 web files and for `apps/api/src/accounts/accounts.service.ts`. The ERP branch formatted only the files it touched in the web app (AdminHub.tsx, App.tsx, styles.css: whitespace-only churn, review with `git diff -w`) and left `accounts.service.ts` alone. Decide on one repo-wide `prettier --write` commit.

### H-31: Known gaps in the ERP import after the independent review (2026-10-12) · S2/S3 · open
Fixed in the same PR: unusable ERP rows (no password, unmapped position, duplicate or broken ids/branch rows) keep the account instead of deactivating it; an empty staff list is refused even with `force`; `dryRun`/`force`/`wait` must be exactly `true`/`false`; no secret fragments in errors (fixed messages, URL with credentials rejected); one colliding id is skipped instead of aborting the run; ADMIN cannot be granted to an ERP-managed account; per-account `changes` list in the run summary.
Still open:
- **Per-replica `running` flag**: a manual run on replica B can overlap the scheduled run on replica A (two ERP requests at once). The DB serialises writes, so no corruption. Fix: refuse a run when an `ErpSyncRun` with `ok IS NULL` started in the last 20 minutes exists.
- **Hand-granted MANAGER on an ERP-managed account**: HR re-activating the person in the ERP re-enables the account (with the ERP password and branch) and its MANAGER role. Decide whether MANAGER should be allowed on synced accounts at all.
- `staffId` is not trimmed by the DTO (`"4411 "` vs `4411` collide in the database collation); the import now skips the collision, the DTO should trim.
- `RAW_CONTROL` leaves raw CR/LF/TAB inside strings unrepaired and a `SyntaxError` is retried once; one odd `position` could fail every daily run.
- The panel does not render `warnings` or `changes`, cannot send `force`, and the audit feed (`getAuditLogs`) does not read `ErpSyncRun`. An ADMIN cannot unlock an ERP-managed account (reset is refused).
- `apply` is about 300 sequential statements inside the shared 15 s `AccountLock` transaction (H-02); `createMany` would cut it. A rollback by timeout is recorded as a failed run and retried.
- Tests do not cover: concurrent `claim`, abandoned-run reclaim, `tick`/`dueSlot` wiring, branch rename/reopen/move, OData 5xx-then-success, timeout and `MAX_ROWS`, the MySQL object form of the JSON column (tests run MariaDB), and rollback of updates/leavers in a dry run.

### H-32: Known gaps in the warroom products/stock sync · S2/S3 · open
- **Category and hierarchy rules are guesses until the first real dry run** (`mapCategory`, Product = `product_subcat`, Model = `product_subsubcat`). Nothing real was ever read from the production warroom DB by the author (its host is internal to Coolify). Expect to adjust after reading the "unmapped" list.
- **Coupled to warroom internals**: `mart.stock_mv` columns `stock_type, snapshot_at, product_upc, product_name, product_model, product_cat, product_subcat, product_subsubcat, qty, branch_code` (+ optional `capacity`, `color`). A warroom change breaks SES at the next run (the run fails visibly, nothing is written). `npi_reader` can read all of `mart`; a dedicated role is advised.
- **`erpAsOf` is the last time a stock row CHANGED, not the pull time**: warroom drops unchanged rows as duplicates (`ingestRows … ON CONFLICT DO NOTHING`), so `max(snapshot_at)` can be older than the real pull; the true pull time (`app.odata_sync`) is not readable by `npi_reader`. The error is on the safe side (a session completed between that time and the pull counts as held a little longer) and no new snapshot is processed when nothing changed.
- **Freshness**: warroom pulls 5×/day, 12.5 h overnight; units sold in the shop (not through SES) between snapshots are invisible. The only correction SES applies is its own sessions (reservations) and D41 reports.
- **Reservation rule is a heuristic**: a session holds a unit from FOUND until COMPLETED (or an outcome); an abandoned session holds for 24 h; SES completion and the ERP bill are separate human actions, so a unit can be counted twice for a short time or released early.
- D41's `found` decrement / restore still run but are ignored for ERP-covered rows in mode `on`; the manual `stock` column keeps drifting for them. Going back from `on` to `shadow` leaves the ERP-created SKUs with manual stock 0 (or negative), i.e. unsellable until someone sets it.
- A missing/out-of-stock report (D41) can only expire (6 h) or be superseded by a newer snapshot; there is no "clear report" action. The three writers of `outOfStockAt` in `sessions.service.ts` have no test of their own.
- `shadow` and `off` are not completely silent: staff `GET /products` carries `erpManaged/erpCovered/erpAsOf`, MANAGER sees raw ERP numbers in the admin list, `findAllAdmin` always loads reservations, `sessions.service` always writes `outOfStockAt`. The staff stock number itself is unchanged.
- A MANAGER cannot read the sync mode, so in mode `on` the admin product list shows them the manual numbers next to the ERP line.
- `syncBranchInventory()` (pre-existing) scans every inventory row on each product read and, after the first `on` run created thousands of SKUs, every staff request retries the same `createMany`; watch the response time.
- The Postgres-stub test skips silently when MySQL or the stub is not reachable, and it checks that the stub is a local `warroom_stub` before it drops/rewrites `mart.stock_mv`.
- Only branches whose `Branch.code` equals the ERP `branch_code` get numbers; others are listed as "unknown" in the run summary.
- Mode `on` creates products named after the ERP sub-category: a hand-made product with the same (category, name) is reused (new models/SKUs are added under it), so a deactivated hand-made product hides its new ERP SKUs.
- The sync never deactivates or deletes: discontinued ERP products stay in SES with 0 stock.
- Raw SQL upserts use `VALUES()` in `ON DUPLICATE KEY UPDATE` (works on MySQL 8.4 with a deprecation warning and on MariaDB).
