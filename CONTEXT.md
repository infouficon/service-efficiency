# CONTEXT — Service Efficiency domain language and model

The shared vocabulary and domain model for this repo. Read it before a grilling, design or
refactor session, and keep it current: when a term is sharpened or an entity changes, update
this file in the same change. Decisions live in [docs/decisions.md](docs/decisions.md) (D1–D51);
unresolved items live in [docs/open-questions.md](docs/open-questions.md) (OQ-xx).

> **Status labels in this file.** **[built]** = verified in code (file:line cited).
> **[documented]** = stated in docs/decisions but not, or not fully, enforced by the code.
> **[OPEN]** = no decision yet. If code and docs disagree, the entry says so and points to
> [docs/agents/hazards.md](docs/agents/hazards.md).
> Last verified against `main` @ `1c9eaf1` (2026-10-12).

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
| Customer Session | One customer visit in one Branch. Created at walk-in, before any product or phone number is known. | `CustomerSession` (`schema.prisma:182`) |
| Session Reference | Human ID `SES-YYYYMMDD-NNNNNN`, per-day running number (D6). | `CustomerSession.reference`, generated in `sessions.service.ts:236-257`. Timezone/scope/overflow are OQ-08; see H-05. |
| Walk-in | Creating the session when the customer enters. Sets `customerWalkInAt`. | `POST /api/sessions` |
| DEMO | A Staff member demonstrating products. A Staff member may run only one active DEMO at a time (D5), **[documented]** (not enforced, H-04). | states `DEMO`; `demoStartAt` / `demoEndAt` |
| Decision | The customer's choice after DEMO: `BUY` or `NOT_BUY`. `NOT_PURCHASE` is forbidden (D11). | `buy` step sets `decisionAt`; `POST /decision/not-buy` sets `outcome=NOT_BUY` |
| NOT_BUY result | Exactly: `ราคา`, `ยังไม่ตัดสินใจ`, `เปลี่ยนใจ`, `สินค้าไม่ตรงความต้องการ`, `ต้องการสอบถามราคาหรือรายละเอียดเฉยๆ`, `อื่น ๆ` (+ required text). | `reason` / `otherReason`; lists in `apps/web/src/constants/options.ts` |
| Customer / Phone | Customer master is **only** an ID and a 10-ASCII-digit phone, collected only after BUY (requirements §6). | `Customer.phone` is `@unique` (schema:125), so the "uniqueness" part of OQ-09 is decided in code. The session also copies `phone`. |
| Product Selection / Purchase data | The purchase being assembled: **main product** (Product → Model → SKU), accessory options with quantity, Ontop, Points, Burn Points, Payments, phone. Editable until confirmation. | `PUT /sessions/:id/selection` |
| Main Product | At most one per session, set during selection (D8). Stored as `productId` / `modelId` / `skuId`. | Can be cleared by partial fulfilment |
| LOB / Category | `ProductCategory`: `iPhone`, `iPad`, `Mac`, `Watch`, `Accessories`. | enum `ProductCategory` |
| Ontop | Telco/partner add-on (`AIS`, `True`, `CATH`, `KTS`). Multi-select, no amount. | `SessionOntop.name` |
| Points / Burn Point | Loyalty programs earned / redeemed (`MCard`, `The 1`, `UJOY`). Two separate lists. | `SessionPoint`, `SessionBurnPoint` |
| Payment | Payment methods, multi-select, **no amounts** (`Cash`, `Transfer`, `SPayLater`, …). | `SessionPayment.method` |
| None | A UI-only "no selection" option. Never persisted: no selection = zero child rows. | filtered in `sessions.service.ts:460,472,484` |
| Stock Request / Stock queue | A confirmed session waiting for STOCK (`STOCK_REQUESTED`). Queues show **today's** sessions only (D47, UI-side). | |
| SEARCHING / FOUND | STOCK pressed "searching" (sets `stockStartedAt`), then found the item (sets `stockFoundAt` and **deducts 1** from branch stock, D41). | `search`, `found` steps |
| OUT_OF_STOCK | STOCK cannot fulfil; terminal outcome. Sets that SKU's branch stock to 0 (D41). | `POST /out-of-stock` (`action:'cancel'`) |
| Stock Review | D40: STOCK reports **missing items** (`report-missing`) without ending the session. A JSON blob (`stockReview`) is stored, STAFF sees an alert and resolves with `ACCEPT_PARTIAL` / `CHANGE_ITEMS` / `CANCEL`. A MANAGER/ADMIN can **acknowledge** the alert (adds `acknowledgedAt/By`, no event). | `CustomerSession.stockReview` (Json) |
| Sent to Cashier | STOCK hands the goods to the cashier. No timestamp column; the event time is the record. | `send` step |
| Cashier steps | `รับสินค้า` receive → `Scan` → `เปิดบิล` open bill → separate **COMPLETED** action. No invoice or bill numbers, no FileMaker (D26). | `receive`, `scan`, `bill`, `complete` steps |
| Cancellation | The customer leaves mid-flow. Reasons: `ลูกค้าเปลี่ยนใจ`, `รอนาน`, `อื่น ๆ` (+ required text). Terminal, no undo (D18–20). Restores 1 to stock if the item was already FOUND (D41). | `POST /cancel`; `cancelledAt`, `cancelledBy` |
| Outcome | The terminal result other than COMPLETED: `NOT_BUY`, `OUT_OF_STOCK`, `CUSTOMER_CANCELLED`. | enum `Outcome`, nullable `CustomerSession.outcome` |
| Milestone timestamp | One server-time column per real action (12 columns, listed in §4). Written once, never back-filled for skipped steps, never user-editable. | `*At` columns on `CustomerSession` |
| SessionEvent | Append-only history row per accepted action: `eventType`, trusted `actorStaffId`, server `createdAt`, small JSON `metadata`. | `SessionEvent` (schema:279); 17 event types |
| Actor | The authenticated Staff member doing an action, always taken from the Login Session and never from the request body. | `PublicAccount.staffId` |
| Branch / Branch Code | A store. Code is not unique-constrained (OQ-09). APIs accept either the UUID or the code as `branchId` (`sessions.service.ts:136-138,217-221`). | `Branch` |
| Staff ID | The login username and the primary key of `Staff`. Bootstrap admin is `0001`. | `Staff.staffId` |
| Role | `ADMIN`, `MANAGER`, `STAFF`, `STOCK`, `CASHIER`. A Staff member can hold several; grants are the **union** (D1). | `StaffRole` |
| Branch scope | ADMIN = all branches (no home branch). Everyone else has exactly one home Branch and sees only it (D2, D39). | `checkBranchAccess` (`sessions.service.ts:120`) |
| Master Catalog | `Product` → `ProductModel` → `ProductSku`. ADMIN-only CRUD. Deactivation cascades down and to all branch rows; reactivation does not cascade (D42). | `products.service.ts:415-530` |
| Branch Inventory | Per Branch × SKU: `stock` quantity + `active`. ADMIN sets the quantity; ADMIN or the branch's MANAGER toggles `active` (D41). Rows are auto-created (stock 0, active) for every Branch × SKU pair. | `BranchInventory`; `syncBranchInventory()` |
| Audit Logs | ADMIN-only merged feed of SessionEvents, recent Login Sessions and stock-review alerts. | `GET /api/admin/audit-logs` (`accounts.service.ts:362`) |
| ERP import / sync run | Daily 10:00 (Bangkok) pull of Branches and Staff from the company ERP (FileMaker OData), D53/D54. One `ErpSyncRun` row per run (scheduled or ADMIN "run now", optional dry run). | `apps/api/src/erp/`, `GET/POST /api/admin/erp-sync/*` |
| ERP-managed account | A `Staff` the import created (`erpStaffId` not null; `erpManaged` in the API). The ERP owns its password, name, branch, active flag and STAFF/STOCK/CASHIER roles; ADMIN/MANAGER roles stay manual; change/reset password is refused. Accounts without `erpStaffId` (hand-made, tests, `0001`) are never touched. | `Staff.erpStaffId` |
| ERP-managed branch | A `Branch` linked to an ERP `branch_id` (`erpBranchId`), only ERP groups `iStudio` and `U-Store`; edited at the ERP only. | `Branch.erpBranchId` |

