# Workflow as built: the API contract of the CustomerSession lifecycle

What the code **actually does** today (`main` @ `1c9eaf1`, 2026-10-12). The design intent is in
[docs/state-machine.md](../state-machine.md) and [docs/permissions.md](../permissions.md); both
were written in Phase 1 and are older than this code. Where they disagree, the differences
are listed in §5. Vocabulary: [CONTEXT.md](../../CONTEXT.md).

All paths below have the global prefix `/api` (`apps/api/src/bootstrap.ts:11`), except `GET /health`.
Every handler first calls `AccountsService.authenticate(req)` (cookie `se_session`), so
**every endpoint requires a valid Login Session** and the actor is always the cookie's Staff.

## 1. The step table (`POST /api/sessions/:id/step` `{ action }`)

Source: the `STEPS` map in `apps/api/src/sessions/sessions.service.ts:22-107`, executed by
`advanceStep()` (`:293-359`). Guards: the session is not finished (`outcome` null and state ≠
`COMPLETED`), the actor has `requiredRole` (**ADMIN always passes**, `:114`) and `state === from`.

| action | from → to | role | timestamp column | event | side effect |
| --- | --- | --- | --- | --- | --- |
| `startDemo` | WALK_IN → DEMO | STAFF | `demoStartAt` | DEMO_STARTED | none (the one-DEMO-per-Staff rule is **not** checked, H-04) |
| `endDemo` | DEMO → DECISION | STAFF | `demoEndAt` | DEMO_ENDED | |
| `buy` | DECISION → DECISION | STAFF | `decisionAt` | DECISION_MADE | records BUY; the state does not move |
| `startSelection` | DECISION → PRODUCT_SELECTION | STAFF | `productSelectionStartAt` | PRODUCT_SELECTION_STARTED | requires `decisionAt` (`:313`) |
| `search` | STOCK_REQUESTED → SEARCHING | STOCK | `stockStartedAt` | STOCK_SEARCHING | |
| `found` | SEARCHING → FOUND | STOCK | `stockFoundAt` | STOCK_FOUND | **BranchInventory.stock −1** for the session SKU (`:320-325`), no floor (H-07) |
| `send` | FOUND → SENT_TO_CASHIER | STOCK | — | STOCK_SENT_TO_CASHIER | |
| `receive` | SENT_TO_CASHIER → CASHIER_RECEIVED | CASHIER | `cashierReceivedAt` | CASHIER_RECEIVED | |
| `scan` | CASHIER_RECEIVED → CASHIER_SCAN | CASHIER | `cashierScanAt` | CASHIER_SCANNED | |
| `bill` | CASHIER_SCAN → BILL_OPENED | CASHIER | `billOpenedAt` | BILL_OPENED | |
| `complete` | BILL_OPENED → COMPLETED | CASHIER | — | COMPLETED | terminal |

**Race caveat (H-01).** `getById()` reads the session *before* `$transaction` starts, and the
update is `where: { id }` only. Two concurrent requests can both pass the `state === from`
check, so a double-clicked `found` deducts stock twice, writes two events and overwrites the timestamp.

## 2. Other session endpoints

Controller: `apps/api/src/sessions/sessions.controller.ts`. Service: `sessions.service.ts`.

