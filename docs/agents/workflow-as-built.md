# Workflow as built: the API contract of the CustomerSession lifecycle

What the code **actually does** today (`main` @ `ecd82e0` plus the D56/D57 change, 2026-10-13). The design intent is in
[docs/state-machine.md](../state-machine.md) and [docs/permissions.md](../permissions.md); both
were written in Phase 1 and are older than this code. Where they disagree, the differences
are listed in §5. Vocabulary: [CONTEXT.md](../../CONTEXT.md).

All paths below have the global prefix `/api` (`apps/api/src/bootstrap.ts:11`), except `GET /health`.
Every handler first calls `AccountsService.authenticate(req)` (cookie `se_session`), so
**every endpoint requires a valid Login Session** and the actor is always the cookie's Staff.

## 1. The step table (`POST /api/sessions/:id/step` `{ action }`)

Source: the `STEPS` map in `apps/api/src/sessions/sessions.service.ts`, executed by
`advanceStep()`. Guards: the session is not finished (`outcome` null and state ≠
`COMPLETED`), the actor has `requiredRole` (**ADMIN always passes**, see `checkRole`) and `state === from`.

| action | from → to | role | timestamp column | event | side effect |
| --- | --- | --- | --- | --- | --- |
| `startDemo` | WALK_IN → DEMO | STAFF | `demoStartAt` | DEMO_STARTED | none (the one-DEMO-per-Staff rule is **not** checked, H-04) |
| `endDemo` | DEMO → DECISION | STAFF | `demoEndAt` | DEMO_ENDED | |
| `buy` | DECISION → DECISION | STAFF | `decisionAt` | DECISION_MADE | records BUY; the state does not move |
| `startSelection` | DECISION → PRODUCT_SELECTION | STAFF | `productSelectionStartAt` | PRODUCT_SELECTION_STARTED | requires `decisionAt` |
| `search` | STOCK_REQUESTED → SEARCHING | STOCK | `stockStartedAt` | STOCK_SEARCHING | the web sends it from the queue card's "รับงาน" (D101/D102); opening a card does not |
| `found` | SEARCHING → FOUND | STOCK | `stockFoundAt` | STOCK_FOUND `{deducted}` | **D111:** the web no longer sends it (no "found" tick, no FOUND stage; `send` records FOUND itself); kept for screens open from before (the server does not check the serials here; "send" does). **BranchInventory.stock −quantity** for each item (D61), no floor (H-07), **unless "stock unlimited" is on (D59)**; each item's `deducted` records what was really taken, `metadata.deducted` is the total |
| `send` | SEARCHING or FOUND → SENT_TO_CASHIER | STOCK | from SEARCHING: `stockFoundAt` = the last scan | from SEARCHING: STOCK_FOUND `{deducted}` at the last scan, then STOCK_SENT_TO_CASHIER | **D111:** from SEARCHING it also does what `found` did (shelf deduction, FOUND at the time the last unit was scanned, clamped to `stockStartedAt`..now); FOUND still sends (an order accepted short, D73). **D101:** body `{action:'send'}` uses the serials STOCK scanned one by one (`POST /sessions/:id/serials`) and needs exactly `quantity` per main product (400 otherwise). **D111:** no send with serials missing (D103's `serialsLater:true` is refused with a Thai 400 for screens left open from before). **D92:** a body with `serials:[{itemId, sn:[…]}]` replaces them instead: exactly `quantity` per main product, none twice, none in another open order (409); saved in `SessionItemSerial`; a cashier reject (F13) clears them, a product swap clears that product's. Also queues the FileMaker message (D88) |
| `complete` | SENT_TO_CASHIER / CASHIER_RECEIVED / CASHIER_SCAN / BILL_OPENED → COMPLETED | **ADMIN** | — | COMPLETED | terminal. **D105:** ADMIN's fallback ("ปิดการขาย (แทน U POS)" on the history page) when U POS reports no payment; normally U POS completes the order through the POS door with `completedAt` (D101, event by `U-POS` at the POS time). `receive` / `scan` / `bill` were removed with the SES cashier screen (D105): U POS opens the bill (`POST /integrations/pos/bills`) |

**Double clicks (H-01, fixed by D99).** Each step claims the session row inside its transaction (`SELECT … FOR UPDATE` under the
step's own precondition), so a second click or a retry gets 409 instead of applying the step twice.

## 2. Other session endpoints

Controller: `apps/api/src/sessions/sessions.controller.ts`. Service: `sessions.service.ts` (cited by method name: line numbers drift).
Every endpoint returns the session in **one shape** (`sessionInclude`: branch, staff, `customerType`, `items` each with its sku → model → product, accessories, ontop, points, burnPoints, payments, events) including `queueLetter` / `queueNo` (H-19 fixed).

| Endpoint | Service method | Who | Allowed when | Effect |
| --- | --- | --- | --- | --- |
| `GET /sessions?branchId=` | `list` | any role | — | Non-ADMIN is forced to their own branch. ADMIN may filter by branch UUID **or code**. Returns **every** session of the branch (all dates) with all child rows and events, newest first. No paging (H-06). |
| `GET /sessions/:id` | `getById` | branch-scoped | — | `:id` may be the UUID **or** the `SES-…` reference (the reference is the internal key, D57) |
| `POST /sessions` `{phone, customerTypeId?, branchId?}` | `createWalkIn` | STAFF | an active branch exists, `phone` = exactly 10 ASCII digits, the type (default: the active type with the lowest letter) is active | One transaction at **READ COMMITTED** (ADR 0001): upserts the Customer by phone (D56), takes the queue number (`QueueService.allocate`: per branch, per type letter, per Bangkok day) and a `reference` (`SES-YYYYMMDD-NNNNNN`, Bangkok day, an already-taken number is skipped), creates the session directly in **PRODUCT_SELECTION** (D68) with `phone`, `customerId`, `customerTypeId`, `queueLetter`, `queueNo`, `customerWalkInAt`, `productSelectionStartAt`, events `SESSION_CREATED` `{queue}` and `PRODUCT_SELECTION_STARTED`. The client can send neither the queue number nor the reference (400). ADMIN: `dto.branchId` → own branch → **first active branch by code** (silent fallback, H-20) |
| `POST /sessions/:id/decision/not-buy` `{reason, otherReason?}` | `recordNotBuy` | STAFF | state DECISION, not finished | `outcome=NOT_BUY`, `decisionAt`, event DECISION_MADE `{outcome, reason}`. `otherReason` is required when reason = `อื่น ๆ`. The reason value is not checked against the fixed list. |
| `PUT /sessions/:id/selection` | `updateSelection` | STAFF | `!confirmed && !outcome && (PRODUCT_SELECTION \|\| (DECISION && decisionAt))` | Upserts Customer by phone. **`items`** (D61) = the main products as a whole list `[{skuId (id or SKU code), quantity ≥ 1}]` replaced in one go (a save without `items` leaves them alone, `[]` clears them; an unknown SKU, a quantity below 1 or a SKU twice is a 400; the old `skuId/modelId/productId` fields are refused). Replaces each other provided child list wholesale (drops `None`; payments are not filtered). **No event, no timestamp.** No `active` or inventory check on the SKU (H-10). |
| `POST /sessions/:id/confirm` | `confirmPurchase` | STAFF | PRODUCT_SELECTION, not confirmed, phone is 10 digits, at least one item | `confirmed=true`, → **STOCK_REQUESTED**, `productSelectionConfirmedAt`, event PRODUCT_SELECTION_CONFIRMED (this is also the stock request, D51) |
| `POST /sessions/:id/serials` `{itemId, sn}` | `addSerial` | STOCK (ADMIN) | SEARCHING or FOUND, not ended | **D101:** one scanned serial of one main product, saved at once with the server time (`createdAt`), trimmed and in capitals, next `position`. 400: bad serial, unknown item, a repeat in the order, more than the quantity; 409: the unit is in another open order. Returns the session |
| `DELETE /sessions/:id/serials/:serialId` | `removeSerial` | STOCK (ADMIN) | SEARCHING or FOUND, not ended | **D101:** takes back a wrong scan (404 if it is not this order's). Returns the session |
| `GET /stock/serial-check?sn=&part=&branch=` | `SerialCheckService.check` (warroom module) | STOCK, STAFF, ADMIN (`branch` = code, ADMIN only) | — | **D104/D111:** one serial against FileMaker live, only with `SERIAL_CHECK=fmp` (off by default; warroom is no longer a source): verdict `here` / `not-ready` (+status) / `other-branch` (+branch) / `other-model` / `not-in-stock`, with `source` and `asOf`. 200 `{status:'off'\|'unavailable', reason}` when it cannot check. Never blocks a step |
| `POST /sessions/:id/out-of-stock` `{action:'cancel'\|'partial', outOfStockItems?, reason?, otherReason?, note?}` | `recordOutOfStock` | STOCK | SEARCHING | **partial**: drops the listed accessories (by name); the items named by `'MAIN_PRODUCT'` (all), their SKU code or product name are deleted and their SKU stock set to 0; the rest is taken off the shelf (D59 permitting); → FOUND, `stockFoundAt`, STOCK_FOUND `{partialFulfillment:true, deducted}`. **cancel/default**: every item's SKU stock set to 0, `outcome=OUT_OF_STOCK`, `reason` defaults to `'OUT_OF_STOCK'`, event STOCK_OUT_OF_STOCK (the web never calls this endpoint, it uses report-missing) |
| `POST /sessions/:id/cancel` `{reason, otherReason?}` | `cancelSession` | **any role of the branch** (D63) | not finished | `outcome=CUSTOMER_CANCELLED`, `cancelledAt`, `cancelledBy`, event CUSTOMER_CANCELLED. **+`deducted` units back per item** (exactly what FOUND took). After the stock request the cancel is a notice for stock: `stockAckAt` stays null until acknowledged, except when a STOCK user cancels before anything was picked (acknowledged at once) |
| `POST /sessions/:id/stock/acknowledge-cancel` | `acknowledgeStockCancel` | STOCK, branch MANAGER, ADMIN | cancelled after the stock request, not yet acknowledged (else 400) | sets `stockAckAt/By`, event STOCK_ACKNOWLEDGED_CANCEL (D63) |
| `POST /sessions/:id/cashier/reject` `{reason, otherReason?}` | `cashierReject` | **STAFF** (D105; the path keeps its old name) | SENT_TO_CASHIER, CASHIER_RECEIVED or CASHIER_SCAN | the units FOUND took go back to the shelf, `state=SEARCHING`, `stockFoundAt` / `cashierReceivedAt` / `cashierScanAt` cleared, event CASHIER_REJECTED `{reason, otherReason, fromState}` (D64) |
| `POST /sessions/:id/rebuy` | `rebuy` | STAFF | cancelled with one of the four change reasons and not bought again (else 400 / 409) | a NEW session in PRODUCT_SELECTION with the old customer, type, queue letter and number, items, accessories, Ontop, Points, Burn Points, payments; `decisionAt` and `productSelectionStartAt` = now; `rebuyOfId` = the old one; events SESSION_CREATED `{queue, rebuyOf}` + PRODUCT_SELECTION_STARTED (D65) |
| `POST /sessions/:id/stock/report-missing` `{missingItems[], missingItemIds?[], foundItems?, stockNote?}` | `reportStockMissing` | STOCK | STOCK_REQUESTED or SEARCHING | Writes the `stockReview` JSON `{missingItems, foundItems, stockNote, reportedAt, reportedBy, missingItemIds}`, event STOCK_REPORTED_MISSING. `missingItemIds` = the `SessionItem.id`s of the missing main products (D61; an id that is not an item of this session is a 400; left out, they are matched by name like before: `'สินค้าหลัก'`, model, SKU name or code). **State unchanged.** Sets the branch stock of every missing item's SKU to 0 (D41). |
| `POST /sessions/:id/staff/resolve-stock-review` `{action, reason?, otherReason?}` | `resolveStockReview` | creator Staff (`session.staffId === actor`), branch MANAGER, or ADMIN; **no role needed** | `stockReview` set, not finished | `ACCEPT_PARTIAL`: drop missing accessories (strips the ` (xN)` suffix) and the missing items (`missingItemIds`; a review without ids is matched by name), take the remaining items off the shelf, → FOUND, events STAFF_RESOLVED_STOCK_REVIEW + STOCK_FOUND `{deducted}`. `CHANGE_ITEMS`: drop the same, → PRODUCT_SELECTION, `confirmed=false` (reopens the purchase). `CANCEL`: outcome CUSTOMER_CANCELLED + 2 events. All three clear `stockReview` with `null as unknown as undefined` (H-08) |
| `POST /sessions/:id/manager/acknowledge-alert` | `acknowledgeAlert` | branch MANAGER or ADMIN | any | Merges `acknowledgedAt/By` into `stockReview`. **No transaction, no event.** |

### Cancellation (D63)

Any role of the branch can cancel any session that has not ended, at any stage (the stage-based role table of the first release, H-13, is gone). Only `getById`'s branch check applies: another branch gets 403.

### Payment methods (F6, D66)

Controller: `apps/api/src/payments/payments.controller.ts` (behind `OriginGuard`). Service: `payments.service.ts`.

| Endpoint | Who | Effect |
| --- | --- | --- |
| `GET /payment-methods` | any signed-in role | the **active** methods in display order; ADMIN with `?all=true` also gets the switched-off ones |
| `POST /payment-methods` `{name}` | ADMIN | appended at the end; a name is used once, the database compares without regard to case (409) |
| `PUT /payment-methods/:id` `{active}` | ADMIN | switch on / off; the name cannot be sent (400); the last active method cannot be switched off (400) |
| `POST /payment-methods/:id/move` `{direction: 'up'\|'down'}` | ADMIN | swaps with the neighbour in the full list and renumbers 1..n |

### Settings (D59)

Controller: `apps/api/src/settings/settings.controller.ts` (behind `OriginGuard`). Service: `settings.service.ts` (`stockUnlimited(db?)` reads inside a transaction).

| Endpoint | Who | Effect |
| --- | --- | --- |
| `GET /settings` | any signed-in role | `{ stockUnlimited }`; ADMIN also gets `updatedAt` / `updatedBy` (no row yet = on, `updatedBy` null) |
| `PUT /settings` `{ stockUnlimited: boolean }` | ADMIN | upserts the row; a non-boolean, a missing field or an unknown field is a 400 |

### Customer types (D57)

Controller: `apps/api/src/queue/queue.controller.ts` (behind `OriginGuard`). Service: `queue.service.ts`.

| Endpoint | Who | Effect |
| --- | --- | --- |
| `GET /customer-types` | any signed-in role | the **active** types in letter order; ADMIN with `?all=true` also gets the switched-off ones |
| `POST /customer-types` `{letter?, name, description?}` | ADMIN | `letter` A-Z (lower case is upper-cased), unique (409); left out = the next free letter (400 when all 26 are used) |
| `PUT /customer-types/:id` `{name?, description?, active?}` | ADMIN | the letter cannot be sent (400): queue numbers already given out carry it. Switching off the last active type is refused (400). No delete. |

## 3. Catalog and inventory endpoints

Controller: `apps/api/src/products/products.controller.ts`. Service: `products.service.ts`.

| Endpoint (line) | Who | Effect |
| --- | --- | --- |
| `GET /products?admin=true&branchId=` (:50) | any | `admin=true` + ADMIN/MANAGER → `findAllAdmin` (MANAGER forced to own branch). ADMIN + `branchId` → `findByBranch`. ADMIN → `findAll`. Branch user → `findByBranch(own)`, which runs `syncBranchInventory()` on **every call** (H-17) and returns only active products/models/SKUs with an active inventory row, plus `stock`, `stockSource` (`unlimited` while the D59 switch is on, `erp` in mode `on` with ERP data, else `manual`), `erpAsOf` and `branchActive` |
| `GET /products/inventory?branchId=` (:79) | ADMIN, MANAGER (own branch) | raw BranchInventory list |
| `PUT /products/branches/:branchId/skus/:skuId/stock` `{stock}` (:96) | ADMIN | **absolute** upsert of the quantity. No event or audit row (H-07) |
| `PUT /products/branches/:branchId/skus/:skuId/active` `{active}` (:108) | ADMIN, MANAGER (own branch) | upsert `active` |
| `POST /products`, `PUT /products/:id` (:120, :127) | ADMIN | `active=false` cascades to models, SKUs and all BranchInventory rows (`:415-446`); reactivation does not cascade (D42) |
| `POST /products/:id/models`, `PUT /products/models/:modelId` (:138, :149) | ADMIN | the same cascade from the model down |
| `POST /products/models/:modelId/skus`, `PUT /products/skus/:skuId` (:160, :171) | ADMIN | the same cascade from the SKU to its inventory rows |

`ProductsService.onModuleInit()` back-fills BranchInventory rows (the demo catalog it used to
seed when the Product table was empty was removed in D73). Errors are swallowed.

## 4. Account endpoints (`apps/api/src/accounts/accounts.controller.ts`)

The only controller wrapped in `OriginGuard` (`:36-54`, `@UseGuards` at `:57`): a non-GET request
needs `Origin ∈ CORS_ORIGINS` **and** `X-Requested-With: ServiceEfficiency`, otherwise it gets
403 `Invalid request origin` (see docs/coolify-deployment.md).

`POST /auth/login` (:73) · `GET /auth/me` (:82) · `POST /auth/logout` (:87) ·
`POST /auth/password` (:96) · `GET|POST /staff` (:110, :113) · `PUT /staff/:staffId` (:119) ·
`POST /staff/:staffId/reset-password` (:126) · `GET|POST /branches` (:133, :136) ·
`PUT /branches/:id` (:142) · `PUT /branches/:id/registration-url` `{url\|null}` (ADMIN; F10, D67: also on ERP-managed branches; http(s) only, ≤ 512 characters) · `GET /admin/audit-logs?limit=` (:149, ADMIN only, max 500 events).

ERP import (D53/D54), ADMIN only, behind `OriginGuard`: `GET /admin/erp-sync/status` (configured, schedule, next run, last 10 runs),
`POST /admin/erp-sync/run?dryRun=true|false&force=true|false&wait=true|false` (starts a run and returns at once; `dryRun` rolls everything back;
`force` lifts the mass-deactivation guard; `wait` is for tests). Synced accounts: `PUT /staff/:id` may only change ADMIN/MANAGER roles (409 otherwise),
`/auth/password` is 403 and reset-password 409; ERP-linked branches reject `PUT /branches/:id` (409).

Policies (all **[built]** and covered by `apps/api/tests/accounts.test.mjs`): scrypt hashes
(`password.ts`); 8 h idle timeout (`IDLE_MS`); 5 failed logins → 15 min lock (`accounts.service.ts:127-132`);
forced password change; reset or deactivation revokes all sessions; last active ADMIN protected;
MANAGER manages only STAFF/STOCK in their own branch (D39; CASHIER is no longer given, D105).

## 5. Code vs the Phase-1 design docs

| Topic | docs say | code does |
| --- | --- | --- |
| Terminal representation (OQ-04) | open: CLOSED + outcome or per-outcome states | state stays put + nullable `outcome`; no CLOSED state |
| CONFIRMATION state (OQ-05) | conceptual review state | UI step only; `confirmed` boolean; confirm = stock request (D51) |
| Event vocabulary | D27 list incl. `STOCK_REQUESTED` (erd.md) | 19 values: no `STOCK_REQUESTED`; adds `STOCK_REPORTED_MISSING`, `STAFF_RESOLVED_STOCK_REVIEW`, `CASHIER_REJECTED`, `STOCK_ACKNOWLEDGED_CANCEL` |
| Who can cancel (state-machine.md, permissions.md) | stage-based: STAFF in DEMO..CASHIER, others by stage | any role of the branch at any stage (D63) |
| Cancel at WALK_IN / DECISION | not in the confirmed flow | allowed, by any role of the branch (D63) |
| Backward transition after confirmation | forbidden (§22) | D40 `CHANGE_ITEMS` reopens the purchase; D64 the cashier can send the order back to the stock stage |
| STAFF history visibility (D3) | not allowed | the API returns all branch sessions; only the UI filters (H-06) |
| Duplicate/concurrent clicks | must not double-apply | can double-apply (H-01) |
| Who records the decision (OQ-05) | open | STAFF (`buy`, `not-buy`) |
| Phone uniqueness (OQ-09) | open | `Customer.phone @unique`; the session keeps its own copy |
| Phone timing (requirements §6, erd.md) | only after BUY, never at walk-in or NOT_BUY | at walk-in (D56): NOT_BUY and cancelled visits keep the phone |
| Session number shown to staff (D6, OQ-08) | `SES-YYYYMMDD-NNNNNN` | the queue number "คิว A012" (D57); the reference stays internal. Bangkok day (H-05 fixed) |