## 3. Domain model

### 3.1 Entities and relationships (as built, `apps/api/prisma/schema.prisma`)

```text
Branch 1──* Staff                 (Staff.branchId nullable: ADMIN-only has none)
Staff  *──* Role   via StaffRole  (composite PK staffId+roleCode)
Staff  1──* LoginSession          (tokenHash PK, lastSeenAt)
Staff.erpStaffId / Branch.erpBranchId   (null = made by hand; set = kept in sync with the ERP, D53/D54)
ErpSyncRun                         (one row per import run; unique kind+slot)
AccountLock                        (single row id=1; global mutex, see H-02)

Product 1──* ProductModel 1──* ProductSku
Branch  1──* BranchInventory *──1 ProductSku   (unique branchId+skuId)

Branch   1──* CustomerSession
Staff    1──* CustomerSession     (staffId = creator / "assigned staff")
Customer 1──* CustomerSession     (customerId nullable until phone is entered)
CustomerSession *──0..1 Product / ProductModel / ProductSku   (main product, all nullable)
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
  CUSTOMER_CANCELLED from any non-terminal state (role depends on stage)
Stock review loop:  STOCK_REQUESTED|SEARCHING ─report-missing→ (stockReview set)
  ─resolve ACCEPT_PARTIAL→ FOUND | CHANGE_ITEMS→ PRODUCT_SELECTION (confirmed=false) | CANCEL→ CUSTOMER_CANCELLED
```