| Endpoint (controller line) | Service (line) | Who | Allowed when | Effect |
| --- | --- | --- | --- | --- |
| `GET /sessions?branchId=` (:32) | `list` (:127) | any role | — | Non-ADMIN is forced to their own branch. ADMIN may filter by branch UUID **or code**. Returns **every** session of the branch (all dates) with all child rows and events, newest first. No paging (H-06). |
| `GET /sessions/:id` (:41) | `getById` (:173) | branch-scoped | — | `:id` may be the UUID **or** the `SES-…` reference |
| `POST /sessions` `{branchId?}` (:47) | `createWalkIn` (:211) | STAFF | an active branch exists | New session in WALK_IN, reference `SES-YYYYMMDD-NNNNNN` (H-05), event SESSION_CREATED. ADMIN: `dto.branchId` → own branch → **first active branch by code** (silent fallback, `:225-230`) |
| `POST /sessions/:id/decision/not-buy` `{reason, otherReason?}` (:63) | `recordNotBuy` (:361) | STAFF | state DECISION, not finished | `outcome=NOT_BUY`, `decisionAt`, event DECISION_MADE `{outcome, reason}`. `otherReason` is required when reason = `อื่น ๆ`. The reason value is not checked against the fixed list. |
| `PUT /sessions/:id/selection` (:73) | `updateSelection` (:411) | STAFF | `!confirmed && !outcome && (PRODUCT_SELECTION \|\| (DECISION && decisionAt))` | Upserts Customer by phone. Replaces each provided child list wholesale (drops `None`; payments are not filtered). Resolves `skuId` (UUID or SKU code) → model → product. **No event, no timestamp.** No inventory or `active` check on the SKU (H-10). |
| `POST /sessions/:id/confirm` (:83) | `confirmPurchase` (:580) | STAFF | PRODUCT_SELECTION, not confirmed, phone is 10 digits, sku or product set | `confirmed=true`, → **STOCK_REQUESTED**, `productSelectionConfirmedAt`, event PRODUCT_SELECTION_CONFIRMED (this is also the stock request, D51) |
| `POST /sessions/:id/out-of-stock` `{action:'cancel'\|'partial', outOfStockItems?, reason?, otherReason?, note?}` (:89) | `recordOutOfStock` (:632) | STOCK | SEARCHING | **partial**: drops the listed accessories (by name); if the main product is listed (`'MAIN_PRODUCT'`, SKU code or product name) it clears product/model/sku and sets stock to 0, otherwise stock −1; → FOUND, `stockFoundAt`, STOCK_FOUND `{partialFulfillment:true}`. **cancel/default**: SKU stock set to 0, `outcome=OUT_OF_STOCK`, `reason` defaults to `'OUT_OF_STOCK'`, event STOCK_OUT_OF_STOCK |
| `POST /sessions/:id/cancel` `{reason, otherReason?}` (:99) | `cancelSession` (:774) | role by stage, see below | not finished | `outcome=CUSTOMER_CANCELLED`, `cancelledAt`, `cancelledBy`, event CUSTOMER_CANCELLED. **+1 stock** if `stockFoundAt` is set or the state is FOUND or later |
| `POST /sessions/:id/stock/report-missing` `{missingItems[], foundItems?, stockNote?}` (:109) | `reportStockMissing` (:848) | STOCK | STOCK_REQUESTED or SEARCHING | Writes the `stockReview` JSON `{missingItems, foundItems, stockNote, reportedAt, reportedBy}`, event STOCK_REPORTED_MISSING. **State unchanged.** Sets SKU stock to 0 if the main product is missing (matched by `'สินค้าหลัก'`, model name, SKU name or SKU code) |
| `POST /sessions/:id/staff/resolve-stock-review` `{action, reason?, otherReason?}` (:119) | `resolveStockReview` (:934) | creator Staff (`session.staffId === actor`), branch MANAGER, or ADMIN; **no role needed** | `stockReview` set, not finished | `ACCEPT_PARTIAL`: drop missing accessories (strips the ` (xN)` suffix), clear the main product if missing (else stock −1), → FOUND, events STAFF_RESOLVED_STOCK_REVIEW + STOCK_FOUND. `CHANGE_ITEMS`: → PRODUCT_SELECTION, `confirmed=false` (reopens the purchase). `CANCEL`: outcome CUSTOMER_CANCELLED + 2 events. All three clear `stockReview` with `null as unknown as undefined` (H-08) |
| `POST /sessions/:id/manager/acknowledge-alert` (:129) | `acknowledgeAlert` (:1181) | branch MANAGER or ADMIN | any | Merges `acknowledgedAt/By` into `stockReview`. **No transaction, no event.** |

### Cancellation role by stage (`sessions.service.ts:781-788`)

| Current state | Role checked |
| --- | --- |
| DEMO, PRODUCT_SELECTION | STAFF |
| STOCK_REQUESTED, SEARCHING, FOUND | **STOCK** |
| SENT_TO_CASHIER, CASHIER_RECEIVED, CASHIER_SCAN, BILL_OPENED | **CASHIER** |
| WALK_IN, DECISION | **none**: any authenticated user of that branch (H-13) |

## 3. Catalog and inventory endpoints

Controller: `apps/api/src/products/products.controller.ts`. Service: `products.service.ts`.

