# CONTEXT — Service Efficiency domain language and model

The shared vocabulary and domain model for this repo. Read it before a grilling, design or
refactor session, and keep it current: when a term is sharpened or an entity changes, update
this file in the same change. Decisions live in [docs/decisions.md](docs/decisions.md) (D1–D74);
unresolved items live in [docs/open-questions.md](docs/open-questions.md) (OQ-xx).

> **Status labels in this file.** **[built]** = verified in code (file:line cited).
> **[documented]** = stated in docs/decisions but not, or not fully, enforced by the code.
> **[OPEN]** = no decision yet. If code and docs disagree, the entry says so and points to
> [docs/agents/hazards.md](docs/agents/hazards.md).
> Last verified against `main` @ `ecd82e0` plus the D56/D57/D68/D69/D70/D71/D72/D73/D74 changes (2026-10-14).

## 1. What the system is for

Retail branches (Apple-product stores, UI in Thai) record every customer visit as a
**Customer Session**, from walk-in through DEMO, decision, product selection, a stock search
and the cashier, with a server timestamp at each step. The raw timestamps are kept for future
service-efficiency analysis (the KPI formulas are not defined yet, OQ-11). Production:
`https://ses.uficon.com` (Coolify). The repo name "service-efficiency" is the product name.

## 2. Glossary

### 2.1 Words that mean different things in different places (read these first)

| Word | Meanings in this codebase | Rule |
| --- | --- | --- |
| **Session** | (a) **Customer Session** (`CustomerSession`), the business object. (b) **Login Session** (`LoginSession`), a cookie-auth record with an 8-hour idle timeout. | Always qualify: "Customer Session" or "Login Session". The API's `/sessions` = Customer Sessions; `/auth/*` = Login Sessions. |
| **Stock** | (a) the **STOCK role** (warehouse/back-room staff). (b) the **Stock stage** of the workflow (`STOCK_REQUESTED`→`SENT_TO_CASHIER`). (c) `BranchInventory.stock`, an on-hand **quantity**. | Say "STOCK role", "stock stage", "stock quantity". |
| **Accessories** | (a) **accessory options**: the fixed list (`Apple Pencil`, `Case`, …) stored as free text in `SessionAccessory.accessoryName` with a quantity. (b) the `Accessories` value of **ProductCategory** (D46), a real catalog LOB with SKUs and branch stock. | Main-device tabs exclude `Accessories` (D48); session add-ons are (a). They are not linked: an accessory option has no SKU or inventory row. |
| **Reason** | `CustomerSession.reason` / `otherReason` hold the **NOT_BUY result**, the **cancellation reason** *or* the **out-of-stock reason**, whichever ended the session. | docs/erd.md says NOT_BUY text and cancellation text "must not be merged". Code merges them into one column pair; `outcome` tells which one it is. See H-12. |
| **Active** | `Staff.active`, `Branch.active` (account admin); `Product/ProductModel/ProductSku.active` (master catalog, cascades down, D42); `BranchInventory.active` (per-branch visibility, a.k.a. `branchActive` in API output). | A SKU is selectable by branch staff only if it, its model and its product are active **and** its `BranchInventory` row is active **and** stock > 0 (D41). |
| **Confirmed / Confirmation** | `CustomerSession.confirmed` (boolean) + `productSelectionConfirmedAt`. Accepting the confirmation **is** the stock request (D51): one action, one timestamp. | There is no persisted `CONFIRMATION` state and no `stock_requested_at` (D51). |
| **Closed / Finished / Terminal** | Code has no `CLOSED` state. A session is finished when `outcome IS NOT NULL` **or** `state = COMPLETED`. | Docs' "CLOSED" = state + non-null `outcome` (this settles the representation part of OQ-04). |
| **Partial** | (a) STOCK's `POST /out-of-stock` with `action:'partial'`: STOCK alone drops the missing items and moves to `FOUND`. (b) D40's `ACCEPT_PARTIAL`: STAFF resolves a stock review after asking the customer. | Two paths for the same business event. See H-09. |

### 2.2 Core terms