`CHANGE_ITEMS` is the **only** backward transition, and it reopens a confirmed purchase. That
departs from the "purchase data immutable after confirmation" rule (requirements §22) and was
introduced by D40.

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
| I-8 | Phone = exactly 10 ASCII digits, required before confirmation (§6) | **[built]**: `sessions.service.ts:425,588` (UI also validates) |
| I-9 | Phone collected only after BUY (§6) | **[built]**: selection is editable only in `PRODUCT_SELECTION` or `DECISION` with `decisionAt` set |
| I-10 | Option values come from the fixed lists (D15) | **NOT enforced server-side**: any string is accepted (H-11) |
| I-11 | Selectable SKU: active chain + branch active + stock > 0 (D41) | **UI-only**: `updateSelection` accepts any SKU id or code (H-10) |
| I-12 | Branch stock never negative | **NOT enforced**: `decrement: 1` without a floor (H-07) |
| I-13 | STAFF sees only current work; history is MANAGER (own branch) / ADMIN (D3) | **UI-only**: `GET /sessions` returns all of the branch's sessions to any branch role (H-06) |
| I-14 | Stock/Cashier queues show today only (D47) | **UI-only** filter |
| I-15 | SessionEvents are never updated or deleted (D27) | **[built]** by convention (no code path), but `onDelete: Cascade` from the session |
| I-16 | Last active ADMIN cannot be removed (D39) | **[built]**, covered by a real integration test |
| I-17 | MANAGER alone gets no STAFF/STOCK/CASHIER workflow grants (permissions.md) | **[built]**: `checkRole` requires the role; ADMIN bypasses every role check (`sessions.service.ts:114`) |

## 4. Milestone timestamps (12) ↔ events

| Column | Set by | Event |
| --- | --- | --- |
| `customerWalkInAt` | create | `SESSION_CREATED` |
| `demoStartAt` / `demoEndAt` | `startDemo` / `endDemo` | `DEMO_STARTED` / `DEMO_ENDED` |
| `decisionAt` | `buy` or `not-buy` | `DECISION_MADE` (not-buy adds metadata `{outcome, reason}`) |
| `productSelectionStartAt` | `startSelection` | `PRODUCT_SELECTION_STARTED` |
| `productSelectionConfirmedAt` | `confirm` (= stock request, D51) | `PRODUCT_SELECTION_CONFIRMED` |
| `stockStartedAt` | `search` | `STOCK_SEARCHING` |
| `stockFoundAt` | `found`, partial out-of-stock, `ACCEPT_PARTIAL` | `STOCK_FOUND` |
| `cashierReceivedAt` / `cashierScanAt` / `billOpenedAt` | `receive` / `scan` / `bill` | `CASHIER_RECEIVED` / `CASHIER_SCANNED` / `BILL_OPENED` |
| `cancelledAt` (+ `cancelledBy`) | `cancel`, resolve `CANCEL` | `CUSTOMER_CANCELLED` |
| *(no column)* | `send`, `complete`, out-of-stock, report-missing, resolve | `STOCK_SENT_TO_CASHIER`, `COMPLETED`, `STOCK_OUT_OF_STOCK`, `STOCK_REPORTED_MISSING`, `STAFF_RESOLVED_STOCK_REVIEW` |

The `EventType` enum in code has 17 values. It drops D27's `STOCK_REQUESTED` (merged into
`PRODUCT_SELECTION_CONFIRMED`, D51) and adds `STOCK_REPORTED_MISSING` and
`STAFF_RESOLVED_STOCK_REVIEW` (D40). docs/erd.md still lists the D27 set.

## 5. Explicit non-goals (do not build without a new decision)

KPI or efficiency formulas, durations, SLA targets (OQ-11) · money amounts on payments or
Ontop · customer personal data beyond phone · invoice or bill numbers, FileMaker integration
(D26) · admin UI for the fixed option lists (D15) · auto-timeout or auto-close of sessions (D7)
· external product or stock integration · microservices or event buses (architecture.md).