| Endpoint (line) | Who | Effect |
| --- | --- | --- |
| `GET /products?admin=true&branchId=` (:50) | any | `admin=true` + ADMIN/MANAGER → `findAllAdmin` (MANAGER forced to own branch). ADMIN + `branchId` → `findByBranch`. ADMIN → `findAll`. Branch user → `findByBranch(own)`, which runs `syncBranchInventory()` on **every call** (H-17) and returns only active products/models/SKUs with an active inventory row, plus `stock` and `branchActive` |
| `GET /products/inventory?branchId=` (:79) | ADMIN, MANAGER (own branch) | raw BranchInventory list |
| `PUT /products/branches/:branchId/skus/:skuId/stock` `{stock}` (:96) | ADMIN | **absolute** upsert of the quantity. No event or audit row (H-07) |
| `PUT /products/branches/:branchId/skus/:skuId/active` `{active}` (:108) | ADMIN, MANAGER (own branch) | upsert `active` |
| `POST /products`, `PUT /products/:id` (:120, :127) | ADMIN | `active=false` cascades to models, SKUs and all BranchInventory rows (`:415-446`); reactivation does not cascade (D42) |
| `POST /products/:id/models`, `PUT /products/models/:modelId` (:138, :149) | ADMIN | the same cascade from the model down |
| `POST /products/models/:modelId/skus`, `PUT /products/skus/:skuId` (:160, :171) | ADMIN | the same cascade from the SKU to its inventory rows |

`ProductsService.onModuleInit()` (`:9-12`) **seeds a demo catalog when the Product table is
empty** (production included), then back-fills BranchInventory rows. Both swallow errors.

## 4. Account endpoints (`apps/api/src/accounts/accounts.controller.ts`)

The only controller wrapped in `OriginGuard` (`:36-54`, `@UseGuards` at `:57`): a non-GET request
needs `Origin ∈ CORS_ORIGINS` **and** `X-Requested-With: ServiceEfficiency`, otherwise it gets
403 `Invalid request origin` (see docs/coolify-deployment.md).

`POST /auth/login` (:73) · `GET /auth/me` (:82) · `POST /auth/logout` (:87) ·
`POST /auth/password` (:96) · `GET|POST /staff` (:110, :113) · `PUT /staff/:staffId` (:119) ·
`POST /staff/:staffId/reset-password` (:126) · `GET|POST /branches` (:133, :136) ·
`PUT /branches/:id` (:142) · `GET /admin/audit-logs?limit=` (:149, ADMIN only, max 500 events).

ERP import (D53/D54), ADMIN only, behind `OriginGuard`: `GET /admin/erp-sync/status` (configured, schedule, next run, last 10 runs),
`POST /admin/erp-sync/run?dryRun=true|false&force=true|false&wait=true|false` (starts a run and returns at once; `dryRun` rolls everything back;
`force` lifts the mass-deactivation guard; `wait` is for tests). Synced accounts: `PUT /staff/:id` may only change ADMIN/MANAGER roles (409 otherwise),
`/auth/password` is 403 and reset-password 409; ERP-linked branches reject `PUT /branches/:id` (409).

Policies (all **[built]** and covered by `apps/api/tests/accounts.test.mjs`): scrypt hashes
(`password.ts`); 8 h idle timeout (`IDLE_MS`); 5 failed logins → 15 min lock (`accounts.service.ts:127-132`);
forced password change; reset or deactivation revokes all sessions; last active ADMIN protected;
MANAGER manages only STAFF/STOCK/CASHIER in their own branch (D39).

## 5. Code vs the Phase-1 design docs

| Topic | docs say | code does |
| --- | --- | --- |
| Terminal representation (OQ-04) | open: CLOSED + outcome or per-outcome states | state stays put + nullable `outcome`; no CLOSED state |
| CONFIRMATION state (OQ-05) | conceptual review state | UI step only; `confirmed` boolean; confirm = stock request (D51) |
| Event vocabulary | D27 list incl. `STOCK_REQUESTED` (erd.md) | 17 values: no `STOCK_REQUESTED`; adds `STOCK_REPORTED_MISSING`, `STAFF_RESOLVED_STOCK_REVIEW` |
| STAFF cancel in Stock/Cashier stages | confirmed YES (state-machine.md, permissions.md) | needs the STOCK or CASHIER role (H-13) |
| Cancel at WALK_IN / DECISION | not in the confirmed flow | allowed with no role check (H-13) |
| Backward transition after confirmation | forbidden (§22) | D40 `CHANGE_ITEMS` reopens the purchase |
| STAFF history visibility (D3) | not allowed | the API returns all branch sessions; only the UI filters (H-06) |
| Duplicate/concurrent clicks | must not double-apply | can double-apply (H-01) |
| Who records the decision (OQ-05) | open | STAFF (`buy`, `not-buy`) |
| Phone uniqueness (OQ-09) | open | `Customer.phone @unique`; the session keeps its own copy |