| Term (UI / Thai) | Meaning | Code |
| --- | --- | --- |
| Customer Session | One customer visit in one Branch. Created at walk-in from the customer's phone number (D56, D68, D70); the product is chosen next and the queue number is issued at order confirmation (D70). | `CustomerSession` (`schema.prisma`) |
| Session Reference | Internal key `SES-YYYYMMDD-NNNNNN` (Bangkok day, one running number for all branches, D6). Used for lookups, deep links and React keys; **not shown to staff** since D57. | `CustomerSession.reference`, allocated in `createWalkIn` from a `DailyCounter` row (ADR 0001, H-05 fixed). |
| Queue number / คิว | What staff call the customer by: the customer type's letter + a running number per branch, per letter, per Bangkok day (`A012`, `B003`; four digits after 999). Allocated upon order confirmation (D70); prior to confirmation, the customer's phone number is shown instead. Sessions from before D57 have no letter ("คิว 007"). Not unique: a re-buy will keep the old number (F11). | `CustomerSession.queueLetter` / `queueNo`, allocated by `QueueService.allocate` at confirmation; label built by `formatQueue` (API and web) |
| Customer type / ประเภทลูกค้า | Back-office list (ADMIN): letter A-Z (unique, never changes, the sort order), name, description, active, paymentMethods, ontop, points, burnPoints (D70). Seeded A `ลูกค้าทั่วไป`, B `ลูกค้าใช้เวลานาน`. Any configured criterion in Payment, Ontop, Points, or Burn Point classifies the session to Type B upon confirmation (OR logic, D70). Switched off, never deleted; one stays active. | `CustomerType`, `apps/api/src/queue/`, `GET/POST/PUT /api/customer-types`, Admin → "ประเภทลูกค้า (Customer Types)" (D57, D69, D70) |
| Stock unlimited (D59) | One global ADMIN switch (`Setting` row `stockUnlimited`, **on** unless someone turned it off): no SKU is blocked by stock, the screens say "Stock ไม่จำกัด", FOUND takes nothing from the shelf and a cancel gives nothing back. Overrides the ERP numbers while on. | `SettingsService.stockUnlimited`, `GET/PUT /api/settings`, `stockSource` on the branch product list, Admin → ซิงก์ ERP |
| Receipt / พิมพ์ใบเสร็จ (D58, D67) | A browser-printed 80 mm order summary, **no prices**, with the branch's registration QR at the foot. Not a legal receipt (that stays in U POS). Automatically printed upon order confirmation (D70). | `Receipt.tsx` (`ReceiptPrint`, `ReceiptSheet`), print stylesheet, `Branch.registrationUrl`, `utils/qr.ts` |
| U POS door (D60, F17) | Server-to-server routes for U POS (`infouficon/UFPOS`): the orders waiting for a bill at a branch, and the bill it opened (number + real time, `posBillNo` / `posBillOpenedAt`; actor `U-POS`). Bearer key `POS_API_KEY`, 404 when unset. | `apps/api/src/pos/`, `SessionsService.posOrders` / `recordPosBill`, [pos-integration.md](docs/agents/pos-integration.md) |
| Daily counter | One row per counter and Bangkok day (`reference`, `queue:<branchId>:<letter>`), incremented atomically inside the walk-in transaction (READ COMMITTED). | `DailyCounter`, `QueueService.nextNumber` (ADR 0001) |
| Walk-in | Creating the session when the customer is at the counter: phone number in (D56, D68, D70). Starts directly at product selection without customer type selection or queue issuance (D68, D70). | `POST /api/sessions` `{phone, branchId?}` |
| DEMO | Historical only (D68). Formerly staff demonstrating products; now removed from operational workflow. | states `DEMO`; `demoStartAt` / `demoEndAt` (historical) |
| Decision | Historical only (D68). Formerly customer choice after DEMO; now removed from operational workflow. Drop-offs during selection are handled via cancellation (`CUSTOMER_CANCELLED`). | `buy` step sets `decisionAt`; `POST /decision/not-buy` (historical) |
| NOT_BUY result | Exactly: `ราคา`, `ยังไม่ตัดสินใจ`, `เปลี่ยนใจ`, `สินค้าไม่ตรงความต้องการ`, `ต้องการสอบถามราคาหรือรายละเอียดเฉยๆ`, `อื่น ๆ` (+ required text). | `reason` / `otherReason`; lists in `apps/web/src/constants/options.ts` |
| Customer / Phone | Customer master is **only** an ID and a 10-ASCII-digit phone, collected **at walk-in** (D56; supersedes requirements §6 "only after BUY", so NOT_BUY visits keep a phone too). | `Customer.phone` is `@unique` (schema:125), so the "uniqueness" part of OQ-09 is decided in code. The session also copies `phone`. |
| Product Selection / Purchase data | The purchase being assembled: **main product** chosen via cascading dropdowns (Category → Model → Capacity → Color, D72), accessory options with quantity, Ontop, Points, Burn Points, Payments, phone. Editable until confirmation. | `PUT /sessions/:id/selection` |
| Main Product / Session item | Any number per session (D61, supersedes D8): a SKU and a quantity ≥ 1, each SKU once. `deducted` = the units FOUND really took off the shelf (0 while "stock unlimited" is on); a cancel gives back exactly that. The old `productId/modelId/skuId` columns on the session are history only. | `SessionItem` (`items` on every session response); dropped by partial fulfilment or `CHANGE_ITEMS` |
| LOB / Category | `ProductCategory`: `iPhone`, `iPad`, `Mac`, `Watch`, `Accessories`. | enum `ProductCategory` |
| Ontop | Telco/partner add-on (`AIS`, `True`, `CATH`, `KTS`). Multi-select, no amount. | `SessionOntop.name` |
| Points / Burn Point | Loyalty programs earned / redeemed (`MCard`, `The 1`, `UJOY`). Two separate lists. | `SessionPoint`, `SessionBurnPoint` |
| Payment | Payment methods, multi-select, **no amounts**. The choices are the active rows of the back-office list `PaymentMethod` (D66; seeded `Cash`, `Transfer`, `SPayLater`, …; ADMIN adds, switches off, reorders, never renames); a session stores the name. | `SessionPayment.method`, `GET/POST/PUT /api/payment-methods` |
| None | A UI-only "no selection" option. Never persisted: no selection = zero child rows. | filtered in `updateSelection` (`sessions.service.ts`) |
| Stock Request / Stock queue | A confirmed session waiting for STOCK (`STOCK_REQUESTED`, `SEARCHING`, `FOUND`). Queues show **today's** sessions only (D47, UI-side), and exclude sessions returned to Staff under stock review (D73). | |
| SEARCHING / FOUND | STOCK pressed "searching" (sets `stockStartedAt`), then found the items (sets `stockFoundAt` and **deducts each item's quantity** from branch stock, D41, unless the D59 switch is on). | `search`, `found` steps |
| OUT_OF_STOCK | STOCK cannot fulfil; terminal outcome. Sets that SKU's branch stock to 0 (D41). | `POST /out-of-stock` (`action:'cancel'`) |
| Stock Review | D40: STOCK reports **missing items** (`report-missing`) without ending the session; main products are named by `missingItemIds` (D61), accessories by name. A JSON blob (`stockReview`) is stored, STAFF sees an alert and resolves with `ACCEPT_PARTIAL` / `CHANGE_ITEMS` / `CANCEL`. A MANAGER/ADMIN can **acknowledge** the alert (adds `acknowledgedAt/By`, no event). While in review, the session is removed from the Stock queue (D73). | `CustomerSession.stockReview` (Json) |
| Sent to Cashier | STOCK hands the goods to the cashier. No timestamp column; the event time is the record. | `send` step |
| Cashier steps | `รับสินค้า` receive → `Scan` → `เปิดบิล` open bill → separate **COMPLETED** action. No invoice or bill numbers, no FileMaker (D26). Before the bill is open the cashier can send the order back to stock (`ส่งกลับ Stock`, D64) with wrong-item selection and auto-precheck for re-picking (D74). | `receive`, `scan`, `bill`, `complete` steps; `POST /cashier/reject` |
| Cancellation | The customer leaves mid-flow, or changes their mind about the product. **Any role of the branch** can cancel at any stage (D63). Reasons: the fixed list incl. the four change reasons (D65) and `อื่น ๆ` (+ required text). Terminal, no undo (D18–20). Gives back exactly what FOUND took (D41, D59, D61). | `POST /cancel`; `cancelledAt`, `cancelledBy` |
| Stock acknowledgement (D63) | After the stock request, a cancel is a notice for stock (banner on every page for STOCK users, list on the stock page) until a STOCK / branch MANAGER / ADMIN acknowledges ("คืนของเข้าชั้นแล้ว" when the goods had been picked, else "รับทราบ"). Stored on the session. | `stockAckAt` / `stockAckBy`, `POST /stock/acknowledge-cancel`, event `STOCK_ACKNOWLEDGED_CANCEL` |
| Buy again / ซื้อใหม่ (D65) | After a cancel for a change reason: a NEW session with the old data and the **old queue number**, at product selection. Once per cancelled session. | `rebuyOfId` (`rebuyOf` / `rebuiltAs`), `POST /rebuy` |
| Outcome | The terminal result other than COMPLETED: `NOT_BUY`, `OUT_OF_STOCK`, `CUSTOMER_CANCELLED`. | enum `Outcome`, nullable `CustomerSession.outcome` |
| Milestone timestamp | One server-time column per real action (12 columns, listed in §4). Written once, never back-filled for skipped steps, never user-editable. | `*At` columns on `CustomerSession` |
| SessionEvent | Append-only history row per accepted action: `eventType`, trusted `actorStaffId`, server `createdAt`, small JSON `metadata`. | `SessionEvent`; 19 event types |
| Actor | The authenticated Staff member doing an action, always taken from the Login Session and never from the request body. | `PublicAccount.staffId` |
| Branch / Branch Code | A store. Code is not unique-constrained (OQ-09). APIs accept either the UUID or the code as `branchId` (`list` and `createWalkIn` in `sessions.service.ts`). | `Branch` |
| Staff ID | The login username and the primary key of `Staff`. Bootstrap admin is `0001`. | `Staff.staffId` |
| Role | `ADMIN`, `MANAGER`, `STAFF`, `STOCK`, `CASHIER`. A Staff member can hold several; grants are the **union** (D1). | `StaffRole` |
| Branch scope | ADMIN = all branches (no home branch). Everyone else has exactly one home Branch and sees only it (D2, D39). | `checkBranchAccess` (`sessions.service.ts`) |
| Master Catalog | `Product` → `ProductModel` → `ProductSku`. ADMIN-only CRUD. Deactivation cascades down and to all branch rows; reactivation does not cascade (D42). | `products.service.ts:415-530` |
| Branch Inventory | Per Branch × SKU: `stock` quantity + `active`. ADMIN sets the quantity; ADMIN or the branch's MANAGER toggles `active` (D41). Rows are auto-created (stock 0, active) for every Branch × SKU pair. | `BranchInventory`; `syncBranchInventory()` |
| Audit Logs | ADMIN-only merged feed of SessionEvents, recent Login Sessions and stock-review alerts. | `GET /api/admin/audit-logs` (`accounts.service.ts:362`) |
| ERP import / sync run | Daily 10:00 (Bangkok) pull of Branches and Staff from the company ERP (FileMaker OData), D53/D54. One `ErpSyncRun` row per run (scheduled or ADMIN "run now", optional dry run). | `apps/api/src/erp/`, `GET/POST /api/admin/erp-sync/*` |
| ERP-managed account | A `Staff` the import created (`erpStaffId` not null; `erpManaged` in the API). The ERP owns its password, name, branch, active flag and STAFF/STOCK/CASHIER roles; ADMIN/MANAGER roles stay manual; change/reset password is refused. Accounts without `erpStaffId` (hand-made, tests, `0001`) are never touched. | `Staff.erpStaffId` |
| ERP-managed branch | A `Branch` linked to an ERP `branch_id` (`erpBranchId`), only ERP groups `iStudio` and `U-Store`; edited at the ERP only. | `Branch.erpBranchId` |
| warroom / ERP stock | The warroom Postgres (`mart.stock_mv`), filled from the ERP 5 times a day. SES reads it read-only and stores per Branch × SKU `erpReady` (sellable), `erpTransfer` (in transit) and `erpAsOf` (snapshot time). Modes `off` / `shadow` / `on`. | `BranchInventory.erp*`, `apps/api/src/warroom/` |
| Available (ERP) | What staff may promise = `erpReady` − sessions at FOUND since the snapshot (24 h, not completed before `erpAsOf`), 0 after a newer D41 missing/out-of-stock report. Replaces the manual `stock` only in mode `on` and only where ERP data exists. | `availableUnits()` |
| ERP-managed product | `Product`/`ProductModel`/`ProductSku.erpManaged = true`: created by the warroom sync (mode `on`); SKU code = Apple part number. | `erpManaged` |

## 3. Domain model

### 3.1 Entities and relationships (as built, `apps/api/prisma/schema.prisma`)

```text
Branch 1──* Staff                 (Staff.branchId nullable: ADMIN-only has none)
Staff  *──* Role   via StaffRole  (composite PK staffId+roleCode)
Staff  1──* LoginSession          (tokenHash PK, lastSeenAt)
Staff.erpStaffId / Branch.erpBranchId   (null = made by hand; set = kept in sync with the ERP, D53/D54)
BranchInventory.erpReady/erpTransfer/erpAsOf/outOfStockAt   (warroom snapshot numbers, D52/D55; null = manual stock applies)
ErpSyncRun                         (one row per import run; unique kind+slot)
AccountLock                        (single row id=1; global mutex, see H-02)

Product 1──* ProductModel 1──* ProductSku
Branch  1──* BranchInventory *──1 ProductSku   (unique branchId+skuId)

Branch   1──* CustomerSession
Staff    1──* CustomerSession     (staffId = creator / "assigned staff")
Customer 1──* CustomerSession     (customerId set at walk-in since D56; nullable for sessions from before)
CustomerSession 1──* SessionItem *──1 ProductSku   (D61; the old productId/modelId/skuId columns are history only)
CustomerType 1──* CustomerSession  (customerTypeId; the queue letter is copied onto the session)
DailyCounter                       (scope + Bangkok day → lastNo; no foreign keys, see ADR 0001)
CustomerSession 1──* SessionAccessory | SessionOntop | SessionPoint | SessionBurnPoint | SessionPayment
CustomerSession 1──* SessionEvent  (append-only by convention; FK cascades on delete)
```

### 3.2 Aggregates

- **CustomerSession aggregate** = the session + its selection child rows + its events + the
  `stockReview` JSON. All writes go through `SessionsService` and each one is a single
  `$transaction` that updates state and timestamp and appends the event together. Child selection
  rows are replaced wholesale (delete-all then insert) on every selection save.
- **Account aggregate** = Staff + StaffRole + LoginSession, written only through
  `AccountsService.transaction()`, which locks the `AccountLock` row.
- **Catalog aggregate** = Product/Model/SKU (+ cascading `active`). **BranchInventory** is a
  separate per-branch record that the workflow changes as a side effect (FOUND −1, cancel-after-FOUND
  +1, out-of-stock/missing → 0).

### 3.3 Session lifecycle (summary; full table in [docs/agents/workflow-as-built.md](docs/agents/workflow-as-built.md))

```text
WALK_IN → DEMO → DECISION ─(buy: decisionAt)→ DECISION ─(startSelection)→ PRODUCT_SELECTION
  → (confirm) STOCK_REQUESTED → SEARCHING → FOUND → SENT_TO_CASHIER
  → CASHIER_RECEIVED → CASHIER_SCAN → BILL_OPENED → COMPLETED

Terminal outcomes (state stays where it was, outcome is set):
  NOT_BUY            from DECISION
  OUT_OF_STOCK       from SEARCHING
  CUSTOMER_CANCELLED from any non-terminal state, by any role of the branch (D63)
Cashier reject (D64):  SENT_TO_CASHIER|CASHIER_RECEIVED|CASHIER_SCAN ─reject→ SEARCHING
Buy again (D65):       a CUSTOMER_CANCELLED session with a change reason ─rebuy→ a NEW session at PRODUCT_SELECTION (same queue number)
Stock review loop:  STOCK_REQUESTED|SEARCHING ─report-missing→ (stockReview set)
  ─resolve ACCEPT_PARTIAL→ FOUND | CHANGE_ITEMS→ PRODUCT_SELECTION (confirmed=false) | CANCEL→ CUSTOMER_CANCELLED
```

`CHANGE_ITEMS` (D40) and the cashier's reject (D64) are the only backward transitions. `CHANGE_ITEMS`
reopens a confirmed purchase, which departs from the "purchase data immutable after confirmation" rule
(requirements §22); a reject only sends the same order back to the stock stage.

### 3.4 Invariants: documented vs enforced

| # | Invariant (source) | Status |
| --- | --- | --- |
| I-1 | Actor identity comes from the Login Session, never the body (AGENTS rule 8) | **[built]**: every service method takes `user` from `accounts.authenticate(req)` |
| I-2 | Server time is the source of truth (rule 7) | **[built]**: `new Date()` in the service; no client timestamps are accepted |
| I-3 | Each accepted transition writes state + milestone + event atomically | **[built]**: one `$transaction` per action |
| I-4 | Duplicate clicks or concurrent actions cannot double-apply (state-machine.md) | **NOT enforced**: state is checked *outside* the transaction (H-01) |
| I-5 | One active DEMO per Staff (D5) | **NOT enforced** (H-04) |
| I-6 | Purchase data is immutable after confirmation (§22) | **[built]** for `PUT /selection`; deliberately broken by D40 `CHANGE_ITEMS` |
| I-7 | Terminal outcomes are final, no reopen (D7, D20) | **[built]**: every mutating method rejects `outcome != null` / `COMPLETED` |
| I-8 | Phone = exactly 10 ASCII digits, required at walk-in (D56) and again before confirmation | **[built]**: `CreateSessionDto` (`@Matches`), `updateSelection` and `confirmPurchase` (UI also validates) |
| I-9 | ~~Phone collected only after BUY (§6)~~ | **Superseded by D56**: the phone is collected at walk-in. Selection stays editable only in `PRODUCT_SELECTION` or `DECISION` with `decisionAt` set |
| I-10 | Option values come from the fixed lists (D15) | **NOT enforced server-side**: any string is accepted (H-11) |
| I-11 | Selectable SKU: active chain + branch active + stock > 0 (D41), **unless "stock unlimited" is on (D59, the default)** | **UI-only**: `updateSelection` accepts any SKU id or code (H-10) |
| I-12 | Branch stock never negative | **NOT enforced**: `decrement: 1` without a floor (H-07) |
| I-13 | STAFF sees only current work; history is MANAGER (own branch) / ADMIN (D3) | **UI-only**: `GET /sessions` returns all of the branch's sessions to any branch role (H-06) |
| I-14 | Stock/Cashier queues show today only (D47) | **UI-only** filter |
| I-15 | SessionEvents are never updated or deleted (D27) | **[built]** by convention (no code path), but `onDelete: Cascade` from the session |
| I-16 | Last active ADMIN cannot be removed (D39) | **[built]**, covered by a real integration test |
| I-17 | MANAGER alone gets no STAFF/STOCK/CASHIER workflow grants (permissions.md) | **[built]**: `checkRole` requires the role; ADMIN bypasses every role check (`checkRole` in `sessions.service.ts`) |

## 4. Milestone timestamps (12) ↔ events

| Column | Set by | Event |
| --- | --- | --- |
| `customerWalkInAt` | create | `SESSION_CREATED` (metadata `{queue}`) |
| `demoStartAt` / `demoEndAt` | `startDemo` / `endDemo` | `DEMO_STARTED` / `DEMO_ENDED` |
| `decisionAt` | `buy` or `not-buy` | `DECISION_MADE` (not-buy adds metadata `{outcome, reason}`) |
| `productSelectionStartAt` | `startSelection` | `PRODUCT_SELECTION_STARTED` |
| `productSelectionConfirmedAt` | `confirm` (= stock request, D51) | `PRODUCT_SELECTION_CONFIRMED` |
| `stockStartedAt` | `search` | `STOCK_SEARCHING` |
| `stockFoundAt` | `found`, partial out-of-stock, `ACCEPT_PARTIAL` | `STOCK_FOUND` |
| `cashierReceivedAt` / `cashierScanAt` / `billOpenedAt` | `receive` / `scan` / `bill` | `CASHIER_RECEIVED` / `CASHIER_SCANNED` / `BILL_OPENED` |
| `cancelledAt` (+ `cancelledBy`) | `cancel`, resolve `CANCEL` | `CUSTOMER_CANCELLED` |
| *(no column)* | `send`, `complete`, out-of-stock, report-missing, resolve | `STOCK_SENT_TO_CASHIER`, `COMPLETED`, `STOCK_OUT_OF_STOCK`, `STOCK_REPORTED_MISSING`, `STAFF_RESOLVED_STOCK_REVIEW` |

The `EventType` enum in code has 19 values (`CASHIER_REJECTED` and `STOCK_ACKNOWLEDGED_CANCEL` were added by D64 and D63). It drops D27's `STOCK_REQUESTED` (merged into
`PRODUCT_SELECTION_CONFIRMED`, D51) and adds `STOCK_REPORTED_MISSING` and
`STAFF_RESOLVED_STOCK_REVIEW` (D40). docs/erd.md still lists the D27 set.

## 5. Explicit non-goals (do not build without a new decision)

KPI or efficiency formulas, durations, SLA targets (OQ-11) · money amounts on payments or
Ontop · customer personal data beyond phone · invoice or bill numbers, FileMaker integration
(D26) · admin UI for the fixed option lists (D15; payment methods are the exception, D66) · auto-timeout or auto-close of sessions (D7)
· external product or stock integration · microservices or event buses (architecture.md).
