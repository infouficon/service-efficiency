Open Questions — Confirmed Answers
Permissions

1. Complete role/action permission matrix
   Action ADMIN MANAGER STAFF STOCK CASHIER
   Create Customer Session ✓ ถ้ามี STAFF role ✓ ✗ ✗
   View current Session ✓ ✓ ✓ เฉพาะงานปัจจุบัน ✓ เฉพาะ Stock workflow ✓ เฉพาะ Cashier workflow
   View historical Session ✓ ✓ ✗ ✗ ✗
   Cancel Session ✓ ถ้ามี STAFF role ✓ ✓ ตาม Stock workflow ✓ ตาม Cashier workflow
   Edit before Product confirmation ✓ ถ้ามี STAFF role ✓ ✗ ✗
   Select Product ✓ ถ้ามี STAFF role ✓ ✗ ✗
   Edit Product before confirmation ✓ ถ้ามี STAFF role ✓ ✗ ✗
   Confirm Product/Purchase ✓ ถ้ามี STAFF role ✓ ✗ ✗
   View Stock request ✓ ✓ ✗ ✓ ✗
   SEARCHING ✓ ✗ ✗ ✓ ✗
   FOUND ✓ ✗ ✗ ✓ ✗
   OUT_OF_STOCK ✓ ✗ ✗ ✓ ✗
   SENT_TO_CASHIER ✓ ✗ ✗ ✓ ✗
   CASHIER_RECEIVED ✓ ✗ ✗ ✗ ✓
   CASHIER_SCAN ✓ ✗ ✗ ✗ ✓
   BILL_OPENED ✓ ✗ ✗ ✗ ✓
   COMPLETED ✓ ✗ ✗ ✗ ✓
   Manage Staff ✓ ✓ เฉพาะ Branch ตัวเอง ✗ ✗ ✗
   Manage Branch ✓ ✗ ✗ ✗ ✗
   Manage Product/Model/SKU ✓ ✗ ✗ ✗ ✗
   Reports ✓ ✓ ✗ ✗ ✗
   Export ✓ ✓ ✗ ✗ ✗

Role combination rule

Staff 1 คนสามารถมีหลาย Role พร้อมกัน
สิทธิ์ของแต่ละ Role รวมกัน (union of permissions)
ตัวอย่าง:
MANAGER + STAFF → ได้สิทธิ์ของทั้ง MANAGER และ STAFF
STAFF + STOCK → ได้สิทธิ์ STAFF + STOCK
MANAGER + CASHIER → ได้สิทธิ์ MANAGER + CASHIER
Role ที่ไม่ได้ assign จะไม่มีสิทธิ์ของ Role นั้น

ข้อนี้ทำให้ Manager ที่มี STAFF role สามารถทำ action ของ STAFF ได้

2. STOCK / CASHIER เห็นงานนอก Branch หรือไม่?

ไม่เห็น

STOCK → เห็นเฉพาะ Session ของ Branch ตัวเอง
CASHIER → เห็นเฉพาะ Session ของ Branch ตัวเอง
MANAGER → เห็นเฉพาะ Branch ของตัวเอง
ADMIN → Global / ทุก Branch 3. STAFF ดู Historical Sessions หรือไม่?

ไม่

STAFF:

เห็นงานปัจจุบันที่ตนเองกำลังดำเนินการ
ไม่สามารถเปิด Historical Sessions ได้

Historical Sessions:

MANAGER → Branch ตัวเอง
ADMIN → ทุก Branch
STAFF แก้ข้อมูลอะไรได้บ้าง?

STAFF แก้ได้เฉพาะ ก่อน Product/Purchase Confirmation

หลัง Confirmation:

Purchase data → immutable
Recorded timestamps → immutable
Event/Audit → immutable 4. ADMIN ทำอะไรได้บ้าง?

ADMIN เป็น Global Admin และสามารถจัดการ:

Staff
Roles
Branch
Product
Model
SKU
Customer Session
Reports
Export
System Configuration

สำหรับ:

Accessories
Ontop
Points
Burn Point
Payment

ตอนนี้ ไม่ทำ Admin UI สำหรับแก้ master options เหล่านี้ เพราะรายการถูกกำหนดเป็น fixed master data

รายละเอียด action ของ ADMIN ต่อ Session เช่น edit/cancel/delete ยังไม่ควรสร้าง CRUD แบบกว้าง ๆ จนกว่าจะกำหนดเพิ่ม หากต้องการให้ ADMIN มี view/cancel/edit โดยเฉพาะ ควรยืนยันแยก

Customer sessions and data model 5. Customer เดียวกันมีหลาย Active Sessions ได้หรือไม่?

ได้

Customer คนเดียวสามารถมีหลาย Active Sessions พร้อมกันได้

แต่:

DEMO Staff 1 คน สามารถ handle ลูกค้าได้เพียง 1 คน/1 Session ในเวลาเดียวกัน

ดังนั้น constraint นี้อยู่ที่ Staff + DEMO workload ไม่ใช่ Customer

6. Session Number / Reference

ใช้รูปแบบ:

SES-YYYYMMDD-NNNNNN

ตัวอย่าง:

SES-20260925-000001
SES-20260925-000002
SES-20260925-000003

เลขรันต่อวัน

7. Session Timeout / Abandonment

ไม่มี Timeout

ไม่มีระบบ:

auto timeout
auto abandonment
auto close

Session จะอยู่จนกว่าจะเข้าสู่ terminal state เช่น:

NOT_BUY
OUT_OF_STOCK
CUSTOMER_CANCELLED
COMPLETED 8. Main Product assign เมื่อใด?

Session ถูกสร้างตั้งแต่ Walk-in ดังนั้น Product ยังไม่มีในตอนสร้าง Session

Customer Walk-in
↓
Session created
↓
Product = NULL
↓
DEMO
↓
Decision
↓
BUY
↓
Product Selection
↓
Product assigned

ดังนั้น:

Session.productId = nullable

และ Product/Model/SKU จะถูกเลือกใน Product Selection

9. ERD

Approved direction:

Branch
│
├── Staff
│ └── StaffRole
│ └── Role
│
└── CustomerSession
│
├── Customer
│
├── Product
│ ├── Model
│ │ └── SKU
│
├── Accessories
├── Ontop
├── Points
├── BurnPoint
├── Payment
│
├── Cancellation
│
└── SessionEvent

แต่ ERD field-level และ FK behavior ยังไม่ควรถือว่า finalized ทั้งหมด จนกว่า Product hierarchy และ Event schema จะได้รับการยืนยัน

10. Timestamp mapping

ยืนยัน mapping ดังนี้:

Concept Database field
startedAt customer_walk_in_at
demoStartedAt demo_start_at
demoEndedAt demo_end_at
Product Selection started product_selection_start_at
Product Selection confirmed product_selection_confirmed_at
Stock started stock_started_at
Stock found stock_found_at
Cashier received cashier_received_at
Cashier scan cashier_scan_at
Bill opened bill_opened_at
Decision decision_at
Cancellation cancelled_at

ทั้งหมดเป็น server-generated timestamps

และห้าม client ส่ง timestamp เพื่อใช้เป็น authoritative timestamp

11. NOT_PURCHASE conflict

ใช้:

BUY
NOT_BUY

เท่านั้น

ไม่สร้าง NOT_PURCHASE

ดังนั้น conceptual workflow ต้องเปลี่ยนเป็น:

CUSTOMER DECISION
├── BUY
└── NOT_BUY
Product and other master data 12. ADMIN จัดการ Product / Model / SKU ได้หรือไม่?

ได้

ADMIN สามารถ:

Create
Read
Update
Delete

สำหรับ:

Product
Model
SKU 13. Product / Model / SKU relationship

ส่วนนี้ ยังไม่ถือว่า finalized

ข้อมูลที่ยืนยันแล้วคือมี Product master structure:

product_Category
product_SubCategory
product_SubSubCategory
product_name

และต้องมีข้อมูลลงถึง:

Product
Model
SKU

แต่ยังต้องยืนยันว่า relationship ที่ถูกต้องคือ:

Category
↓
SubCategory
↓
SubSubCategory
↓
Product
↓
Model
↓
SKU

หรือไม่

จึงยังไม่ควร lock Prisma FK structure ในข้อนี้

14. Approved mock Product/Model/SKU records

ยังไม่มีรายการ records ที่ approved

จะใช้ไฟล์ mock master data ที่ผู้ใช้จะนำมาให้ในภายหลัง

ดังนั้นตอนนี้:

Schema = ออกแบบได้
Seed data = ยังไม่ finalize 15. Accessories / Ontop / Points / Burn Point / Payment Admin UI

ไม่ต้องมี Admin UI ใน Version แรก

เป็น fixed master options

Accessories

16 options ที่กำหนดไว้แล้ว

Apple Pencil
Apple Keyboard
Magic Mouse
Magic Trackpad
Case
Protection
Power & Battery
AirPods & Audio
Adapters & Hubs
Charging
Storage / Connectivity
Headphones & speakers
Apple Care+
iProtect
Software
None
Ontop
AIS
True
CATH
U Trade
None
Points / Burn Point
MCard
The 1
UJOY
None
Payment
Cash
Transfer
SPayLater
TrueMoney
Full Credit Card
0% Credit Card
PayNext
UFund
Ulite
Thisshop
Kashjoy

None ไม่ถูก persist เป็น transaction line

16. Future external master-data integration

ยังไม่กำหนด

Version แรกใช้ Local Mock Master Data

External integration จะกำหนดภายหลัง

Decisions and cancellation 17. NOT_BUY → อื่น ๆ

ต้องกรอก Additional Text

เหมือน cancellation:

result = อื่น ๆ
→ other_reason required 18. Cancellation confirmation UI

ต้องมี

ทุก stage ที่อนุญาตให้ Cancel:

DEMO
Product Selection
Stock
Cashier

ต้อง:

กด CUSTOMER_CANCELLED
↓
เลือก Reason
↓
ถ้า "อื่น ๆ" → กรอกข้อความ
↓
Confirm
↓
CANCELLED 19. Cancellation notes
Reason Additional text
ลูกค้าเปลี่ยนใจ ไม่บังคับ
รอนาน ไม่บังคับ
อื่น ๆ บังคับ 20. หลัง Cancellation

เมื่อ Cancel สำเร็จ:

CUSTOMER_CANCELLED
↓
Terminal
↓
Return to Queue

Session ไม่ reopen และไม่มี Undo

21. Cancellation permissions / transition guards

Cancellation ทำได้ใน:

DEMO
Product Selection
Stock
Cashier

Role ที่เกี่ยวข้องกับ workflow มีสิทธิ์ Cancel ตาม role/action ที่กำหนด

STAFF → Cancel งานใน Staff workflow
STOCK → Cancel งานใน Stock workflow
CASHIER → Cancel งานใน Cashier workflow

Cancellation ต้องเกิดจาก authenticated user และบันทึก:

cancelledBy
cancelledAt
reason
otherReason
Stock and Cashier 22. FOUND → SENT_TO_CASHIER

ให้ STOCK กด action/button

FOUND
↓
[SENT TO CASHIER]
↓
SENT_TO_CASHIER 23. OUT_OF_STOCK reason

Optional

สามารถใส่ reason/note ได้ แต่ไม่บังคับ

24. Cashier timestamps

ต้องมี dedicated actions/buttons:

[รับสินค้า]
↓
cashier_received_at

[Scan]
↓
cashier_scan_at

[เปิดบิล]
↓
bill_opened_at 25. หลัง BILL_OPENED

BILL_OPENED ไม่ใช่ COMPLETED ทันที

ต้องมี action แยก:

BILL_OPENED
↓
[COMPLETED]
↓
COMPLETED

ดังนั้น COMPLETED เป็น separate action/state

26. Invoice / Bill / Transaction ID

ยังไม่เก็บในระบบนี้

เนื่องจากปัจจุบัน Cashier ใช้ FileMaker และกรอกข้อมูลเอง

ยังไม่มี FileMaker API integration

จึงไม่เพิ่ม:

Invoice Number
Bill Number
Transaction ID

ใน Version แรก

Immutable Event / Audit 27. Event model

แนวทางที่อนุมัติให้ใช้คือ SessionEvent

แนวคิด:

SessionEvent
├── id
├── sessionId
├── eventType
├── actorStaffId
├── createdAt
└── metadata

Event ถูกสร้างโดย server และ ห้ามแก้ไข / ลบ

Event types ที่สอดคล้องกับ workflow:

SESSION_CREATED
DEMO_STARTED
DEMO_ENDED
DECISION_MADE

PRODUCT_SELECTION_STARTED
PRODUCT_SELECTION_CONFIRMED

STOCK_REQUESTED
STOCK_SEARCHING
STOCK_FOUND
STOCK_SENT_TO_CASHIER
STOCK_OUT_OF_STOCK

CUSTOMER_CANCELLED

CASHIER_RECEIVED
CASHIER_SCANNED
BILL_OPENED
COMPLETED

อย่างไรก็ตาม รายละเอียด metadata ของแต่ละ Event ยังไม่จำเป็นต้อง lock ก่อน implement สามารถกำหนดเป็น structured JSON ที่เก็บเฉพาะข้อมูลประกอบของ event ที่จำเป็น

Authentication 28. Password policy

ยืนยัน:

Minimum password length = 8 characters

Password reset:

Admin reset password 29. Account lockout

เดิมยังไม่กำหนด — superseded by D39: 5 consecutive failures, 15-minute lockout per account.

ไม่ควรสมมติว่า:

5 attempts
10 attempts
temporary lock
permanent lock

จนกว่าจะกำหนด

30. Login session/token

Lifecycle below was originally unspecified; D39 now governs the implemented account phase.

ยืนยัน:

Cookie / Session based authentication

แต่:

Session lifetime
Idle timeout
Absolute timeout
Logout behavior
Session rotation

ยังไม่กำหนด

31. MFA

ยังไม่กำหนด

Dashboard / Reports / Export 32. KPI / Efficiency Formula

ยังไม่กำหนด

ระบบ Version แรกต้องเก็บ raw timestamps ให้ครบ เพื่อให้สามารถคำนวณ KPI ภายหลังได้

ตัวอย่างเช่น:

demo_duration
product_selection_duration
stock_wait_duration
cashier_wait_duration
total_service_duration

แต่ ยังไม่ควรสร้างสูตรเป็น business rule ตอนนี้

33. Target / SLA

ยังไม่กำหนด

34. Dashboard metrics

ยังไม่กำหนด

ดังนั้นยังไม่ควร hard-code KPI cards หรือ chart metrics

35. Dashboard filters

ยังไม่กำหนดทั้งหมด

ข้อมูลที่ควรเตรียมให้สามารถ filter ภายหลังได้:

Date
Branch
Staff
Role

แต่รายละเอียด filter behavior / default range ยังไม่กำหนด

36. Report grouping / aggregation

ยังไม่กำหนด

37. Excel / CSV

ต้องรองรับ:

Excel
CSV

แต่:

exact columns
filters
aggregation
report definitions

ยังไม่กำหนด

ดังนั้น Version แรกควรออกแบบ data layer ให้ export raw operational data ได้ โดยไม่สร้าง KPI/report logic ที่ยังไม่มี requirement

Deployment configuration 38. Coolify

Target deployment:

Coolify

แต่ยังไม่ได้กำหนด:

Web domain
API domain
Reverse proxy configuration
MySQL instance
MySQL version
Production database configuration
CORS origins
Production environment variables

ส่วนนี้เลื่อนไป Deployment phase

## D39 — Confirmed backend phase: accounts (2026-09-28)

The user confirmed Q1–Q11 and instructed implementation. This section supersedes the unspecified lifecycle details in D28–30 and the former OQ-03; it does not change D1/D4 workflow conflicts.

- First deliver real Login + Staff/Role/Branch with development MySQL; connect workflow incrementally. Remove only the mocks replaced by working APIs.
- Branches and additional Staff are entered by the user through management UI. Bootstrap ADMIN `0001` with the temporary password supplied by the user outside source control; force a password change.
- ADMIN-only has no Branch. Any other assigned role requires exactly one home Branch. Role grants remain a union.
- MANAGER manages operational roles STAFF/STOCK/CASHIER only in their Branch. Only ADMIN grants ADMIN/MANAGER or transfers Branch. A Manager cannot modify a higher-privilege account through an operational-role update.
- Deactivating Staff revokes all sessions. Do not deactivate a Branch with active Staff. Do not remove/deactivate the last active ADMIN.
- Eight-hour idle timeout; multiple devices; logout current device only. No absolute timeout introduced.
- Minimum eight-character passwords. New/reset accounts and initial ADMIN must change temporary passwords. Five consecutive failed logins lock that account for fifteen minutes. ADMIN reset invalidates all sessions and requires another password change.

### Technical implementation, not additional business policy

- NestJS account module, Prisma/MySQL persistent accounts and opaque cookie sessions. Session tokens are random, stored only as SHA-256 hashes. Passwords use salted scrypt.
- HttpOnly/SameSite=Lax cookie; Secure in production. Unsafe requests require an allowed Origin and a custom request header. UI uses same-origin `/api` proxy; no tokens in localStorage.
- The server checks current roles, active status and Branch on every protected request. Session idle time uses server request time; UI sends an activity check at most once per minute during real interaction, with no perpetual keepalive.
- Account transactions lock one security mutex row. This serializes last-ADMIN/Branch/role checks with writes and failed-login counting. It is deliberately limited to this initial account module; no workflow concurrency policy is inferred.
- Branch has a technical UUID; Branch Code uniqueness scope remains OPEN and is not constrained by this phase. Staff ID identifies login accounts; role codes are fixed. DTO maximum lengths are implementation storage/request bounds, not new business format rules.
- Local development uses isolated MySQL 8.4 on port 3307, API 3001. Existing unrelated MySQL/.env configuration is preserved. Tests use a separate database and remove only their own fixtures.
- The initial account bootstrap is explicit, refuses a nonempty Staff table and never resets existing accounts. No seed passwords are committed.

## D40 — Confirmed Stock Missing Items & Staff Decision Flow (2026-09-30)

- When Stock reports missing or out-of-stock items for a session during `SEARCHING` or `STOCK_REQUESTED` stage:
  - Stock posts `POST /sessions/:id/stock/report-missing` with `missingItems: string[]`, `foundItems?: string[]`, and optional `stockNote`.
  - Backend stores `stockReview` on `CustomerSession` and records immutable `SessionEvent` with type `STOCK_REPORTED_MISSING`.
- Notification & Resolution:
  - The assigned Staff (or Branch Manager / Global Admin) sees an alert banner on the session in Staff Workspace across all devices/browsers.
  - Customer decision is resolved via `POST /sessions/:id/staff/resolve-stock-review` with one of three choices:
    1. `ACCEPT_PARTIAL`: Updates selection to remove missing items, transitions state to `FOUND` (with server `stockFoundAt = now()`), clears `stockReview`, logs `STAFF_RESOLVED_STOCK_REVIEW` and `STOCK_FOUND` events.
    2. `CHANGE_ITEMS`: Clears `stockReview`, resets `confirmed = false`, transitions state back to `PRODUCT_SELECTION`, logs `STAFF_RESOLVED_STOCK_REVIEW` event.
    3. `CANCEL`: Clears `stockReview`, transitions outcome to `CUSTOMER_CANCELLED` with reasons, logs `STAFF_RESOLVED_STOCK_REVIEW` and `CUSTOMER_CANCELLED` events.

## D41 — Confirmed Branch-Isolated Product & Stock System (2026-10-09)

1. **Master Catalog & Branch Inventory**:
   - Master Catalog (`Product`, `ProductModel`, `ProductSku`) is managed centrally by ADMIN.
   - Branch-level inventory and status are tracked in `BranchInventory` (`branchId`, `skuId`, `stock`, `active`).
   - Defaults when a new SKU or Branch is created: `stock = 0`, `active = true`.
2. **Permissions & Visibility**:
   - **ADMIN**: Global visibility. Can create/edit Master Catalog, update stock quantities (`stock`) across all branches, and toggle `active` per branch.
   - **MANAGER**: Branch-level visibility. Can toggle `active` (Enable/Disable) for SKUs in their own branch. Cannot modify stock quantity.
   - **STAFF / STOCK / CASHIER**: Branch-level visibility based on trusted session `branchId`. Only sees SKUs with `active = true` in their branch.
     - SKUs with `stock > 0` are selectable.
     - SKUs with `stock == 0` display as "สินค้าหมด" (Out of Stock) and cannot be selected.
     - SKUs with `active == false` are completely hidden from branch staff.
3. **Workflow Stock Deduction & Restoration**:
   - At `FOUND` (`STOCK_FOUND`): System deducts 1 from `BranchInventory.stock` for the selected SKU at that branch within a database transaction.
   - At `CUSTOMER_CANCELLED` after `FOUND`: System automatically restores 1 to `BranchInventory.stock`.
   - At `OUT_OF_STOCK` (or reported missing):
     - System immediately resets `BranchInventory.stock` of that SKU at that branch to 0 to prevent further selection.
     - Creates alert/notification for Branch Manager to investigate loss vs misplaced item. Misplaced items found later are adjusted back by Admin.

## D42 — Confirmed Cascading Deactivation & Consolidated Stock Status UI (2026-10-09)

1. **Cascading Deactivation Behavior**:
   - When Admin deactivates a Master Product (`active = false`), the system automatically cascades `active = false` to all child Models, child SKUs, and all `BranchInventory` rows across all branches.
   - When Admin deactivates a Master Model (`active = false`), the system cascades `active = false` to all child SKUs and all their `BranchInventory` rows across all branches.
   - When Admin deactivates a Master SKU (`active = false`), the system cascades `active = false` to all `BranchInventory` rows of that SKU across all branches.
   - When reactivating (`active = true`) at a Master level, only that specific Master record is enabled; branch-level statuses remain as set previously.
2. **Consolidated Stock & Status UI**:
   - The product management table combines the "Stock Quantity" and "Branch Active Status" into a single consolidated column: `สต็อกคงเหลือ & สถานะสาขา`.
   - Each branch displays: `[Branch Code] [Toggle Button (Active/Inactive)] [Stock Badge] [Adjust Stock Button (Admin)]`.

## D43 — Confirmed Unified Product Table & Stock View Navigation (2026-10-09)

1. **Main Product Management Table**:
   - The bottom section of Product Management is redesigned into a single unified table where each row represents one Master Product.
   - Columns:
     - `Product`: Product Name (e.g. iPhone 16 Pro)
     - `LOB`: Category (iPhone, iPad, Mac, Watch)
     - `Status`: Active / Inactive status
     - `Inventory`: 2 lines (Line 1: `มีสินค้าทั้งหมด X ชิ้น` total available units across all branches; Line 2: `Y SKUs` count of child SKUs)
     - `Actions`:
       - `แก้ไข`: Opens modal to edit Product details, Models, and SKUs.
       - `ดู Stock`: Switches to the in-page Stock View.
2. **Stock View & Branch Breakdown Modal**:
   - In-page view switch with a `← กลับหน้ารายการสินค้า` button and a Product selector dropdown.
   - Table columns: `SKU`, `Product`, `สาขา` (e.g. `16/17 สาขา` indicating branches with stock > 0), `Available` (total units + in-stock/out-of-stock badge), and an action button to open the breakdown modal.
   - Branch Stock Breakdown Modal: Displays all branches with their branch code/name, inline toggle `[● เปิด / ○ ปิด]` for active status, and editable stock quantity with direct save.

## D44 — Confirmed Unsaved Branch Stock Warning & Batch Save UI (2026-10-09)

1. **Unsaved Modifications Warning**:
   - In the Branch Stock Breakdown Modal, when Admin edits stock quantity values (`stockInputs[branchId] !== inv.stock`) and attempts to close the modal (via close 'X', backdrop click, or Escape key), system prompts with an in-app Custom Confirmation Dialog.
   - Dialog provides two clear actions:
     - `ละทิ้งและปิด`: Discards unsaved edits and closes the modal.
     - `กลับไปแก้ไข`: Retains unsaved inputs and returns to editing.
   - Status toggle `[● เปิด / ○ ปิด]` remains immediate persistence to the backend and does not trigger unsaved prompt.
2. **Batch Save Capability**:
   - In addition to per-row "บันทึก" buttons, the Branch Stock Breakdown Modal provides a "บันทึกทั้งหมด" (Save All) action in the modal footer when any branch stock has been modified.
   - Clicking "บันทึกทั้งหมด" submits all dirty branches simultaneously and clears the dirty tracking upon success.

## D45 — Confirmed Product Management Sidebar Sub-Navigation (2026-10-09)

1. **Sidebar Sub-Menu Expansion**:
   - When the user navigates to "จัดการสินค้า" (`view === 'products'`), the sidebar navigation expands to display two indented sub-items:
     - `รายการสินค้า` (Main Products Catalog) with icon
     - `Stock สินค้า` (Stock Overview per SKU & Branch) with icon
2. **Bidirectional Navigation State**:
   - Clicking either sub-item in the sidebar switches the view mode (`MAIN` vs `STOCK`).
   - Clicking "ดู Stock" on any table row or "← กลับหน้ารายการสินค้า" in the workspace updates the active sub-item indicator in the sidebar automatically.

## D46 — Confirmed Accessories Product Category Expansion (2026-10-09)

1. **Category & LOB Expansion**:
   - Expanded `ProductCategory` enum to `['iPhone', 'iPad', 'Mac', 'Watch', 'Accessories']`.
   - Migration `202610090002_add_accessories_category` applied to MySQL `Product` table.
2. **Initial Seed & Iconography**:
   - Standard accessory products (e.g. *Apple 20W USB-C Power Adapter*, *AirPods 4*, *MagSafe Cases*) seeded with multi-branch stock.
   - Frontend UI uses `Headphones` icon for the `Accessories` category in filters, table badges, and selection views.

## D47 — Confirmed Today-Only Operational Scope for Stock & Cashier (2026-10-09)

1. **Active Queue Scope**:
   - The operational queues in Stock Workspace (`/stock`) and Cashier Workspace (`/cashier`) strictly filter sessions initiated today (`customerWalkInAt` falls on current calendar day: 00:00:00 - 23:59:59).
   - Past-date sessions are excluded from active operational queues so staff focus entirely on today's tasks.
2. **Sidebar Badge Counters**:
   - Queue badge indicators on the sidebar for Stock (items in `STOCK_REQUESTED` / `SEARCHING`) and Cashier (items in `SENT_TO_CASHIER` through `BILL_OPENED`) also filter strictly by today's date to match the workspace queue counts.
3. **Historical Audit**:
   - Full history across all dates remains accessible via Session Logs (`/logs`).

## D48 — Confirmed Staff Service Main Device Tabs & Dedicated Accessories Section (2026-10-09)

1. **Staff Service Category Tabs**:
   - In Staff Workspace product selection (`SelectionEditor.tsx`), the primary device tabs display only the four main hardware device categories: `['iPhone', 'iPad', 'Mac', 'Watch']`.
   - `Accessories` is excluded from the top tabs to avoid confusion with main device selection.
2. **Dedicated Accessories Section**:
   - Accessories are selected via the dedicated section below the main device grid with checkbox and quantity controls.
3. **Master Catalog**:
   - In Product Management (`/products`), `Accessories` remains available as a full catalog category with models and branch stock levels.

## D49 — Confirmed System-Wide Sticky Table Headers (2026-10-09)

1. **Sticky Header Behavior**:
   - All data table headers (`<th>`) across the application (`.admin-table th`, `.logs-table th`) use `position: sticky; top: 0; z-index: 5;` to remain fixed at the top when scrolling through data.
   - Covers Product Catalog table, Stock Overview table, Branch Stock Modal, Transaction History Logs, and Admin Management tables.
2. **Visual Hierarchy & Depth**:
   - Opaque background (`#f0f7f6` / `#f0f7f5`) with bottom borders and subtle box-shadow ensure data rows slide cleanly underneath without visual clutter.

## D50 — Confirmed In-Table Scroll Container & Sticky Header Architecture (2026-10-09)

1. **In-Table Scroll Scoping**:
   - In Transaction History (`SessionLogsWorkspace.tsx`) and Data Tables, the table wrapper container maintains its own scroll viewport (`max-height: calc(100vh - 290px); overflow-y: auto; overflow-x: auto;`).
   - Top search bars, quick date filters, and action headers remain visible while table rows scroll beneath the pinned `<th>` headers.
2. **CSS Sticky Compatibility**:
   - Eliminated `overflow: hidden` on `<table>` elements and set `border-collapse: separate; border-spacing: 0;` so sticky headers (`position: sticky; top: 0; z-index: 10;`) lock reliably without border flickering or disappearing.

## D51 — Removal of Redundant `stock_requested_at` in Favor of `product_selection_confirmed_at` (2026-10-09)

1. **Single Milestone Timestamp**:
   - The timestamp when a staff member confirms customer purchase/selection (`product_selection_confirmed_at`) and when the stock request is dispatched to the stock queue are identical in workflow execution.
   - Removed the redundant `stock_requested_at` timestamp field across frontend types, UI log columns, workflow checks, and system documentation.
2. **Source of Truth**:
   - `product_selection_confirmed_at` serves as the authoritative server timestamp representing both selection confirmation and stock request initiation.
   - Logs table and CSV export display `Product Selection Confirmed At` without duplicate columns.


## D52 — Confirmed ERP stock source and availability rule (2026-10-12)

Owner answers to the questions in `docs/agents/erp-integration.md` §2.

1. **Source.** Product and stock data already pulled from the ERP into the warroom database (`taspotae-lab/dashboard-npi-warroom`) are used as they are. SES does not pull products or stock from FileMaker itself; it consumes warroom through an API.
2. **Product key.** SES follows the product identifiers used by warroom ("use warroom's, they are right"). OPEN detail: which warroom column is the key (`product_upc` or the Apple part number in `ProductStore::product_model`, e.g. `MG8G4ZP/A`) and the rule for loading SES `ProductSku.sku` from it.
3. **Availability.** First version: available = ERP `ready` stock − sessions that SES has taken to `FOUND` and that the ERP has not billed yet. OPEN details: how SES learns that a unit has been billed in the ERP, what happens to D41's manual quantity edits and its zero-on-missing rule, and the API/auth for warroom (G-11).

## D53 — Confirmed Branch master comes from the ERP (2026-10-12)

1. **Scope.** Only ERP branches whose `branch_group` is `iStudio` or `U-Store` (20 rows on 2026-10-12: 8 iStudio, 12 U-Store).
2. **Key.** `branch_code` (unique and never empty across the 45 ERP rows).
3. **Direction.** SES `Branch` rows are created and updated from the ERP; SES is updated from the ERP, not the other way round. OPEN details: which fields are copied (proposal in `erp-integration.md` §3.2), how often, and what happens to a branch the ERP marks closed while SES still has active Staff (D39 forbids deactivating a Branch with active Staff).

## D54 — Confirmed staff import from the ERP (2026-10-12)

Owner answers to G-12 questions 1 to 3 (see `docs/agents/erp-integration.md` §3).

1. **Source.** SES staff and their login are taken from the ERP `staff` table through OData, refreshed daily at 10:00 (Bangkok time), together with the D53 branch list.
2. **Who counts as employed.** `status` is `active` (the ERP also has `Active`; treated as the same value, ignoring case).
3. **Who gets an account.** Staff whose branch is one of the D53 branches (`branch_group` iStudio or U-Store).
4. **Passwords.** "Use them as they are for now, no encryption needed" (owner). Settled afterwards: SES hashes the ERP password with scrypt at import (owner: "OK"). Users log in with the same password as in the ERP and the existing login code is unchanged.
5. **Existing SES accounts are kept** for testing. The sync never changes, deactivates or deletes an account it did not create.
6. **Login id.** `staffId` = the ERP `staff_id` (the ERP `user name` equals it for all 65 people who have one, so typing either works; the 24 people without `user name` log in with `staff_id`). A row whose `user name` differs from `staff_id` is reported, not aliased.
7. **Password owner.** The ERP, always. Synced accounts have no forced password change, and SES change-password and reset-password are refused for them (the daily sync would overwrite them).
8. **Roles.** The owner will give the role mapping later. Until then the sync grants only STAFF/STOCK/CASHIER from `position` (one table in the code, easy to change) and never grants or removes ADMIN/MANAGER.
OPEN: leavers and closed branches (proposal in `erp-integration.md` §3.4), how failures are reported, the exact role table (owner, later).

## D55 — Products and stock are read from the warroom database (2026-10-12)

Owner instruction: "products come from warroom" and the read-only connection of warroom's own `DATABASE_URL_READONLY` was handed over; the API route proposed earlier (warroom PR #1) is therefore not used. Defaults below were proposed in the conversation and then "go" was given; correct them here if the owner disagrees.

1. **Source.** SES reads `mart.stock_mv` in the warroom Postgres with a READ ONLY connection (`WARROOM_DATABASE_URL`), from inside Coolify. Warroom refreshes it from the ERP only 5 times a day (12:15, 15:15, 18:15, 21:15, 23:45 Bangkok), so every number carries `erpAsOf`.
2. **Modes.** `off` | `shadow` (default; stores ERP numbers for SKUs SES already has, nothing visible changes, no catalog) | `on` (creates/updates the catalog and uses the ERP numbers). First use is a dry run, then `shadow`, then `on`.
3. **Availability (D52 formula, defaults chosen).** available = ERP `ready` − sessions that reached FOUND (24 h window anchored to the oldest snapshot in play) without an outcome and not completed before the snapshot; 0 when a D41 missing/out-of-stock report is newer than the snapshot and younger than 6 hours. D41's other rules stay for rows without ERP data.
4. **Locks in mode `on`.** Manual stock edits are refused for rows with ERP data (ADMIN may still switch `active`); names, codes, colour, storage and category of `erpManaged` products/models/SKUs are read-only.
5. **Scope.** All categories found in `stock_mv`, only parts that some SES branch stocks, branches matched by `Branch.code`. Category text that the rules do not recognise is skipped and reported, never guessed.
OPEN: the final category rules (after the first dry run), a dedicated read-only database role for SES, and whether the 12.5 h overnight gap needs an extra warroom slot.

## D56 — A walk-in starts at the customer's phone number (2026-10-13)

Owner, relaying the 2026-10-13 meeting: "เริ่มการทำงานที่ กรอก เบอร์โทร". **Supersedes** requirements §6 and `erd.md` "Confirmed phone collection timing" (phone only after BUY, never at walk-in or NOT_BUY).

1. **First step.** `POST /api/sessions` needs `phone` (exactly 10 ASCII digits, as before). The `Customer` row is created or linked in the same transaction and the session stores `phone` and `customerId` from the first moment.
2. **Consequences.** A NOT_BUY or cancelled visit now keeps the customer's phone number (the privacy wording and any retention rule are the owner's call). The phone field at the BUY step stays, pre-filled, so a typo can still be corrected before confirmation (the 10-digit check at confirmation is unchanged).
3. **Walk-in time.** `customerWalkInAt` is the moment the start form is submitted; the phone is typed before the session exists.
4. **Default, not yet confirmed.** The phone is required and there is no "customer refused" path. OPEN: must a customer who refuses still be servable? If yes, say how it is recorded (a reason, a flag).

## D57 — Customer types and queue numbers replace the `SES-…` reference on screen (2026-10-13)

Owner: "เปลี่ยนการรันคิวแบบดูง่ายเพื่อให้เรียกลูกค้าง่าย", "ให้ทุกที่ที่เป็น SES-XXXXX เปลี่ยนเป็น คิว ให้หมด", "แยกประเภทลูกค้าเป็น A B โดยแบ่ง B พวกใช้เวลานาน"; asked how the types are made, the owner chose: "ทำให้ตั้งค่าหลังบ้าน สร้าง type เอง เรียงจาก a-z". Supersedes D6 for what is shown; D6's format stays as the internal key.

1. **Customer types** are a back-office list (ADMIN: Admin → "ประเภทลูกค้า / คิว"): a letter A-Z (unique, the sort order, never changed after creation), a name, a description, an active flag. The migration seeds `A ลูกค้าทั่วไป` and `B ลูกค้าใช้เวลานาน`; the owner renames them or adds more (a new type takes the next free letter unless one is given). Types are switched off, never deleted, and at least one stays active.
2. **Choosing.** The staff member picks the type at the phone step; the active type with the lowest letter is the default. The type cannot be changed afterwards (default, not yet confirmed).
3. **Queue number** = type letter + a running number, **per branch, per type letter, per Bangkok calendar day** (restarts at 00:00 Asia/Bangkok): `A001`, `B012`; four digits after 999. It is stored on the session (`queueLetter`, `queueNo`, the letter frozen at creation) and shown as "คิว A012" on every screen (staff, stock, cashier, logs, alerts, audit view, export).
4. **`reference` stays** as the internal unique key (`SES-YYYYMMDD-NNNNNN`, now with the Bangkok date): lookups, deep links, React keys. It is not shown, except as the last identification column of the CSV export, because queue numbers repeat across branches, types and days.
5. **Sessions from before this change** show their old per-day running number without a letter ("คิว 007").
6. **"B = takes long"** is only the name the owner gives. Reports compare durations by type; the export has a "ประเภทลูกค้า" column (the per-step durations arrive with the export change).
7. **Allocation** is atomic (`DailyCounter`, one INSERT … ON DUPLICATE KEY UPDATE inside the walk-in transaction) and fixes H-05. See [ADR 0001](adr/0001-atomic-daily-counters-for-queue-numbers.md).

## D58 — Receipt shows no prices (2026-10-13)

Owner, asked whether the printed receipt shows prices: "ไม่แสดงราคา (แนะนำ)". The "พิมพ์ใบเสร็จ" button prints an **order summary**: branch name and phone, date and time, queue number, staff, items with quantities, payment method names and the branch registration QR. No prices or totals; the legal receipt stays in U POS. SES keeps storing no money amounts (requirements §20, D26). Defaults, not yet confirmed: 80 mm paper, printable once the order is confirmed.

**Built 2026-10-13.** A "พิมพ์ใบเสร็จ" button under the order summary on the cashier screen and in the history detail (confirmed sessions), a print stylesheet for an 80 mm sheet (the browser's print dialog; nothing else is printed), titled "ใบเสร็จรับสินค้า (สรุปรายการ ไม่แสดงราคา)": branch name and phone, the time of printing, the queue number, the staff, the main products and accessories with quantities, the payment methods, Ontop / points, the registration QR (D67) and a thank-you line. No customer phone number is printed.

## D59 — "Stock unlimited" is one global ADMIN switch (2026-10-13)

Owner, asked for the scope of the temporary "unlimited stock" request: "สวิตช์รวมของ ADMIN (แนะนำ)". One setting, stored in the database (not an env var), switched by ADMIN; **on** by default until the warroom sync is switched to `on` (D55). While on: no SKU is blocked by stock (D41's "สินค้าหมด" does not apply), the screens show "ไม่จำกัด", FOUND does not decrement and a cancel does not give a unit back; it overrides the ERP numbers.

**Built 2026-10-13.** The switch is a `Setting` row (`stockUnlimited`; no row = on), changed at Admin → ซิงก์ ERP (shows who and when) via `GET/PUT /api/settings`. `GET /api/products` marks every SKU with `stockSource` (`unlimited` | `erp` | `manual`) and still returns the real number. FOUND records how many units it really took in the STOCK_FOUND event (`metadata.deducted`) and a cancel gives back exactly that, so toggling the switch between FOUND and cancel can never invent or lose a unit; events from before this change carry no figure and count as one unit, as before. D41's other rules (zero on a missing report, the manager alert) are unchanged.

## D60 — Bill opening on U POS works both ways (2026-10-13)

Owner, asked how SES and U POS (`infouficon/UFPOS`) should meet so the cashier no longer does the work twice and the KPI can be measured: "สองทาง (แนะนำ)". SES sends the order lines to U POS so the bill is pre-filled; U POS reports back when the bill is really opened, and SES records that moment (instead of the click on "เปิดบิล"). It needs a contract with the U POS team (a GitHub issue labelled `integration:pos` in `infouficon/UFPOS`); nothing has been opened there yet.

**SES side built 2026-10-13, U POS side not started.** `GET /api/integrations/pos/orders?branch=<code>[&queue=]` (the orders at the cashier with their lines, no prices) and `POST /api/integrations/pos/bills {reference, billNo, openedAt}` (moves an order at the cashier to BILL_OPENED at the real time, or stores the bill beside the cashier's own click; idempotent), behind a bearer key `POS_API_KEY` (unset or shorter than 32 characters = the routes answer 404). The contract and the request to paste into UFPOS: [docs/agents/pos-integration.md](agents/pos-integration.md).

## D61 — A session holds several main products, each with a quantity (2026-10-13)

Owner, relaying the 2026-10-13 meeting: "Main product เพิ่มได้หลายอัน" and "ตัวเลข จำนวนที่เพิ่ม ให้มี + − เพื่อให้ง่ายต่อการใช้". **Supersedes** requirements §5 / D8 ("exactly one main Product", `erd.md` "One main Product once selected").

1. **Items.** A Customer Session has any number of main products: `SessionItem` = a SKU and a quantity of 1 or more; a SKU appears once per session (picking it again raises its quantity). The old `productId/modelId/skuId` columns of `CustomerSession` are kept for history and never written again; the migration copied every existing main product into one item (quantity 1).
2. **Confirmation** needs at least one main product (as before: at least one). Accessories stay the fixed list of D48.
3. **Stock follows the items.** FOUND takes each item's quantity off the branch shelf (unless the D59 switch is on) and records it per item (`deducted`); a cancel gives back exactly that. D41's "missing report sets the SKU to 0" applies to each missing item. The ERP availability (D52/D55) subtracts the quantity of every promised item.
4. **Stock review (D40).** STOCK ticks what it found item by item and reports the missing main products **by item id** (accessories still by name). ACCEPT_PARTIAL keeps the rest (and takes it off the shelf); CHANGE_ITEMS drops the missing ones and reopens the selection. A review made before this change names the main product instead and is still understood.
5. **Default, not confirmed.** In the screen, `+` on a main product stops at the stock figure unless "stock unlimited" is on (a customer cannot be promised more than is on the shelf).

## D62 — The product picker goes step by step, like the trade-in app (2026-10-13)

Owner: "กดเลือกหมวดหมู่ ทำแบบเทรนอิน เพื่อให้ดูง่าย". The picker shows big tiles: **category** (iPhone, iPad, Mac, Watch) → **product** → **model** → **capacity / colour**; a step with a single choice is skipped, a back button climbs one step, and every pick lands in the list of chosen main products (D61). Built from the hierarchy the catalog already has (Product → Model → SKU). OPEN: the trade-in app (u-bid.uficon.com, behind a login) could not be looked at, so the tiles follow the description only; a screenshot of its category screen would let the look match.

## D63 — Any role can cancel; stock is told until it acknowledges (2026-10-13)

Owner, relaying the meeting: "ยกเลิกได้ทุก role เมื่อยกเลิกแล้ว แจ้ง stock แบบเห็นชัดๆ". **Supersedes** the stage-based cancel matrix (`permissions.md`, H-13; OQ-01 / OQ-02 about who may cancel where no longer matter). D20 stays: a cancelled session is final, nothing reopens it.

1. **Who and when.** Any signed-in role of the branch (STAFF, STOCK, CASHIER, MANAGER; ADMIN everywhere) can cancel any session that has not ended, at any stage. The reason is required (`อื่น ๆ` needs text).
2. **Stock is told.** When the session had already been confirmed (the stock request exists), the cancel is a notice for stock: a red banner on **every page** for STOCK users (with a short beep when a new one arrives) and a list at the top of the stock page. It says "ต้องคืนสินค้าเข้าชั้น" when the goods had been picked (FOUND or later) and "หยุดค้นหา" otherwise, with the items, the reason and who cancelled.
3. **It stays until acknowledged.** A STOCK user, a MANAGER of the branch or an ADMIN presses "คืนของเข้าชั้นแล้ว" / "รับทราบ". That is stored on the session (`stockAckAt`, `stockAckBy`, event `STOCK_ACKNOWLEDGED_CANCEL`) and shows on every device, replacing the browser-only dismissal (H-23 for this alert). A STOCK user who cancels before anything was picked needs no acknowledgement; a cancel before the stock request tells stock nothing.
4. **Units** go back exactly as D41/D59/D61 say.

## D64 — The cashier can send an order back to stock (2026-10-13)

Owner: "Cashier สามารถ reject order กลับมา stock ได้ กรณีหยิบสินค้ามาผิด".

1. **When.** From SENT_TO_CASHIER, CASHIER_RECEIVED or CASHIER_SCAN (not once the bill is open), by a CASHIER, with a reason: `หยิบสินค้าผิด`, `สินค้าชำรุด/มีตำหนิ` or `อื่น ๆ` (+ text). The reasons are a default, the owner gave none.
2. **Effect.** The whole order (not per item, default) goes back to the stock stage (`SEARCHING`); the units FOUND took return to the shelf; the stock-found, cashier-received and cashier-scan milestones start over for the new pass (the first pass stays in the events); event `CASHIER_REJECTED {reason, fromState}`. Stock sees "Cashier ส่งกลับ: <reason>" on the card and in the detail until it finds the goods again.
3. This is the first backward transition besides D40's CHANGE_ITEMS. The per-step durations in the export (F14) now add up the steps of every pass.

## D65 — Change reasons and "buy again" (2026-10-13)

Owner: "เหตุผลในการเปลี่ยน เปลี่ยนรุ่น สี ความจุ พนง เลือกสินค้าผิดพลาด (มีปุ่ม ให้กดซื้อใหม่โดยดึง data อันเก่า ใช้คิวเก่าในการทำงาน)".

1. **Reasons.** Four new cancel reasons: `เปลี่ยนรุ่น`, `เปลี่ยนสี`, `เปลี่ยนความจุ`, `พนักงานเลือกสินค้าผิดพลาด`.
2. **Buy again.** A session cancelled with one of them shows "ซื้อใหม่ (คิว A012)" to STAFF. It creates a **new** session (D20: nothing is reopened) pre-filled with the customer, customer type, the queue letter **and number** (the counter does not move), items, accessories, Ontop, Points, Burn Points and payments. It starts at product selection (the customer already decided to buy; no DEMO), belongs to the staff who pressed the button, and points back with `rebuyOfId`. Each cancelled session can be bought again once; a bought-again session can itself be changed again.
3. **Time.** The new session has its own milestones (walk-in = the moment of the rebuy). The visit as a whole (first walk-in to the end of the last session) is a column of the export, next to columns that link the two references; the stock side of the old session is an ordinary cancel (D63).

## D66 — Payment methods are a list the back office keeps (2026-10-13)

Owner, relaying the meeting: "เพิ่มช่องทางชำระเงินอีก 3 ช่องทาง". The names were not given, so instead of three hard-coded guesses the list becomes data ADMIN keeps; the owner adds the three (and any later ones) at Admin → ช่องทางชำระเงิน with no deploy. **This relaxes D15 for this one list** (the fixed option lists stay fixed in code, and "admin UI for the fixed option lists" in CONTEXT §5 is no longer true for payments). Default, not confirmed: say if three fixed names are preferred.

1. **List.** `PaymentMethod` (name unique, active, position). The migration seeds the eleven methods the app offered, in their order.
2. **What ADMIN can do.** Add a method (it goes to the end), switch one off or on, move it up or down. A name is what a session stores, so it is **never renamed or deleted**; at least one method stays active.
3. **Staff** see the active methods in that order when they pick payments (the built-in list is the fallback when it cannot be loaded). A method switched off after it was picked on a session stays visible on that session. The server still does not check the picked names against the list (H-11 stays open for payments).

## D67 — One registration QR per branch, at the foot of the receipt (2026-10-13)

Owner: "QR แนบท้ายใบเสร็จ เพื่อกรอกข้อมูลลงทะเบียน ไว้ (QR แยกแต่ละสาขา)". The address to encode was not given (OQ-15), so it is data: `Branch.registrationUrl`.

1. **Where it is set.** Admin → จัดการสาขา → "QR ลงทะเบียน" (ADMIN): an http(s) address up to 512 characters, with a live preview of the QR; empty clears it. `PUT /branches/:id/registration-url`. It also works on ERP-managed branches (the ERP does not own this field, D53).
2. **On the receipt.** The QR is drawn in the browser from the branch's address (error correction M, quiet zone, black on white; the text is encoded as UTF-8). A branch without an address prints no QR, and the screen says so next to the print button.
3. **The address pattern is the owner's / the U POS team's.** U POS's `/register` has no branch parameter today; a `?branch=<code>` would let it attribute the registration (to ask in the integration request, see D60). Until then any address can be set.

## D68 — Direct to Product Selection on Walk-in, Demo and Buy/Not-Buy Removed (2026-10-14)

Owner instruction via `/grill-me`: "หลังจากกรอกเบอร์โทรเรียบร้อย ให้เริ่มที่ step Product เลย ตัดส่วน demo และ BUY / NOT BUY ออกได้เลย ไม่เก็บข้อมูล timestemp ส่วนนี้แล้ว". Supersedes D10/D11 and the former DEMO/DECISION intermediate states for the walk-in service flow.

1. **Direct to Product Selection.** Submitting the walk-in form (10-digit phone number and customer type, D56/D57) immediately creates the session in `PRODUCT_SELECTION` state (`customerWalkInAt = now()`, `productSelectionStartAt = now()`, events `SESSION_CREATED` and `PRODUCT_SELECTION_STARTED`). The Staff Workspace immediately opens the step-by-step product selection wizard (D62).
2. **DEMO and BUY / NOT BUY Removed.** The `startDemo`, `endDemo`, and `buy` steps are completely removed from the operational workflow. Milestones `demoStartAt`, `demoEndAt`, and `decisionAt` are no longer recorded (remain null for new sessions). The database columns are retained as nullable so historical data remains intact.
3. **Customer Drop-off / Not Buy.** If a customer decides not to purchase or walks away during selection, Staff uses the existing "ยกเลิกคำขอบริการ" (Cancel) button, selecting reason "ลูกค้าเปลี่ยนใจ" (outcome: `CUSTOMER_CANCELLED`). No separate NOT BUY button is provided.
4. **Product Selection Duration.** Time spent on product selection begins at the moment the walk-in form is submitted (`productSelectionStartAt = customerWalkInAt`) and ends when staff confirms the purchase (`productSelectionConfirmedAt`).
5. **Staff Workspace Progress Bar.** The progress stepper on the staff screen displays five clear steps:
   - 1. กรอกเบอร์โทร (Completed upon walk-in submission)
   - 2. เลือกสินค้า (Active during product selection)
   - 3. ตรวจสอบยืนยัน (Active during order review)
   - 4. ฝ่ายคลัง (Active while in stock queue and searching)
   - 5. แคชเชียร์ (Active while at cashier until completion)
6. **Phone Number Verification & Correction.** Staff can inspect and edit the customer's phone number on the "ตรวจสอบยืนยัน" (Review & Confirmation) screen before clicking "ยืนยันการสั่งซื้อ" to handle any typo made at the walk-in step.
7. **CSV Export & Duration Reports.** The export columns for `Demo Start At`, `Demo End At`, `Decision At`, and duration steps `รอก่อนเริ่ม DEMO`, `DEMO`, `ตัดสินใจหลัง DEMO`, `เริ่มเลือกสินค้าหลังตัดสินใจ` are removed from the CSV export, showing only the active operational steps.

## D69 — Customer Type Auto-Classification by Payment Method (2026-10-14)

Owner instruction via `/grill-me`: "หน้า ประเภทลูกค้าและคิว (Customer Types) ให้สามารถกดได้ว่าการจ่ายเงินแบบไหนบ้างเป็นประเภท A / B".

1. **Payment Methods Configured per Customer Type.** In Admin → ประเภทลูกค้าและคิว (`CustomerTypesPanel`), ADMIN can configure which payment methods map to a customer type (stored as `CustomerType.paymentMethods` JSON array of payment method names). By default, Type B ("ลูกค้าใช้เวลานาน") maps long-service financing/installment methods (`0% Credit Card`, `PayNext`, `UFund`, `Ulite`, `Thisshop`, `Kashjoy`).
2. **Walk-in Flow Unchanged.** Walk-in queue issuance does not require payment method selection; the customer receives an initial ticket (e.g. A001) as usual.
3. **Auto-Classification on Payment Selection.** When Staff selects payment method(s) on a session (`PUT /sessions/:id/selection`), the system checks if any selected method matches an active Customer Type with configured `paymentMethods`. If matched (including in split payments where at least one method matches, e.g. Cash + UFund), `session.customerTypeId` automatically updates to that type (e.g. Type B). If no methods match, `session.customerTypeId` reverts to the type corresponding to the original walk-in `queueLetter` (e.g. Type A).
4. **Queue Number Invariant.** The customer's physical ticket (`queueLetter` and `queueNo`, e.g. "A001") is never altered mid-service so the customer does not lose their place or ticket number. Only `customerTypeId` and report classification update to reflect the accurate KPI and service duration category.

## D70 — Queue Number Allocation at Order Confirmation & Multi-Criteria Type B (2026-10-14)

Owner instruction via `/grill-me`: "ในส่วน ประเภทลูกค้าและคิว (Customer Types) ให้สามารถกำหนดได้ว่าถ้าเลือก Ontop Points Burn Point หรือ Payment แบบใดบ้างจะเป็นคิว B โดยที่จะมีคิวขึ้นก็ต่อเมื่อ ตรวจสอบยืนยัน เรียบร้อย ก่อนหน้าขั้นตอนนี้ หากต้องมีการแสดงคิว ให้แสดงเป็นเบอร์โทรลูกค้า และเอาการเลือก A B ในหน้า Walk in ออก"

1. **Walk-in Form Simplification:**
   - The Customer Type (A / B) selection is removed from the Walk-in screen.
   - Walk-in requires only the customer's 10-digit phone number.
   - No queue number is issued at Walk-in (`queueLetter = null`, `queueNo = null`, `customerTypeId = null`).
2. **Display Pre-Confirmation:**
   - Prior to confirmation (during Walk-in and Product Selection), wherever a queue number was previously displayed (workspace header, session list cards, stock alerts, rebuy button), the customer's phone number is displayed instead (e.g. `ลูกค้า 0812345678`).
   - Customer Type badges (e.g. `ประเภท A`) are hidden until a queue number is allocated.
3. **Multi-Criteria for Customer Type B:**
   - In Admin → ประเภทลูกค้าและคิว, ADMIN can configure matching criteria across four categories: **Payment Methods**, **Ontop promotions**, **Points earn**, and **Burn Points** (stored as JSON arrays on `CustomerType`: `paymentMethods`, `ontop`, `points`, `burnPoints`).
   - Matching rule: **OR logic** across all four categories. If an order matches ANY configured criterion in Payment, Ontop, Points, or Burn Point, it is classified as Type B; otherwise Type A (or default active type).
4. **Queue Allocation at Confirmation:**
   - When Staff clicks "ยืนยันการสั่งซื้อ" (`confirmPurchase`), the system evaluates the order's selected payments, ontop, points, and burn points against active Customer Types.
   - The queue number (e.g. `A001` or `B001`) is atomically allocated via `QueueService.allocate(tx, branchId, matchedTypeId, now)`.
   - The order moves to `STOCK_REQUESTED`.
5. **Automatic 80mm Slip Printing:**
   - Immediately upon confirmation, the system triggers the print dialog (`window.print()`) rendering the 80mm receipt/queue slip (`ReceiptSheet`).
   - The slip displays the allocated Queue Number in large font, branch name/code, date/time, customer phone number, selected products/accessories, payment methods, and the branch registration QR.
6. **Cancellation Before Confirmation:**
   - If a customer cancels before order confirmation, no queue number is allocated. In reports and session history, their reference and phone number identify the session.
7. **Buy Again (Rebuy) Invariant (F11):**
   - Retains the existing queue letter and number from the original session so the customer keeps their queue place.

## D71 — Payment Methods Drag-and-Drop Reordering (2026-10-14)

Owner instruction via `/grill-me`: "ช่องทางชำระเงิน ให้สามารถกดแล้วลากเพื่อเลื่อนจัดอันดับได้". Extends D66 (payment methods management).

1. **Drag & Drop Handle:**
   - In Admin → ช่องทางชำระเงิน (`PaymentMethodsPanel`), each row in the table contains a dedicated drag handle column with a `GripVertical` icon (`⠿`) at the left.
   - Dragging is enabled specifically when interacting with the drag handle to prevent unintended row dragging when clicking action buttons or selecting text.
   - Visual feedback during drag: dragged row displays reduced opacity (`0.35`), target insertion row displays clear drop highlight indicator (`#0abab5` border).
2. **Auto-save on Drop:**
   - When a row is dropped at a new position, the UI updates optimistically and immediately persists the new ordering to the backend via `PUT /api/payment-methods/reorder` with `{ ids: string[] }`.
   - On success, displays a toast notification: "บันทึกลำดับช่องทางชำระเงินเรียบร้อย".
   - If an error occurs, the order reverts to its previous state and an error toast is displayed.
3. **Retention of Up / Down Buttons:**
   - The single-step Up / Down arrow buttons (`↑` / `↓`) in the Actions column are retained alongside drag & drop for accessibility and touch/mobile devices.
4. **Backend Atomic Reordering:**
   - Endpoint `PUT /api/payment-methods/reorder` executes within a single transaction, validating all IDs and reassigning `position = 1..n`.

## D72 — Product categories are data; other brands get a category of their own, switched off (2026-10-14)

Owner, after the first warroom dry run (5,078 parts, 18 warroom categories, 7 of them "not mapped"): "ทำไมสินค้ายังไม่เข้าระบบ … สร้างหมวดหมู่เพิ่มได้หากไม่มีรองรับ อย่างเช่น Apple Accy คือหมวดของ Accessories ระบบ SES ตอนนี้เปิดเฉพาะ Apple ยังไม่เอาสินค้าจาก HUAWEI แต่อนาคตอาจจะมีก็ได้ … SKU เอาตาม warroom เลย".

1. **Why nothing came in.** Two reasons, neither a bug: mode `shadow` never creates products (D52), and `mapCategory` did not know "Apple Accy" (577), "Third Party Accy" (4,107) or the five "HUAWEI …" categories (129), so 4,813 of the 5,078 parts were skipped.
2. **Categories become data.** `Category` (name unique and never renamed, `active`, `position`, `isAccessory`, `erpManaged`). The migration seeds the five Apple categories (iPhone, iPad, Mac, Watch, Accessories) and turns `Product.category` from the `ProductCategory` enum into a plain string holding the name (supersedes the enum of D46). ADMIN keeps the list in Admin → หมวดหมู่สินค้า: add, switch on/off, move, flag accessory-like. A product can only be put in a category that exists.
3. **Mapping.** Apple words still map to the five categories, and "Apple Accy" now maps to Accessories. Anything else, and every other brand ("HUAWEI …", "Third Party Accy"), becomes a category named exactly as warroom spells it. The sync adds it **switched off** (in `shadow` and `on`, not in a dry run).
4. **Only active categories get products.** A part whose category is off is counted as `waitingForCategory` and not created; staff only see products of an active category. When ADMIN opens a category, the next sync run ("ซิงก์ตอนนี้") creates its products. Stock numbers are only stored for SKUs that exist (or are about to be created).
5. **Picker.** The main-product tiles are the active categories that are not accessory-like (accessories keep their own step, D48); the four device lines are the fallback when the list cannot be loaded.
6. **SKU = warroom part number** (`product_model`, unchanged since D52). The UPC (`product_upc`) is kept next to it in `ProductSku.upc` (filled by the sync, searchable in the back office).
7. **Not decided.** Whether staff should pick an accessory SKU (Apple Accy, 577 SKUs) the way they pick a main product: today accessories are the fixed list with quantities (OQ-16).

## D73 — "Clear the old catalog and queue history" is an ADMIN action, and the demo catalog is gone (2026-10-14)

Owner: "clear ของเก่าออกให้หมดเลย แล้วใช้ตามในนี้" and, asked what to do with products old queues point at: "ลบทุกอย่างรวมประวัติคิว".

1. **What it removes.** Every queue session (with items, accessories, payments, events …), the customers, the queue counters, and every product / model / SKU with its branch stock. Staff, branches, categories, payment methods, customer types and settings stay.
2. **How.** Admin → ซิงก์ ERP → "ล้างสินค้าและประวัติคิวเดิม": a first click only counts (`POST /admin/warroom-sync/reset-catalog?dryRun=true`); the real run needs the typed word `ล้างข้อมูล` in the body. It is refused while a sync is running, runs in one transaction, and leaves a `catalog-reset` row (who, counts) in the run history table. Irreversible: take a database backup first. It is deliberately not a migration, so nobody gets it by deploying.
3. **The demo catalog is removed.** `ProductsService` used to create a hard-coded demo catalog (fake SKUs, 5 units in every branch) whenever `Product` was empty, so a cleared catalog would have refilled itself at the next restart (H-17, the seed half). Nothing is seeded any more: the catalog comes from warroom or from ADMIN.

## D74 — Cascading Dropdowns for Main Product Selection (2026-10-14)

Owner instruction via `/grill-me`: "ตอนเลือก เพิ่มสินค้าหลัก ข้างใน ให้เป็นรูปแบบ dropdown เลือก ประเภทอุปกรณ์ รุ่น ความจุ สี". Supersedes the 4-step wizard tiles picker (D62).

1. **4-Level Cascading Dropdowns Form:**
   - In `SelectionEditor.tsx`, main product selection uses an inline form with four cascading `<select>` dropdowns:
     1. **ประเภทอุปกรณ์ (Device Category)**: iPhone, iPad, Mac, Watch, Accessories.
     2. **รุ่น (Model)**: Filtered models belonging to the selected category.
     3. **ความจุ (Capacity / Storage)**: Storage options available for the selected model (e.g. 128GB, 256GB, 512GB, 1TB).
     4. **สี (Color / SKU)**: Color options available for the selected model and storage.
2. **Auto-Skip & Smart Pre-selection:**
   - If a product model has no storage variations (e.g. AirPods, power adapters, cables, cases), the "ความจุ" dropdown is automatically skipped/hidden.
   - If a model or storage selection has only a single option (or single SKU), it is automatically selected to minimize clicks.
   - Changing an upstream dropdown resets downstream selections.
3. **Stock Visibility & Prevention:**
   - Stock availability is displayed directly inside the color dropdown `<option>` text (e.g. `Black Titanium (คงเหลือ 5 ชิ้น)` or `Desert Titanium (สินค้าหมด)`).
   - An out-of-stock SKU option is disabled in the dropdown.
   - A summary preview card renders the selected SKU code, specifications, and `StockBadge`. The "+ เพิ่มลงรายการ" button is disabled if the item is out of stock (unless unlimited stock mode D59 is active).
4. **Post-Add Workflow:**
   - Clicking "+ เพิ่มลงรายการ" adds the item to `value.items` using the existing stepper list (`addItem`).
   - The dropdown form automatically collapses/closes, while retaining the "+ เพิ่มสินค้าหลัก" button to reopen and add more items at any time.
   - When no main products are currently selected (`value.items.length === 0`), the dropdown form remains open by default.

## D75 — Return to Staff on Missing Stock (2026-10-14)

Owner instruction via `/grill-me`: "เมื่อ stock แจ้งสินค้าไม่ครบ/หมด (0/4) → ส่งเรื่องให้ Staff ให้คิวนั้นหายไปจาก stock เพราะ คิวนั้นได้กลับไปให้ staff แล้ว". Extends D40 (Stock Review).

1. **Immediate Removal from Stock Queue:**
   - In `StockWorkspace.tsx`, when Stock reports missing items (`reportStockMissingApi` / "แจ้งสินค้าไม่ครบ/หมด → ส่งเรื่องให้ Staff"), the session is immediately excluded from `stockQueue` (where `!s.stockPendingReview`).
   - Applies to all returned cases (both 0 items found and partial items found), as responsibility for customer consultation has transitioned back to Staff.
2. **Sidebar & Stats Counter Consistency:**
   - The pending counter pills in Stock Workspace and the sidebar menu badge (`stockPendingCount` in `App.tsx`) exclude `stockPendingReview` sessions so stock staff only see actionable search tasks.
3. **User Feedback:**
   - Upon successfully reporting missing items, Stock Workspace displays a prominent success notice ("ส่งเรื่องให้ Staff เรียบร้อยแล้ว (คิว ... ถูกส่งกลับไปให้ Staff ดำเนินการต่อ)") and resets the selection/view to return to the active queue list.
4. **Return Paths to Stock:**
   - If Staff and the customer choose to proceed with remaining found items (`ACCEPT_PARTIAL`), the session advances to `FOUND` (with `stockReview` cleared) and reappears in the Stock Workspace "พบแล้ว" tab to be dispatched to Cashier.
   - If Staff and the customer choose to change items (`CHANGE_ITEMS`), the session reopens at `PRODUCT_SELECTION` (confirmed=false); once Staff confirms the replacement selection, the session returns to Stock Workspace as a new `STOCK_REQUESTED` request.

## D76 — Cashier Reject Item Selection & Stock Re-pick (2026-10-14)

Owner instruction via `/grill-me`: "ส่งสินค้ากลับ Stock ให้สามารถเลือกได้ด้วยว่าหยิบชิ้นไหนผิด" and "ตรงด้านขวาของสินค้าที่แสดง แจ้งหยิบผิด ให้เป็น dropdown เลือกเหตุผลว่า หยิบสินค้าผิด สินค้าชำรุด/มีตำหนิ หรือ อื่น ๆ พร้อมกรอก ข้อความเพิ่มเติม (ระบุรายละเอียด) *". Extends D64 (Cashier Reject).

1. **Per-Item Reason Selection at Cashier Reject:**
   - In `CashierWorkspace.tsx` (`CashierRejectForm.tsx`), when Cashier sends an order back to stock ("ส่งสินค้ากลับ Stock"), the modal provides an itemized checklist of all items in the order (both main products and accessories).
   - The global bottom radio group is removed. Instead, when an item is checked, a dropdown appears on the right side of that specific item with reasons: `หยิบสินค้าผิด` (default), `สินค้าชำรุด/มีตำหนิ`, and `อื่น ๆ`.
   - If `อื่น ๆ` is chosen for an item, an inline text input `ข้อความเพิ่มเติม (ระบุรายละเอียด) *` expands directly underneath that item row with mandatory validation.
   - Cashier must select at least one item before the submit button is enabled.
   - `POST /api/sessions/:id/cashier/reject` accepts `reason` (auto-summarized distinct reasons), `wrongItems: string[]` (e.g. `[label] ([reason])`), `wrongItemIds: string[]`, and structured `wrongItemDetails: Record<string, { reason: string; note?: string }>`.
   - The `CASHIER_REJECTED` event records all these details inside its event metadata.

2. **Stock Visibility & Item-Specific Badges:**
   - When a session is rejected back to Stock, the red notice banner in `StockWorkspace.tsx` displays the list of problematic items with reasons: `สินค้าที่แคชเชียร์แจ้งมีปัญหา: [รายการ]`.
   - In the product details summary, accessories list, and interactive search checklist (`SEARCHING` state), each flagged item displays a badge reflecting its actual reason: `⚠️ หยิบสินค้าผิด`, `⚠️ สินค้าชำรุด/มีตำหนิ`, or `⚠️ อื่น ๆ: [note]`.

3. **Stock Auto Pre-Check Behavior:**
   - When viewing a rejected session in `SEARCHING` state, items that were NOT flagged with a problem are automatically pre-checked as "พบแล้ว".
   - Only the problematic items remain unchecked, enabling Stock staff to quickly re-pick only the affected items and tick them off once found, without needing to re-verify the entire order.

## D77 — Cashier Remove Damaged Items (2026-10-14)

Owner instruction via `/grill-me`: "หากกรณี สินค้าชำรุด ให้ cashier สามารถเอาสินค้านั้นออกเพื่อดำเนินการต่อได้". Extends D64 and D74 (Cashier Reject).

1. **Cashier Remove Damaged Action:**
   - In `CashierWorkspace.tsx` (`CashierRejectForm.tsx`), when Cashier opens "ส่งสินค้ากลับ Stock" modal and selects items with reason `สินค้าชำรุด/มีตำหนิ`, a dedicated button **"ตัดชิ้นที่ชำรุดออกและดำเนินการต่อ"** is displayed alongside "ยืนยันส่งกลับ Stock".
   - **Restriction:** "ตัดชิ้นที่ชำรุดออกและดำเนินการต่อ" is permitted only when **ALL** selected items are flagged as `สินค้าชำรุด/มีตำหนิ` (`allSelectedAreDamaged`). If any selected item is flagged as `หยิบสินค้าผิด` or `อื่น ๆ`, the order must be sent back to Stock for replacement re-picking.
2. **Zero Remaining Items Handling:**
   - If removing damaged item(s) leaves 0 items in the order, the system automatically transitions the session outcome to `CUSTOMER_CANCELLED` with reason `สินค้าชำรุด/มีตำหนิ` and records a `CUSTOMER_CANCELLED` event with metadata `{ allRemoved: true }`.
   - The button text dynamically reflects this state ("ตัดชิ้นที่ชำรุดออก (ยกเลิกคิว)").
3. **Inventory & Event Tracking:**
   - When damaged main products are removed, deducted units are returned to `BranchInventory` shelf stock via `returnItemsToShelf`.
   - When remaining items exist, the removed items (`SessionItem` / `SessionAccessory`) are deleted from the session, and a `CASHIER_REJECTED` event with `metadata: { action: 'REMOVE_DAMAGED', reason: 'สินค้าชำรุด/มีตำหนิ', removedItems, removedItemIds }` is appended.
   - The session remains at the cashier stage (`CASHIER_RECEIVED` or `CASHIER_SCAN`), allowing the cashier to proceed immediately to billing with the intact items.
   - `cashierRejectNotice` ignores events where `action === 'REMOVE_DAMAGED'`, preventing ghost reject notifications in Stock.
4. **API Endpoint:**
   - `POST /api/sessions/:id/cashier/remove-damaged` accepting `CashierRemoveDamagedDto` `{ itemIds: string[], note?: string }`.

## D78 — Picker: icon tiles for the category; capacity is not part of the model; batteries are their own category; delete only non-ERP products (2026-10-14)

Owner, after seeing the dropdown picker (D74) with real warroom data: "ทำไมไม่แยกรุ่นกับความจุ ... มันทำให้เยอะเกินไป", "แบตน่าจะต้องแยกหมวด", "ตอนแรกผมอยากให้เลือกสินค้าเป็น UI แบบก่อนที่เป็น icon หมวดหมู่ ใช้ได้เฉพาะ icon ห้ามใช้ emoji", "ลบสินค้าเก่าที่ไม่ได้เอามาจาก ERP". Amends D74 and D72.

1. **Category = icon tiles, then dropdowns.** The first step of "เลือกสินค้าหลัก" is one tile per active, non-accessory category (icons from lucide-react, SVG, no emoji; Battery has its own icon). Model, capacity and colour stay dropdowns (D74). A category with no products is shown disabled.
2. **Capacity is not part of the model.** Warroom's sub-category names carried the capacity ("iPhone 18 Pro Max 1TB"), which made one model per capacity and a long model list. The sync now removes the part's own capacity token from the product and model names, so every capacity of a model is one model and the capacity dropdown does its job. Only the part's own capacity is removed (a Mac's "16GB" memory stays).
3. **Batteries are a category.** A part whose sub-category (or sub-sub-category) starts with "Battery" goes to the category `Battery`, not iPhone or Accessories (unless the warroom category is another brand's). The category is added switched off, like every new warroom category (D72): staff see it once ADMIN opens it.
4. **Existing ERP products are re-filed by the sync.** An ERP-made SKU filed under another category / product / model than today's rules give (the old per-capacity models, batteries under iPhone) is moved to the right ones on the next run (`moved` in the run summary; a dry run counts it); the ERP-made models and products left empty are removed. Hand-made records are never touched.
5. **"Delete only what is not from the ERP".** Admin → ซิงก์ ERP → "นับสินค้าที่ไม่ได้มาจาก ERP" (`POST /admin/warroom-sync/reset-catalog?scope=non-erp`): counts first, then the typed confirmation. It removes SKUs (with branch stock) that are not `erpManaged`, the hand-made models/products left empty by that, and every queue session that used any of them (a session cannot keep a product that is gone). ERP-made products, customers and the other queues stay. Irreversible: back up first.
## D79 — Staff and Cashier Item Change with Stock Notification (2026-10-14)

Owner instruction via `/grill-me`: "Cashier และ Staff สามารถ เปลี่ยนรุ่น สี ความจุ ได้ ระหว่างการทำงาน และมีการแจ้งเตือนไปที่ Stock".

1. **Scope and Permitted Stages:**
   - **Staff**: Can change main product items while waiting for Stock (`STOCK_REQUESTED`, `SEARCHING`, `FOUND`).
   - **Cashier**: Can change main product items while checking/scanning at cashier desk (`CASHIER_RECEIVED`, `CASHIER_SCAN` before bill is opened).
   - Only main products are swapped 1-to-1 (`SessionItem`). If the customer wants to modify accessories, they can still do so through Stock Review (`CHANGE_ITEMS`).
2. **UI & Replacement Selection:**
   - In both `StaffWorkspace.tsx` and `CashierWorkspace.tsx`, an action button "เปลี่ยนสินค้า (รุ่น/สี/ความจุ)" opens `ChangeItemModal`.
   - The modal lists current main products in the order; user selects which item to replace.
   - 4-level cascading dropdowns (Category -> Model -> Storage -> Color) allow picking the replacement SKU. Out-of-stock items are disabled/warned.
   - Reason dropdown: `ลูกค้าเปลี่ยนใจ`, `แนะนำรุ่นอื่น/โปรโมชั่น`, `อื่น ๆ` with optional detail note.
3. **Workflow & Stock Transition:**
   - Submitting the change resets the session to `SEARCHING` state.
   - Milestones `stockFoundAt`, `cashierReceivedAt`, and `cashierScanAt` are cleared.
   - If the previous item was already picked (`FOUND` or later), previously deducted shelf stock is returned to `BranchInventory` via `returnItemsToShelf`.
   - The replaced `SessionItem` has its `skuId` updated to the new SKU.
   - A `SessionEvent` is appended with `eventType: 'ITEM_CHANGED'`, `actorStaffId`, and metadata `{ oldItemId, oldSkuId, oldSku, oldName, newSkuId, newSku, newName, reason, note, changedByRole }`.
4. **Stock Notification & Visibility:**
   - In `StockWorkspace.tsx`, a prominent amber alert banner notifies Stock: "⚠️ มีการเปลี่ยนสินค้า: นำ [เครื่องเดิม] คืนคลัง และหยิบ [เครื่องใหม่] แทน (เปลี่ยนโดย [Staff/Cashier]) — เหตุผล: [reason] [note]".
   - The queue item card displays an amber badge `[เปลี่ยนสินค้า]`.
   - Audio beep (`playAlertBeep`) alerts Stock to the updated task.
   - In the search checklist, unaffected items are pre-checked, leaving the newly swapped item unchecked for picking.
   - Once Stock picks the new item and clicks "พบสินค้าครบแล้ว" (`found`) -> "ส่งต่อให้แคชเชียร์" (`send`), the order progresses back through the standard cashier receiving flow.
5. **API Endpoint:**
   - `POST /api/sessions/:id/change-item` accepting `ChangeSessionItemDto` `{ oldItemId: string, newSkuId: string, reason: string, note?: string }`.

## D79 — Macs: model = name + chip + screen; RAM and capacity are their own steps; product pictures on the category tiles (2026-10-15)

Owner, after seeing the Mac list (one entry per RAM/capacity/keyboard combination, "Macbook Air M5 13.6 Ram 16 512GB", "MACBOOK AIR … Eng"): "macbook ก็ไม่แยกความจุ ... ขนาดจอ + storage + ram แยกตามความเหมาะสม", and "icon มันดูไม่สวย สามารถหา icon จาก apple ได้ไหม" with Icons8 pictures for iPhone, MacBook, Watch, iPad and accessories. Amends D78.

1. **Model name keeps what a customer thinks of as the model**: product line, chip and screen size ("MacBook Air M5 13.6", "MacBook Pro M5 Pro 14.2", "Mac mini M4"). The sync removes the RAM ("Ram 16" / "Ram 16GB" / "16GB RAM"), the capacity (D78) and a trailing keyboard-layout marker ("Eng", which stays in the SKU name) from the model name, and treats names that differ only in case as one model (mixed case beats ALL CAPS).
2. **RAM is a SKU attribute.** `ProductSku.memory` (additive nullable column) is parsed from the names (`product_subsubcat`, then `product_subcat`, then the product name) by the sync; the staff catalog API returns it; the back office shows it next to capacity and colour.
3. **Picker order:** category tile → model → **RAM** (only when the model has more than one memory, or any) → capacity → colour. A step with a single choice is filled in and a step the model does not have is skipped. When two colours of a model would read the same (a keyboard layout only in the part), the part number is appended to the option.
4. **Existing Mac products are re-filed by the next sync** (D78 item 4): they move to the merged models, the emptied ones go.
5. **Pictures.** The category tiles show Icons8 pictures (iPhone, iPad, Mac, Watch, Battery, Accessories) bundled in `apps/web/src/assets/category-icons/` (downloaded once from the URLs the owner gave, no runtime hotlinking). Icons8's free licence needs a link back; the picker showed "ไอคอนสินค้าโดย Icons8" until 2026-10-15, when the owner had it removed (his call: the licence is his to hold; credit is kept here and in the code comment). Categories without a picture (other brands) get a plain line icon. The Accessories picture is a stand-in (fluency "airpods-pro"): the owner's wireless-charger link was cut off in the message; replace `accessories.png` with it.
6. **Not changed:** non-product rows warroom files under Mac (for example "Connectivity Cards - MacBook Air (13-inch, 2017)", "Other - AC+ Incident") are still created as models; see H-33.

## D80 — Mac storage and colour are read from the names, not from warroom's capacity/colour columns (2026-10-15)

Owner, after D79 went live: a Mac showed "ความจุ: 24GB", the model "MacBook Pro M5 14.2 1TB" and the colour "1TB SSD - Space Black". Warroom's `capacity` column is the first GB/TB figure of a name, which on a Mac is the RAM ("Ram 24 1TB" -> "24GB"), and its `color` column can carry the storage in front ("1TB SSD - Space Black"). Amends D79.

1. **Storage.** When a memory was read from the names (D79), the storage is the first GB/TB figure in the names that is not that memory ("Ram 24 1TB" -> `1TB`); with no storage in the names it is empty (never the RAM). Without a memory the `capacity` column is used as before (phones, iPads).
2. **Colour.** A leading capacity / RAM / SSD part and its dash are removed ("1TB SSD - Space Black" -> "Space Black"; "16GB/512GB - Silver" -> "Silver"); a value that would become empty is kept.
3. **Model name** is cleaned with the corrected storage, so "1TB" no longer stays in "MacBook Pro M5 14.2 1TB".
4. **Existing rows** are corrected by the next sync run (SKU attributes are refreshed, and the SKUs are re-filed, D78). The picker's selected-product card now shows the category picture.

## D81 — A change of the catalog rules re-runs the sync by itself after the deploy (2026-10-15)

Owner, after D80 was merged: the Mac still showed "ความจุ 24GB" and the model "MacBook Air M5 15.3 1TB". Nothing was missing from the data: the corrected rules only apply when a sync run happens, and the scheduled check runs once per (snapshot time, content fingerprint), so a deploy that changed the rules did not trigger any run until warroom's data changed or an ADMIN pressed "ซิงก์ตอนนี้".

1. `CATALOG_RULES_VERSION` (in `warroom-sync.service.ts`) is mixed into the run-slot fingerprint. After a deploy that raises it, the next scheduled check (every `WARROOM_SYNC_MINUTES`, default 10) processes the snapshot again and corrects, updates and re-files what the old rules made.
2. **Rule for contributors:** raise it whenever `mapCategory`, `buildCatalog` or the helpers they use (`modelNameOf`, `storageOf`, `colorOf`, `memoryOf`, `withoutCapacity`) change what a catalog item looks like.
3. Needs mode `on` (in `shadow` nothing is written to the catalog) and the usual guards still apply; an ADMIN can still run it by hand.

## D82 — Changing an item while in STOCK_REQUESTED keeps the session in STOCK_REQUESTED (2026-10-16)

Owner instruction via `/grill-me`: "หากลูกค้า เปลี่ยนสินค้า (รุ่น/สี/ความจุ) ในขณะที่ยังอยู่ใน status STOCK_REQUESTED เมื่อกดเปลี่ยนแล้ว ให้ยังคงอยู่ใน status เดิมไม่ใช่เปลี่ยนไปเป็น status SEARCHING". Amends D79 (Staff and Cashier Item Change).

1. **Preserve `STOCK_REQUESTED` when Stock has not started searching:**
   - When `POST /api/sessions/:id/change-item` is called while the session is in `STOCK_REQUESTED` (`stockStartedAt` is null), the session state remains `STOCK_REQUESTED` instead of moving to `SEARCHING`.
   - When called from `SEARCHING`, `FOUND`, `CASHIER_RECEIVED`, or `CASHIER_SCAN`, the session still transitions to `SEARCHING` and clears `stockFoundAt`, `cashierReceivedAt`, and `cashierScanAt` as before.
2. **Stock Notification & Checklist Pre-selection:**
   - Stock still sees the `เปลี่ยนสินค้า` badge and notification banner (`itemChangeNotice`) for changes made in `STOCK_REQUESTED`.
   - When an item is changed by **Staff** (`changedByRole === 'STAFF'`) in any state (`STOCK_REQUESTED`, `SEARCHING`, or `FOUND`), no items or accessories are pre-checked in Stock's checklist (`foundSelection` starts empty `[]`).
   - Pre-checking unchanged items in the checklist applies **only** when the order is sent back from **Cashier** (`itemChange.changedByRole === 'CASHIER'` or `cashierRejectNotice`).

## D83 — Queue numbers run sequentially per branch and Bangkok day across all customer types (2026-10-16)

Owner instruction via `/grill-me`: "ตัวเลขคิวที่รันให้รันไปเลยโดยใส่ A B เพื่อแบ่งประเภทลูกค้าเท่านั้น โดยที่ตัวเลขรันไปเรื่อยๆ". Amends D57 and D70.

1. **Shared Running Counter per Branch & Day:**
   - `QueueService.allocate` increments a single `DailyCounter` scope per branch and Bangkok day (`queue:<branchId>`), rather than a separate counter per customer type letter (`queue:<branchId>:<letter>`).
   - Customer type letters (`A`, `B`, …) act strictly as prefixes indicating the customer type while the numeric sequence continues across types within the same branch and day (e.g. `A001` → `B002` → `A003`).
2. **Daily Rollover:**
   - The counter still resets to `001` at midnight (`00:00` Asia/Bangkok) for each branch.

## D84 — API documentation pages generated from the code (2026-10-20)

Owner: "แล้วหน้าสำหรับ doc ละครับ list api". Until now the API contract lived in markdown (docs/agents/pos-integration.md) and the code.

1. **`/api/docs`** (+ `/api/docs-json`): every endpoint (Swagger UI / OpenAPI 3, `@nestjs/swagger`), grouped by controller, with the DTO schemas and the JSDoc of the handlers. **ADMIN session required** (401 without a cookie, 403 for other roles; the assets are behind the same gate). "Try it out" works for **GET only** (2026-10-26: reads real data with the session cookie the browser already sends; leave the Authorize boxes empty); POST/PUT/DELETE cannot be fired from this page. Admin → จัดการระบบ → "เอกสาร API" opens it in a new tab.
2. **`/api/pos-docs`** (+ `/api/pos-docs-json`): only the U POS integration (D60), **public** so the U POS team can read it without a login; the endpoints are useless without the bearer key. "Try it out" works once the key is entered. Examples and every status code (400/401/404/409) are documented.
3. Generated from the code (CLI plugin introspects `*dto.ts` and comments), so it follows the code. New endpoints appear by themselves; a response shape is only shown when a handler declares one (`@ApiOkResponse`), as for the POS routes.
4. Not documented there: `/health`, the docs themselves. The docs are served by the API process; no separate site to deploy.

Fix 2026-10-26: the first deploy of D84 showed a blank page at `/api/docs`. The web container's nginx had `location /api/` (plain prefix), and a regex location for static files (`.js`, `.css`, `.png` …) beats a plain prefix, so the Swagger UI's own files under `/api/docs/` were looked up in the SPA's web root and failed. The proxy is now `location ^~ /api/` (needs a redeploy of the **web** app) and a test guards it. Any future API route that serves files under `/api/` depends on this.

## D85 — Staff sign in with a 6-digit SMS code (ThaiBulkSMS), sessions last 12 hours (2026-10-28)

Owner: "จากปกติใช้ password จาก erp เป็น OTP SMS แทน … session อยู่ได้ 12 ชั่วโมง … ขอ Webhook URL สำหรับ otp เพราะ thaibulksms เขาขอมา".

1. **Where the phone comes from.** Neither SES nor warroom held staff phones (SES imported only the branch phone; warroom reads `staff_id` and the name and signs people in by e-mail OTP). The ERP `staff` table has `tel`: of the 92 active iStudio / U-Store staff, 84 have a Thai mobile number, 6 are empty, 2 are in another format, none is shared (probed 2026-10-28, aggregates only; the `sms` field is an on/off flag, not a number). The ERP import now also reads `tel` and stores it in `Staff.phone` (10 digits); a person without a usable number is imported but listed in the run's warnings (OTP cannot reach them until the ERP is fixed). A phone on an ERP account is read-only in SES (409), like the other ERP fields (D54); ADMIN sets it by hand on accounts SES created.
2. **The switch.** OTP login is on as soon as `THAIBULKSMS_API_KEY` and `THAIBULKSMS_API_SECRET` are set (until then the password login works exactly as before, so a deploy cannot lock anybody out). `GET /auth/config` tells the login page which form to show.
3. **Flow.** `POST /auth/otp/request {staffId}` always answers `{ok:true}` (an unknown, inactive or phoneless account just gets no SMS; the SMS is sent after the answer so timing does not tell either). `POST /auth/otp/verify {staffId, code}` starts the session. A code: 6 digits, kept as a hash, valid 5 minutes, single use, 5 wrong tries burn it; per staff member 1 code a minute, 5 an hour, 10 a day; system-wide `OTP_SMS_DAILY_LIMIT` (default 1000 per 24 h). The SMS text is "รหัส OTP เข้าระบบ SES: 123456 (ใช้ได้ 5 นาที) ห้ามบอกผู้อื่น".
4. **Password login in OTP mode.** Refused for accounts synced from the ERP; kept for hand-made accounts (the first ADMIN, test accounts), so there is always a way in. While OTP is on the import no longer reads the plaintext ERP `user password` at all and replaces the stored copy by a marker (`otp:only`) that nothing verifies against; people without an ERP password get an account too. Switching OTP off again makes the next import restore the password copies.
5. **Session.** A login session lasts **12 hours from the login** whatever the activity (no idle timeout any more; the old rule was 8 hours idle); the cookie carries `Max-Age` of 12 hours so closing the browser does not end the shift.
6. **Webhook for ThaiBulkSMS.** `POST|GET|PUT /api/webhooks/thaibulksms/<THAIBULKSMS_WEBHOOK_TOKEN>` (the token is the secret; wrong or unset = 404). ThaiBulkSMS's API v2 document says nothing about the payload, so it is read tolerantly (message id and status under the usual names, from the query or a JSON / form body), stored on the OTP row without anything that looks like a phone number, and shown in Admin → "เข้าสู่ระบบด้วย OTP". The login never depends on it.
7. **Admin view.** Admin → "เข้าสู่ระบบด้วย OTP": configuration status, the webhook URL pattern, a test SMS (one credit) and the latest 50 codes with their SMS status (never a code, never a full number). Staff list: masked phone and an "ไม่มีเบอร์" badge; ADMIN can set / clear the phone of a hand-made account.
8. **Not decided / open.** Which sender name ThaiBulkSMS has registered for SES (`THAIBULKSMS_SENDER`; empty = their default). Whether Cloudflare in front of ses.uficon.com lets ThaiBulkSMS's server reach the webhook (it answered 403 to a plain curl; a WAF skip rule for `/api/webhooks/thaibulksms/*` may be needed). Staff whose ERP `tel` is wrong or empty.

## D86 — Staff list as an Excel file: export everything we store, import to update or add accounts (2026-10-28)

Owner: "จัดการผู้ใช้ (Staff Members) หน้านี้ช่วยทำ export, import … เป็น xlsx ดึง data ที่เรามี และเอามาทุก field เช่นวันที่ update เบอร์โทร รายละเอียดต่างๆที่เราเก็บ".

1. **Where.** Admin → จัดการผู้ใช้: "Export Excel" and "Import Excel", **ADMIN only** (the file holds phone numbers). The browser builds and reads the .xlsx (`write-excel-file`, `read-excel-file`, loaded when a button is pressed); the API only speaks JSON: `GET /staff/export`, `POST /staff/import`.
2. **Export.** One row per account, 21 columns: staffId, name, branch (code and name), roles, active, **phone** (full number) and where it came from, source (ERP / hand-made), ERP staff_id, last ERP sync, **createdAt, updatedAt, lastLoginAt**, live sessions, last OTP request and its SMS status, mustChangePassword, failedAttempts, lockedUntil. Never the password hash. Times are Bangkok time. Sheet 2 "คำอธิบาย" explains every column and how to import. Header row = the English column key; the importable headers are green, the information-only grey.
3. **New columns.** `Staff.createdAt`, `updatedAt` (set by every update from now on) and `lastLoginAt` (set at each sign-in). Accounts that existed before the migration show the migration time in createdAt / updatedAt (their real history was never kept) and an empty lastLoginAt.
4. **Import.** Reads staffId, firstName, lastName, branchCode, roles, active, phone; every other column is ignored. A staffId that exists is **updated**, one that does not is **created** (no password: it signs in by SMS OTP once it has a phone, or after an ADMIN's Reset; `mustChangePassword` false). Empty cell = unchanged; phone `-` = clear; a phone typed as a number without its leading zero is put right. Every row goes through the same rules as the staff form (ERP accounts keep their ERP-owned fields including the phone, D54/D85; the last ADMIN stays; non-ADMIN roles need exactly one branch). The file is **all or nothing**: any error and every dry run roll everything back and return the report (row number, action, changed fields or the message). The page always does the dry run first and shows the preview; only "ยืนยันนำเข้า" writes. At most 2,000 rows (the JSON body limit of the API is now 2 MB for this); deactivating a row signs that person out.
5. **Not in the file.** Passwords (in either direction), branches, and anything about customers. No audit table for staff changes exists; the import writes one log line (who, how many).

Addendum to D85 (2026-10-28): the ERP panel now shows, per run, how many eligible people have a usable mobile number (`มีเบอร์ (OTP)` / `ไม่มีเบอร์`) and lists the people without one (the run's warnings, which the panel did not show before). The staff page shows a banner while ERP accounts have no phone: how many, and the last real ERP import with its result, so it is visible why the numbers are missing (they only arrive when the import runs).

## D87 — Pick extra people from the ERP by hand (2026-10-29)

Owner: "ทำให้เลือกคนเฉพาะได้ไหมครับ เช่นผมเป็น dev อยากเพิ่มเข้า list ของ erp account ด้วย". The daily import (D54) only brings in active staff of the iStudio / U-Store branches whose position has a role, so a developer or a head-office colleague never became an ERP account.

1. **Where.** Admin → ซิงก์ ERP → "เพิ่มพนักงานจาก ERP เป็นรายคน": search the ERP by name or staff_id (`GET /admin/erp-sync/staff-search?q=`, 2 characters at least), pick a person, give them roles (**STAFF / STOCK / CASHIER** only) and an active SES branch. Stored in `ErpExtraStaff` (`PUT|GET /admin/erp-sync/extras`, `DELETE /admin/erp-sync/extras/:erpStaffId`).
2. **What the import does with them.** They skip the branch-scope and position rules and get exactly the roles and branch picked; everything else is as for any ERP account: the ERP is the source of the name, the `tel` (OTP phone) and the active flag (a person who is not "active" in the ERP is not imported, and an existing account is deactivated like any leaver), and in password mode the ERP password is still needed. The account is created by the next import (press "ซิงก์ตอนนี้" or wait for 10:00; a dry run shows the effect). Changing roles or branch is picked up the same way.
3. **Taking someone away** deactivates the account at the next import (nothing is deleted), as for an ERP leaver.
4. **ADMIN and MANAGER cannot be picked** (D54): ADMIN access must not depend on data HR can edit in the ERP, and with SMS OTP (D85) the phone in the ERP `tel` is what opens the account. A developer who needs ADMIN keeps or makes a hand-made account (with a phone, it signs in by OTP too); MANAGER can be added by hand on the staff page after the account exists.
5. **The lookup** asks the ERP for one narrow set of fields (staff_id, status, branch_group, position, first and last name; no password, no phone, no id numbers), at most once a minute (kept in memory), and lists only active people who are not yet an SES account or already picked. A staff_id that appears twice in the ERP is shown but cannot be picked (the import skips duplicates). A hand-made SES account with the same id refuses the pick (409): the import never touches hand-made accounts.

Addendum to D85 (2026-10-29): the login page shows two tabs, "OTP ทาง SMS" and "รหัสผ่าน", instead of a small link; the last choice is remembered in the browser. The password tab is for accounts SES made itself (the first ADMIN, hand-made accounts); an ERP-synced account is refused there by the server. The owner, signing in as the hand-made ADMIN `0001`, was sent a code by the OTP-first page and did not find the link.

## D88 — SES sends each order that reaches the cashier to FileMaker (2026-10-29)

Owner, relaying the FileMaker team: connect SES to FMP so the order SES holds reaches FMP; "ข้อมูลที่ส่งให้ FMP ก็ควรจะข้อมูลเหมือนกับ SES จริงๆ"; the FMP side then writes scripts on what arrives. FMP gave a dedicated Data API account (`ses`), layout `ses` and field `ses_body` of the UFService database on pos.uficon.net, and asked for the token to be released after use.

1. **When.** The moment STOCK sends the goods to the cashier (`send`, state `SENT_TO_CASHIER`). A row of `FmpOutbox` is written **in the same transaction** as the state change (nothing is lost if FileMaker is down); a worker (every 10 s, `FMP_WORKER_INTERVAL_SECONDS`) sends it.
2. **What.** One new record per message in layout `ses`, the order as JSON text in `ses_body`: `source: "SES"`, `event`, `outboxId`, `queuedAt`, `branch {code, name}` and then **exactly the order view the U POS door serves** (`orderView`, one function for both doors): `reference`, `queue` (e.g. "A012"), `state`, `customerPhone`, `staffId`, `confirmedAt`, `items[] {partNo, name, quantity}`, `accessories[]`, `payments[]`, `paymentTypes[]` (D89), `ontop[]`, `points[]`, `burnPoints[]`, `posBillNo`. The test compares the two byte for byte. **Not in it because SES does not have them: prices.** (Serial numbers were not there either; STOCK scans them since D92. The 2 sample records created in FMP on 2026-10-29 invented an `sn` array to show a shape.)
3. **The reference and the queue.** SES already has both for every order: `reference` (SES-YYYYMMDD-NNNNNN, the key, used by `POST /integrations/pos/bills` to report the bill back) and `queue` (letter + number, D70). Nothing has to be created for FMP; the message carries both, and SES keeps FMP's `recordId` on the outbox row.
4. **Delivery.** At-least-once. Per round: one login (`POST /sessions`, Basic header = base64 of `user:password` **without** the trailing `=`, as FMP specified; the standard padded form is tried once if refused), the creates (`POST /layouts/ses/records`), one logout (`DELETE /sessions/<token>`, also after a failure). A failure retries after 1, 2, 5, 10, 20, 30, 60 minutes (8 attempts), then the message is `failed` until an ADMIN presses "ส่งซ้ำ". A token FileMaker dropped mid-round is replaced once. FileMaker should dedupe by `outboxId` (a timeout after a successful create would be sent again).
5. **Script.** `FMP_SCRIPT` (empty = create only): when set the create also carries `script` and `script.param` = `{"source":"SES","reference","event","outboxId"}`; the script result and error are stored; a script error does **not** make SES send the record again (it exists).
6. **Dormant until configured:** `FMP_HOST`, `FMP_DATABASE`, `FMP_USER`, `FMP_PASSWORD` (Sensitive, in Coolify only), optional `FMP_LAYOUT` (default `ses`), `FMP_FIELD` (default `ses_body`), `FMP_SCRIPT`. Without them nothing is queued or sent.
7. **Admin.** Admin → "ส่งไป FileMaker": status, counts, the latest 50 messages with recordId and error, "ส่งซ้ำ" for failed ones, and a box to send an existing order again by `reference` (event `RESEND`, e.g. for the FMP team to test with a real order). Never shows credentials (D90 adds the log, where bodies are kept with phones and the token masked).
8. **Not decided / open.** Only the first event (order at the cashier) is sent; an order cancelled or sent back to stock afterwards is **not** yet reported to FMP (event types `CANCELLED` / `RETURNED_TO_STOCK` would be the next ones). SNs (STOCK scanning them at pick time). Whether FMP wants the order again when the same session is sent twice (after a cashier reject): today each send is a new record with the same `reference`.

## D89 — Each payment method is filed under an FMP payment type; the push sends `paymentTypes` (2026-10-30)

The FileMaker team (Thai side) lists payment **types** — เงินสด, โอนเงิน, บัตรเครดิต, บัตรเงินผ่อน, ใช้มัดจำ, Trade In, U-Joy, Partner Mall — while SES stores the **method** staff picked (`Cash`, `Transfer`, `PayNext`, …, D66), which is finer and ADMIN-extendable. Owner, after seeing the FMP sample record: send the type as well, so FMP keeps no mapping table of its own.

1. **Data.** `PaymentMethod.fmpType` (nullable, additive migration `202610300001`): one of the nine types above plus `อื่นๆ` (`FMP_PAYMENT_TYPES` in `payments.service.ts`; the web list `fmpPaymentTypes` in `constants/options.ts` is the same, a test keeps them in step). The migration pre-fills four: `Cash`→เงินสด, `Transfer`→โอนเงิน, `Full Credit Card`→บัตรเครดิต, `0% Credit Card`→บัตรเงินผ่อน. **Those four are SES's reading of the FMP list, not yet confirmed by the FMP team**; every other method (SPayLater, TrueMoney, PayNext, UFund, Ulite, Thisshop, Kashjoy, and anything ADMIN added) stays unset until the business says which type it is.
2. **Admin.** Admin → ช่องทางชำระเงิน: a "ประเภทใน FileMaker" selector per method (`PUT /payment-methods/:id/fmp-type {fmpType}`, ADMIN; `null` clears) and an optional one when adding (`POST /payment-methods {name, fmpType?}`). The name still never changes; the type may.
3. **What is sent.** `orderView` (the one description of an order, so the U POS door and the FileMaker push both) gains `paymentTypes[]`: the types of the order's payments, **each once**, in the order picked; a method with no type, or a name SES no longer lists, is `อื่นๆ`. `payments[]` is unchanged (the method names as picked). Types are looked up by name without regard to case, once per door call (`loadPaymentTypes`).
4. **Not done.** "U-Joy" is both a payment type for FMP and, in SES, a points name (`UJOY` in `points[]` / `burnPoints[]`); SES does **not** turn points into a payment type. If the business wants it, ADMIN adds a payment method (e.g. `U-Joy`) and files it under "U-Joy". Same for ใช้มัดจำ / Trade In / Partner Mall: SES had no such methods; ADMIN adds them. SES still stores no amounts per method (D58), so FMP learns which types were used, not how much each.

## D90 — An admin log of everything between SES and FileMaker, and a callback door for FileMaker's reports (2026-10-30)

Owner: "ทำ logs ไว้สำหรับ admin … dev จะได้ดูว่าส่งไปเส้นไหน ทำอะไร fmp ส่งกลับมาว่าอะไร; ทำ webhook ให้ fmp ส่งกลับมาด้วย เช่น ส่งค่าว่าทำรายการสำเร็จ … แล้วเดี๋ยวรอดูเขาส่งเวลามาไหม". Until now the admin page showed one status per message and "never bodies" (D88); a developer could not tell what SES sent, to which URL, what FileMaker answered, or whether FileMaker did anything with the record.

1. **The log** (`FmpLog`, additive migration `202610300002`; Admin → ส่งไป FileMaker → "บันทึกการสื่อสาร"). One row for: every Data API call SES makes (`OUT`: login — including the first, refused, form of the Basic header —, create, logout) with method, path (no host; the token that ends a logout path is `[token]`), HTTP status, FileMaker's code and message, duration, what was sent and what came back; every report FileMaker sends (`IN`); and SES's own steps (`SES`: queued, retry / resend with the ADMIN's staff id, "will retry in N minutes", "gave up"). The calls of one worker round share a `batchId`. Filters: reference (part of it), direction, only problems; paging; a row opens to show the bodies (`GET /admin/fmp/logs`, `/logs/:id`, ADMIN only).
2. **What is never stored.** The password and the Authorization header (never logged), the Data API token (masked in responses and paths), and customer phone numbers: any value under a phone-like key (`phone`, `tel`, `mobile`, `msisdn`) is masked to its last four digits — in the order SES sent and in whatever FileMaker reports. Bodies are cut at 8,000 characters. Rows older than **90 days** are cleared by the worker (at most every 6 hours). A log row that cannot be written is only a warning: it never stops an order, a send or a report.
3. **The callback door.** `POST /api/integrations/fmp/callback`, server to server, `Authorization: Bearer <FMP_CALLBACK_KEY>` (same shape as the U POS door, D60: key of 32 characters at least, constant-time compare, **404 with the reason while the key is unset**, 401 for a wrong one; a refused caller leaves no log row, so nobody can fill the log). Body: `outboxId` (what SES put in the record; unique per message) **or** `reference` (its latest message); `status` ("success" / "error" — case does not matter; a boolean works; anything else is kept as `reported`; a number is **never** read as a result, FileMaker's 0 means "no error"); optional `message`; optional `time`. Everything else FileMaker adds is kept in the log. The answer echoes what SES understood (`status`, `time`, `timeReceived`) so the FileMaker developer can see their report was read as intended.
4. **The time.** Read when it is ISO 8601 with an offset or `Z`, the same without an offset or as `YYYY-MM-DD HH:mm:ss` (**read as Bangkok time**), or epoch seconds / milliseconds. FileMaker's own `MM/DD/YYYY` text is **not guessed** (day and month are ambiguous): the text stays visible, with "อ่านเวลาไม่ได้". The page says plainly whether FileMaker sent a time: "เวลาจาก FMP …", "FMP ส่งเวลา "…" (อ่านไม่ได้)" or "FMP ไม่ได้ส่งเวลา". The owner is waiting to see whether FileMaker sends one; nothing depends on it.
5. **What a report does.** It **only records**: `ackStatus`, `ackMessage`, `ackAt`, `ackTimeText`, `ackReceivedAt` on the `FmpOutbox` row (shown in the admin table) and a log row. It does **not** change the order, move it to another step or set a bill number (the bill still comes back through `POST /integrations/pos/bills`, D60). It may arrive before SES has marked the message `sent` (FileMaker's script can run on the create); it is accepted whatever the message's status. Repeating a report is fine: the latest is shown, every one is logged; sending the message again afterwards does not erase it.
6. **Not decided.** Whether a report of `error` should alert someone or put the order back for retry; whether FileMaker's bill number should be taken from a report instead of the U POS door; a public contract page for FileMaker (the contract is `docs/agents/fmp-outbound.md`; the route is also in the ADMIN API docs, `/api/docs`).

## D91 — The FileMaker script is called with the reference alone (2026-10-30)

KoB (FileMaker team), relayed by the owner: the script is named `ses`, "parameter เป็น ses id (reference ทางฝั่งเอ็ม)". D88 item 5 sent a JSON text (`{"source","reference","event","outboxId"}`) as `script.param`; a script that reads its parameter as the order's id would look up the whole JSON text.

1. **Changed.** When `FMP_SCRIPT` is set, the create carries `script` = its name and `script.param` = the order's **`reference`** (`SES-YYYYMMDD-NNNNNN`) as plain text, nothing else. `event` and `outboxId` are in the record itself (`ses_body`), as before. Replaces D88 item 5's parameter; the rest of item 5 stands (the script result and error are stored; a script error does not make SES send the record again).
2. **Owner to set** `FMP_SCRIPT=ses` in Coolify (api app) and restart. Not set yet = records are created and no script runs.
3. **Two records can share a reference** (the first send and a `RESEND`): a script that finds the record by reference should take the latest, or read `outboxId` from `ses_body` if it needs exactly one.
4. **(Resolved by D92: STOCK scans them.) Open, blocks the bill script: serial numbers.** KoB's script "opens the bill" and was written from the sample record that carried `sn` per item. SES has no SN (stock is by part number; D88 item 2): the records SES sends have no `sn`, so that script cannot open a bill from them. Options for the owner and FileMaker to choose between: (a) the FileMaker script opens the bill without SN and the cashier scans the SN in FileMaker (no SES change); (b) the cashier scans SN into SES at the scan step (step 2 only stamps `cashier_scan_at` today) and SES sends a second event with `items[].sn` then; (c) STOCK enters SN at pick time. Nothing is built; the choice changes when the bill can be opened (at once, after the scan, or when stock sends).

## D92 — STOCK scans the serial number of every unit when it sends the goods; the FileMaker message carries them (2026-11-02)

KoB (FileMaker team) finished the script `ses` (called by the Data API with the reference as its parameter; it creates a held bill in `pos_front_sale_tmp` with one line per serial number and fills the bill from FileMaker's own stock) and asked the owner which way SES sends: with `sn` as the script was written, or without (then the script is rewritten). Owner asked whether ERP / warroom can supply `sn`, `upc`, `sku`. Chosen among three (owner, 2026-11-02): **STOCK scans the serial numbers when it presses "send"** — over the cashier scanning at step 2 (bill opens later, script must accept another state) and over sending no SN (script rewritten, cashier scans in FileMaker).

1. **Capture.** Step `send` (STOCK) takes `serials: [{itemId, sn: [...]}]`: for **every main product exactly `quantity` serial numbers**, each printable ASCII without spaces (1–64), none twice in the order (any case). Trimmed (a scanner's line break), kept in the order scanned (`SessionItemSerial`, additive migration `202610310002`). Missing, wrong count, an unknown item, a bad character or a duplicate → 400 and the goods stay at stock; nothing is saved. An order with no main product (accessories only) has nothing to scan. The stock page shows one box per unit under the product, a scanner's Enter moves to the next box, the send button wakes up when all are valid; the cashier's order summary shows them.
2. **One unit, one order.** A serial that is in another order that is **still open** (not cancelled, not completed) is refused (409, names that order's queue). Once that order is cancelled or sold the serial is free again (returns and resales are real). Two scans at the very same moment can both pass; FileMaker's script refuses the second bill (`SN_ALREADY_SOLD_OR_HELD`). When the cashier **sends the order back to stock** (F13) the serials are cleared (the units went back to the shelf); STOCK scans again at the next send.
3. **Message.** `items[]` is now `{partNo, upc, name, quantity, sn[]}` for **both** doors (the U POS door and the FileMaker message share `orderView`; `upc` is the warroom barcode, null when unknown). The FileMaker message also carries what the script checks first: `version: 1` (it refuses any other), `test: false`, `createdAt` = the moment the message was made, **Thai local time with its offset** (`2026-11-02T14:40:12+07:00`; the script reads the digits as written). Orders sent before this change have no serials (a resend of one gives `sn: []`, which the script refuses).
4. **Why SES does not pick the serial itself from ERP / warroom.** Warroom keeps one row per serial (`mart.stock_current`: `product_sn`, status, branch, part number, UPC; documented in `erp-integration.md`, not checked against the live database for this decision) but is loaded 5 times a day (up to 12.5 h old), and SES cannot know *which* unit is on the shelf in the customer's hands. A serial chosen by the system could be one already sold, or another physical unit than the one handed over: a bill with the wrong serial makes the stock wrong. The ERP *is* FileMaker (warroom copies it), and the script already checks every serial live against it: in stock, `ready`, this branch, the same part number, has a price, not sold or held. So the people scan, FileMaker verifies. Not built, possible later: SES warns (not blocks) when a scanned serial is not `ready` for that branch in warroom.
5. **Notes for the FileMaker team** (from reading the script; they are theirs to settle, written in `fmp-outbound.md`): the script refuses any order with accessories (`ACCESSORIES_NOT_SUPPORTED`; most SES orders have some); it maps `payments` by English words (Cash, Credit Card, Installment…), while SES sends its own method names — `paymentTypes` (D89) is the field meant for this; the customer must already exist in FileMaker by phone (`WRONG_PHONE`); `state` must be `SENT_TO_CASHIER` (a resend after the cashier moved on is refused); it finds its record by `ses_id` and needs exactly one (a "send again" makes a second record with the same reference → `NOT_FOUND`); `staffId` is read as a number.
6. **Not decided.** If the barcode on an Apple box adds a prefix to the serial (Apple's serial barcode often starts with `S`), the stock team must scan so that FileMaker's serial is what SES holds; SES stores what it is given. A damaged unit the cashier removes afterwards (D75) is not told to FileMaker.

## D93 — ADMIN can look at what warroom holds per serial number (2026-11-02)

Owner, asking whether warroom could supply the serial numbers the FileMaker script needs (D92): "ลองดูเองก่อนเลย" — look at a sample and compare it with FileMaker. Warroom's Postgres is reachable only from inside the Coolify network (its host name is internal), so a person's machine cannot query it; SES's API already can (`WARROOM_DATABASE_URL`, read-only role).

1. **What.** `GET /api/admin/warroom-sync/serials?branch=<branch code>&part=<part number>[&take=10]` (ADMIN only; also in `/api/docs`, a GET can be tried there or typed in the address bar while signed in). It reads `mart.stock_current` (the per-serial view, documented in `erp-integration.md`) in the same way as the sync: `BEGIN READ ONLY`, 20 s timeout, parameterised; at most **20 rows** (default 10), a **fixed list of columns** (`product_sn, status, status_sub, stock_type, branch_code, branch_name, product_model, product_upc, product_name, qty, transfer_date, age_in_branch`; never a price, cost or supplier), the part compared without regard to case. The answer has the view's **column list** (so a different name shows up as such), the columns that are missing, `snapshotAt` and `ageMinutes` (from `mart.stock_mv`), the count by status and the first rows ordered by status then serial. No free SQL; nothing in a workflow uses it.
2. **Why only a lookup.** D92 item 4 stands: SES does not pick serials from warroom (up to 12.5 h old, cannot know which unit is handed over). This is to compare formats (case, an `S` prefix on Apple's serial barcode), statuses and age with FileMaker before deciding on a *warning* when a scanned serial is not `ready` for that branch in warroom.
3. **First answer from the live view (owner, 2026-11-02).** `mart.stock_current` has 25 columns: `stock_type, snapshot_at, no_inv, product_sn, product_upc, product_name, product_model, product_cat, product_subcat, product_subsubcat, qty, cost_before_vat, price_sell, age_in_stock, age_in_branch, status, status_sub, branch_code, branch_name, po_id, supplier_name, zone, transfer_id, transfer_date, branch_from_id`; `snapshotAt` 08:17Z (15:17 Bangkok, the 15:15 slot) was 167 minutes old at the time; branch `IS-TM` with part `MK2H4ZP/A` matched **no** serial (total 0). The first version guessed `date_transfer` (the real name is `transfer_date`). Since then an empty answer also returns `hints`: how many serials the branch code holds at all, the branches that hold that part, and the branches whose code or name looks like the one typed.
4. **Second answer (owner, 2026-11-02):** `hints` came back empty: the branch code `IS-TM` holds **no** serial in `mart.stock_current`, no branch code or name there looks like it, and the part `MK2H4ZP/A` is in no branch. So either those two (the branch SES and FileMaker call `IS-TM`, and the part of the test order) are not in the per-serial view, or it spells them differently. To see which, `?list=branches` (every branch code with its count in `stock_current` **and** its quantity in `stock_mv`, the view the SES stock sync reads) and `?list=parts&branch=<code>` (the same for the parts of one branch) were added: counts only, ≤ 60 rows. The owner also considered reading FileMaker's OData instead; **not recommended per scan or per order** (the ERP is the shops' own server and fragile, `erp-integration.md`; SES must not call it per user action), and unnecessary because the `ses` script already checks every serial live inside FileMaker. A one-off narrow OData read for a comparison needs the owner's say-so and a health check first.
5. **Not decided.** That warning (not built); keeping or removing this route afterwards.

## D94 — Only ERP branch codes: the hand-made branches were removed, and the branch form warns about a non-ERP code (2026-11-03)

While testing the FileMaker script (D91/D92) the order B001 was in a hand-made branch `IS-TM`. A read of the ERP (`branch`, 45 rows, 2026-11-03 00:05) showed **no** `IS-TM`: Terminal 21 Asok is `ISTA` (branch_id 9). The script finds the branch by `branch_code`, warroom keys stock and serials by it (D93 found nothing under `IS-TM`), and the SES warroom sync matches `Branch.code` to it, so every hand-made code (`IS-FI`, `IS-TM`, `US-PSU` …, made before the ERP's format was known) silently broke all three. Owner (grilling session, 2026-11-03): remove every branch that is not from the ERP, keep `HO`; the data on them is test data; move their staff to the ERP branch first.

1. **Done on production, 2026-11-03 00:48 Bangkok,** in one transaction run by the agent at the owner's request, against `service_efficiency` on the Coolify MySQL (`mysql-uat`) with the API's own credential over Tailscale (read from Coolify's API, never printed or stored). Every count was checked against a read-only dry run first and again inside the transaction; any mismatch rolled everything back (two runs were rolled back by over-strict checks of the script itself, verified unchanged before the third). **No backup was taken, by the owner's explicit choice** (all affected data was test data). Result: 12 branches deleted (`IS-FI IS-KBI IS-KKC IS-TM IS-TMK US-PSU US-SRU US-SWU US-SWUOK US-UBRU US-WU US-WUH`, with their 11,040 zero-stock inventory rows), staff moved without other change (`1101–1104` → `ISFI`, `1000` → `ISTA`, `1105` → `USPSU`; they stay hand-made accounts), the 6 orders of those branches deleted (all the orders SES had, all tests, B001 included) and their 3 queue counters. Kept: the 16 ERP branches and `HO`; the 2 FileMaker outbox rows of B001 (they now name an order that no longer exists; they age out); FileMaker's own test records (theirs to delete).
2. **Branch form.** Admin → จัดการผู้ใช้ → Branch: for a branch that is not from the ERP, a code the ERP does not know shows a warning (FileMaker will answer `WRONG_BRANCH`, no stock or serials from warroom, with real codes as examples), and a code that repeats an ERP branch's code says to use that branch. A warning only: a hand-made branch can still be made (owner: future hand-made branches are not part of this). `branchCodeWarning` in `apps/web/src/utils/branchCode.ts`.
3. **Not done.** No branch delete in the product (this was a one-off); hand-made staff whose id equals an ERP staff id (for example `1000`) still keep the ERP import from creating that person (D87, unchanged).

## D95 — Serial numbers reach FileMaker complete: one record per order, the script's answer shown, capitals (2026-11-03)

Owner: "ตรวจสอบ แล้วทำให้ product_sn ส่งให้ fmp แบบสมบูรณ์". A read of FileMaker's `ses` inbox (OData, 2026-11-03 01:10) showed 4 records: the FMP team's 2 samples and SES's 2 (B001 and one more), both from before D92 (no `sn`, branch `IS-TM`), and `ses_status` empty on all: **the script never ran**, because `FMP_SCRIPT` is not set on the SES api in Coolify. Reading the script against what SES does left four gaps.

1. **One record per order.** The script finds its record by `ses_id` (= reference) and refuses anything but exactly one (`NOT_FOUND`). SES created a new record for every message, so a second send of an order (after a cashier reject and a new scan, D92, or an ADMIN's "ส่งซ้ำ") could never be processed. Now the first message of an order creates the record and every later one **updates** it (Data API `PATCH …/records/<recordId>`, the id kept on the outbox row) with the new body and runs the script again; if FileMaker no longer has the record (code 101) it is created anew (logged as `record-gone`). This replaces D88 item 4's "each send is a new record"; `outboxId` in the body still names the message.
2. **The script's answer is read.** Its result is JSON `{ok, code, sesID, saleID, lines, message}`; SES stores it as the order's FMP report (`ackStatus` success / error, `ackMessage` e.g. `CREATED saleID S-77 (3 รายการ)` or `SN_NOT_FOUND: SN … not found in stock`) and logs it (`IN`, kind `script`), so the admin page shows whether FileMaker took the serial numbers. The message stays `sent` either way (the record exists; sending again would change nothing). `ALREADY_DONE` on an **update** is shown as an error: the bill was opened from an earlier send, so the serials just sent were not used and the held bill must be dealt with in FileMaker first.
3. **Capitals.** Serial numbers are stored and sent in capitals (FileMaker's are: Apple serials and IMEIs; every one of ~30 seen on 2026-11-03), so a typed lower-case one cannot miss.
4. **What to scan.** The stock page says to scan the serial barcode on the box (Mac/iPad: starts with `S`, as FileMaker keeps it; iPhone: the IMEI).
5. **Switched on.** At the owner's go, `FMP_SCRIPT=ses` was set on the SES api in Coolify and the api restarted (2026-11-03 01:55 Bangkok; boot log: "FileMaker push on"): from now on every send runs the script, which opens a held bill in the shops' live FileMaker. To switch it off: remove the variable and restart. **Still the owner's / FileMaker's:** what FileMaker does with a held bill when an order comes back after a cashier reject (`ALREADY_DONE`); the script's other refusals (accessories, payment words, unknown customer phone, state on a resend: `fmp-outbound.md`).

## D96 — A retry never makes a second FileMaker record; script runs may take 60 s; a Thai guide for the FMP team (2026-11-03)

1. **Why.** The `ses` script looks every serial number up in `ProductStore_detail` (about 1.85 million rows); SES waited 15 s for any Data API call. A create whose script ran longer would time out in SES, be retried, and (no record id known) create a **second** record of the same order, which the script then refuses (`NOT_FOUND`).
2. **What.** A create or update that runs the script waits up to **60 s** (login, logout and finds keep 15 s). A message that is being tried again (attempt > 1) and whose order has no known FileMaker record first **looks the order up** (`_find` on `ses_id` = reference, the newest record if several) and updates it instead of creating; logged as `find`.
3. **Guide.** `docs/agents/fmp-team-th.md`, in Thai, for the FileMaker team: why SES sends orders, the connection, every field, a step-by-step check of their `ses` / `ses_fail` scripts against what SES sends (usable as is for orders without accessories, with a payment, for a known customer), what they should change and in which order (accessories, `paymentTypes` mapping, new customers, no payment, the held bill after a cashier reject, picking the newest record, `staffId`, an index on `product_sn`), and how FileMaker reports the bill back (`POST /api/integrations/pos/bills` with the POS key moves the order to BILL_OPENED; the D90 callback only records).

## D97 — Accessories are added by the shop in FileMaker; the FileMaker message carries them as a note only (2026-11-03)

Owner: "อุปกรณ์เสริมไม่ต้องห่วง ให้หน้าร้านเพิ่มกันเอาเอง … ข้ามฝั่ง SES ไป". The FileMaker `ses` script refuses any order whose `accessories` is not empty (`ACCESSORIES_NOT_SUPPORTED`), and most orders have some; SES accessories are free names without SKU or serial, so they cannot become bill lines anyway.

1. **What.** In the FileMaker message `accessories` is always `[]`; the accessories the customer picked are listed under `accessoriesForCashier` (`[{name, quantity}]`), for information only. The cashier adds them to the bill in FileMaker. The script needs no change.
2. **Unchanged.** Picking accessories in SES (staff), finding them (stock), the receipt, the summary, and the U POS door (`GET /integrations/pos/orders` still lists `accessories`). This is the one place where the FileMaker message and the U POS view differ on purpose (D88 had them identical).

## D98 — SES edits the FileMaker `ses` script to match what SES sends; a ready-made `ses_report_bill` (2026-11-03)

Owner: "เขาให้ไฟล์ ses.rtf มาให้เราแก้ไขได้ … แก้ไขให้ตรงกับที่เราเป็นทั้งหมดล่าสุดไปเลย". The FMP team's export (`ses.rtf`, `ses_fail.rtf`) is kept in `docs/agents/fmp-scripts/` with v2 next to it; every change is marked `[SES v2]` and listed (in Thai) in `fmp-scripts/README.md`. The export cannot be pasted back into FileMaker: the FMP team applies the steps by hand; the three lines FileMaker truncated in the export (`$createdAt`, the `$snRow` SQL, the old `Substitute`) are either untouched or replaced whole.

1. **`ses` v2:** reads `paymentTypes` (Thai types → the PayBy labels the script already used), a missing customer (`ALLOW_UNKNOWN_CUSTOMER`) or payment (`ALLOW_NO_PAYMENT`) no longer refuses the order but opens the held bill and warns (both switches default 1; 0 = the old refusal), the accessories check is gone (D97), several records of one `ses_id` use the newest, a `staffId` FileMaker does not know is left empty, and the result adds `message` (the warnings in Thai, shown by SES) and `warnings`. **`ses_fail` v2:** acts on the current record when there is at least one.
2. **`ses_report_bill` (new):** called by FileMaker when it issues the bill of a held bill that came from SES; posts `{reference, billNo, openedAt}` to `/api/integrations/pos/bills` with the POS key (kept in a restricted FileMaker field, never in the script) and a non-curl User-Agent: Cloudflare in front of ses.uficon.com answered 403 to curl's default user-agent and 401 (reached the API) to any other, tested 2026-11-03.
3. **Still FileMaker's:** the PayBy labels of Trade In / U-Joy / Partner Mall / อื่นๆ, the two switches, what to do with a held bill when the cashier sends the order back (`ALREADY_DONE`), an index on `product_sn`, where to call `ses_report_bill`. Nothing here is verified inside FileMaker.

## D99 — A double click or a retry applies a session action once; the loser gets 409 (2026-11-03)

H-01 (S1): every session action read the session, checked its state, then wrote in a transaction without checking again, so two quick clicks (or a retry) on "found" took the units off the shelf twice, a double cancel or cashier "send back" gave them back twice, and events and timestamps were doubled. Answers OQ-06 (the HTTP contract of a duplicate).

1. **What.** Each state-changing action (step `advanceStep`, `confirmPurchase`, `recordOutOfStock`, `cancelSession`, `cashierReject`, `cashierRemoveDamaged`, `acknowledgeStockCancel`, `reportStockMissing`, `resolveStockReview`) first claims the session row in its transaction: `SELECT id … WHERE id = ? AND <the method's own precondition> FOR UPDATE`. The second request waits for the lock, reads the committed row, finds the precondition false and gets **409** "รายการนี้ถูกดำเนินการไปแล้ว (อาจกดซ้ำ) กรุณารีเฟรชหน้า". A click that arrives after the first has finished still gets the old 400 from the plain read. Removing damaged items also re-counts the items inside the lock.
2. **Proof.** `tests/double-click.test.mjs` fires each action twice at once: before the fix "found", "cancel" and "cashier reject" double-applied on every run (3/3); after it, stock moves once and there is one event.

## D100 — Every order shows its FileMaker side to the shop (2026-11-03)

Until now what FileMaker did with an order (delivered or not, the `ses` script's answer, D95) was visible only on the ADMIN page; a cashier could not tell that FileMaker had refused a serial number, and stock found out only when the bill did not appear.

1. **What.** `GET /sessions` and `GET /sessions/:id` carry `fmp`: the order's latest message to FileMaker (`status` pending / sending / sent / failed, `attempts`, the delivery `error`) and FileMaker's answer (`ackStatus` success / error / reported, `ackMessage`), or `null` when nothing was sent. Never the message body (it carries the customer's phone).
2. **Where.** One line "FileMaker:" in the order summary (staff, stock, cashier) and, on the cashier's order, a banner above the steps; red when FileMaker refused or the delivery failed. A serial-number refusal (`SN_…`) says what to do: send the order back to stock to scan again (the next send updates the same FileMaker record and runs the script again, D95).


## D101 — Every step's time is the real one: STOCK scans at the shelf, FOUND records itself, the POS closes the sale (2026-11-04)

Owner, on the readiness review (fewest taps and fewest mistakes for staff, stock and cashier): "stock_found_at จะเท่ากับเวลาที่ส่ง เอาตามความจริงที่ควรเก็บ ไม่ใช่แล้วทำให้เวลาคลาดเคลื่อน". Removing the "found" tap by recording FOUND when STOCK presses "send" would have made `stock_found_at` the hand-over time. Instead every time comes from the moment the thing really happened, and no time is ever made up.

1. **Start.** STOCK_REQUESTED cards in the stock queue carry a **"เริ่มหา"** button (renamed "รับงาน" by D102): one tap when STOCK walks to the shelf (`stock_started_at`). Opening a card to look still starts nothing (the reason it is a button and not "open = start").
2. **Scan at the shelf.** While SEARCHING (and still while FOUND, until the goods leave stock) STOCK scans the serial of each unit as it picks it: `POST /sessions/:id/serials {itemId, sn}` saves one at once with the server time (STOCK/ADMIN only; trimmed, capitals, printable ASCII 1–64; refused: a repeat in the order or more than the quantity 400, a unit in another open order 409). A wrong scan is taken back: `DELETE /sessions/:id/serials/:serialId`. The screen shows one box per product while units are left; a fast scanner never types into a box still waiting for the server (the box clears at Enter and the scans are saved in order behind it).
3. **FOUND records itself.** The moment the last unit is scanned (or the last accessory ticked) the stock screen records FOUND, so `stock_found_at` is the time the last thing was found. The "found" button stays for a retry and for an order that comes back complete (the customer accepted what was found, an item change).
4. **Send.** "ส่งสินค้าไปที่แคชเชียร์" is pressed at the hand-over, separately (`SENT_TO_CASHIER`, and the FileMaker message, D88/D92). `send` without `serials` uses the saved ones and needs them complete (400 "สแกน Serial Number แล้ว n จาก q เครื่อง"); a full list is still accepted (it replaces the saved ones, D92).
5. **Missing.** A main product counts as found only when all its units are scanned; "แจ้งสินค้าไม่ครบ/หมด" reports the others (unchanged flow, D73).
6. **Swapped product.** Changing a product (staff or cashier) drops the serials scanned for the old one (they belong to another SKU); the other products keep theirs. Before, they stayed on the item and a send would have used them.
7. **Cashier.** The bill time comes from FileMaker (`ses_report_bill`, D98). New: `POST /integrations/pos/bills` takes an optional `completedAt` = the moment the customer paid, and moves a `BILL_OPENED` order to `COMPLETED` at that time (event by `U-POS`); plausibility as `openedAt`, and not before the bill. `ses_report_bill` v2 sends it with `"paid": 1`; one call with both times when FileMaker opens and pays in one go. The cashier's "รับสินค้า", "สแกน" (`cashier_scan_at`), "เปิดบิล" and "ปิดการขาย" buttons stay: FileMaker has not applied the scripts yet, and a button press is a real time too.
8. **Not changed.** ACCEPT_PARTIAL (the customer takes what stock found, D73) still stamps `stock_found_at` at the staff's decision, not at stock's report; whether to move it to the report time is the owner's call.

## D102 — STOCK can record "found" without scanning; the serials are still complete before "send"; the start button is "รับงาน" (2026-11-05)

Owner, after trying D101 on the stock screen: "สามารถกดรับได้โดยที่ไม่ต้องแสกนด้วย … ปุ่มที่เขียนว่า เริ่มหา เปลี่ยนเป็น รับงาน". With D101 a main product counted as found only once all its units were scanned, so a shop without a scanner at the shelf could not record FOUND.

1. **Found without scanning.** While SEARCHING each main product has a **"พบแล้ว"** tick next to its scan box. A product counts as found when all its units are scanned **or** it is ticked; FOUND is still recorded by itself the moment everything (products and accessories) is found (D101), so `stock_found_at` stays the real moment. "แจ้งสินค้าไม่ครบ/หมด" reports the products neither scanned nor ticked. When the cashier sends an order back or swaps a product, the products that were not at fault come back ticked (the D78/D82 pre-selection).
2. **Serials before send (unchanged).** "ส่งสินค้าไปที่แคชเชียร์" stays disabled, and the server refuses `send`, until every unit has a serial (FileMaker opens the bill from them, D92); the FOUND panel says so and keeps the scan boxes. Read as: scanning may move from the shelf to the hand-over, not disappear. Making serials optional at send would leave FileMaker's `ses` script refusing those orders, so it is not done without the owner saying so.
3. **"รับงาน".** The start button (queue card and order) is renamed "รับงาน"; it still records `stock_started_at`.

## D103 — A unit in the shop that FileMaker does not have here yet is sold anyway: "send with serials missing", the cashier scans it in (2026-11-05)

B001 (ISTA): FileMaker answered `SN_WRONG_BRANCH: SN … is in branch 16, not ISTA (9)`. The unit had come from The Mall Ngamwongwan (ISTM) and was on the shelf, but the transfer was not received in FileMaker yet, so the `ses` script refused the whole order and the shop could not sell. SES keeps no stock by serial (FileMaker is the only truth). Owner chose option A of two (B, a live serial check against FileMaker at the shelf, may follow): "หากไม่มี SN จริงๆ ก็สามารถส่งไป FMP ได้ เป็นเหมือนให้กดหรือแสกนเข้าทีหลัง".

1. **SES: send with serials missing.** In the FOUND panel, when serials are missing, STOCK has a second button "ส่งโดย SN ยังไม่ครบ (n เครื่อง)" with an inline confirm that says when to use it (the unit is here; the scan fails or FileMaker is behind) and what happens. The step is `{action:'send', serialsLater:true}` (only with the saved serials; 400 with a list or on another step); the event keeps `{serialsMissing: n}`. "send" without it still refuses an incomplete set (D101).
2. **The message.** `items[].snMissing` (both doors, `orderView`) = units without a serial. `version` stays 1: the old scripts refuse such an order with `SN_COUNT_MISMATCH` (shown as now), complete orders are unchanged.
3. **FileMaker script `ses` v3** (`docs/agents/fmp-scripts/ses_v3.txt`, written by SES for the FMP team, as D98): `$ALLOW_SN_LATER = 1` opens a line **without a serial** (price and names from the model in `ProductStore`) for every missing unit and for every serial FileMaker does not have here yet (`SN_NOT_FOUND`, `SN_WRONG_BRANCH`, `SN_NOT_READY_FOR_SALE`), instead of refusing the order; a wrong model, a sold / held serial or a repeat is still refused (a wrong pick). Its answer is `CREATED_SN_LATER` with `snPending` and the reasons.
4. **Shown.** The order summary (staff, stock, cashier) says "รอสแกน SN ใน FileMaker n เครื่อง" per product; `CREATED_SN_LATER` is a yellow FileMaker line ("scan the serial in FileMaker at the till; a transferred unit: receive the transfer first"). A refusal for a serial FileMaker does not have here yet now hints both ways out: receive the transfer in FileMaker then ADMIN "ส่งซ้ำ" (the script runs again after an error), or send back to stock if it was a wrong pick.
5. **Not decided / not verified.** Whether FileMaker's till lets the cashier scan a serial into a held line that has none (asked in the Thai guide §5.1); the `ProductStore` column names in the v3 SQL (taken from the visible part of `$snRow`, whose export is truncated); nothing runs inside FileMaker until the FMP team applies v3. FileMaker's own stock still needs the transfer received before the sale is closed.
6. **Update, same day (FMP team's answer).** The serial on a bill line is a back-office field the cashier cannot fill, so a line without one would be stuck. Script v3.1: such a unit is **left out of the held bill** (no line is written; the `$partRow` lookup is gone) and the cashier scans it in at the till as an ordinary sale; when every unit is left out the held bill is still opened (customer, payments, queue) with no product line. The answer is still `CREATED_SN_LATER` with `snPending` (now "units left out"). SES says "ไม่อยู่ในบิลพัก: แคชเชียร์สแกนขายเพิ่มใน FileMaker n เครื่อง" and the yellow line tells the cashier to scan the missing units in. The FMP team confirmed the `ProductStore` field names (no longer used).

## D104 — The stock screen checks each scanned serial against the stock data, without loading FileMaker (2026-11-05)

Owner, after B001 (D103): "ต่อตรงกับ FMP ได้ไหม"; on the warroom lookup: "ทำเส้นเพื่อเชื่อมกับ odata เองได้เลยไหม … ทำไว้เผื่อก็ดี เพื่อทำงานแบบ seamless"; then: "ผมต้องการแค่ดึง sn ตัวเดียวจากที่เขาแสกน … ไม่กระทบกับ FMP, WarRoom มากนัก". FileMaker's `ses` script checks the serial only when the order reaches the cashier, so STOCK learnt about a wrong or not-yet-received unit too late.

1. **What.** `GET /api/stock/serial-check?sn=…[&part=…]` (STOCK, CASHIER, ADMIN): one serial, and the verdict `here` (ready in this branch), `not-ready` (with the status, e.g. transfer), `other-branch` (with the branch: e.g. a transfer not received), `other-model` (a wrong pick) or `not-in-stock`, with the source and how old its picture is.
2. **Source.** `SERIAL_CHECK=warroom` (default): warroom's `mart.stock_current`, current stock only (~88k rows), one read-only query of at most 2 s; nothing reaches FileMaker; up to ~3 h behind (12.5 h overnight), so the screen says so. `SERIAL_CHECK=fmp`: FileMaker live over the ERP OData, one serial and four columns, **only after the FMP team indexes `ProductStore_detail::product_sn`** (measured 2026-11-05: without the index a single-serial query did not answer in 30 s and a UPC + ready query in 15 s, so a per-model list was dropped). Guards for `fmp`: one request at a time, 5 s, no retry, a 10-minute pause after a failure, a one-minute cache, nothing around warroom's pulls (H-40). `off` switches it off.
3. **On the stock screen.** Every saved serial gets a mark: "✓ สต็อก" or a yellow "อยู่ ISTM" / "สถานะ transfer" / "รุ่นไม่ตรง (…)" / "ไม่พบในสต็อก", with what to do (a wrong pick: remove and scan another; a transfer not received: have it received in FileMaker) and, for warroom, that the data can be hours old. It only informs: nothing waits for it, and "off"/"unavailable" shows no mark.
4. **Next.** When the index exists: one off-peak measurement of the single-serial query, then `SERIAL_CHECK=fmp` in Coolify (api app) and restart.

## D105 — The cashier leaves SES: U POS is the till; staff send a wrong pick back; a deposit-slip payment; Trade In and Partner Mall are not payments (2026-11-05)

The shops' team, on the cashier screen: "Cashier เอาออกทั้งหมดเลยค่ะ เราจะไปจับกับ UPOS แทน"; on the payment types table (D89): "เพิ่มใบมัดจำใน SES", "Trade IN: ใน SES อยู่ในส่วน On top", "Partner mall ไม่ต้องใส่ใน SES". Owner's answers (2026-11-05): remove all of it and wait for U POS with an ADMIN fallback; cashier accounts do not use SES; staff send a wrong pick back to stock.

1. **No cashier in SES.** The cashier workspace and the steps `receive`, `scan`, `bill` are gone (400). After STOCK sends, the order waits for U POS, which opens the bill and reports the payment (`POST /integrations/pos/bills`, D60/D101). `complete` is ADMIN's fallback from any till state (`SENT_TO_CASHIER`, the old `CASHIER_*`, `BILL_OPENED`): "ปิดการขาย (แทน U POS)" on the history page, recorded at the click. The damaged-item removal at the till (D75) and the cashier's product change are gone; a product is changed by STAFF while the order is with stock.
2. **Cashier accounts.** CASHIER is a retired role: never shown (`publicAccount`), never given (staff form, ERP extras, spreadsheet import: 400 / row error; an old account read back keeps it), and not enough to sign in: password and OTP sign-in refuse a cashier-only account ("บัญชีนี้ไม่ได้ใช้ SES แล้ว (แคชเชียร์ทำงานใน U POS)", after a correct password only), no OTP SMS is sent to one, and a signed-in session of one ends at its next request. The ERP import maps a cashier position to no role (listed as unmapped; existing accounts are kept, never deactivated for it, D54). An account with CASHIER and another role keeps the other.
3. **Wrong pick.** STAFF sends the order back to stock (`POST /sessions/:id/cashier/reject`, path kept) with the wrong items and reasons, from the staff screen while the order waits for the till; same effects as F13 (units back to the shelf, serials cleared, SEARCHING).
4. **Payments.** A migration adds the method "ใบมัดจำ" (FileMaker type "ใช้มัดจำ"), or switches on and types an existing "ใบมัดจำ" / "ใช้มัดจำ"; the FileMaker types list loses "Trade In" (an On top item) and "Partner Mall"; methods typed with them become untyped and methods named after them are switched off (ADMIN can switch them back on).
   *Fix, same day:* on prod "ใช้มัดจำ" already existed (made 2026-10-30), yet the migration also inserted "ใบมัดจำ" at the top of the list (an `INSERT … SELECT MAX()` always yields one row, so its NOT EXISTS guard did nothing). Migration `202611050003_one_deposit_method` keeps one: "ใบมัดจำ" takes the older method's place and "ใช้มัดจำ" is switched off (ADMIN can switch it back on).
5. **Also (owner's OK):** when the customer accepts what stock found (ACCEPT_PARTIAL, D73), `stock_found_at` is the time stock reported the rest missing, not the staff's decision (real times, D101); the rebuy test now expects the old session's letter and type (the type is matched again at confirm, D69).

## D106 — Every shop-floor account from the ERP is STAFF + STOCK (2026-11-05)

Owner: "user ใน ses erp ที่ login ses ต้องเปลี่ยนให้ทุกคนเป็น stock + cashier + staff … ปรับ role ที่มาจาก erp ทุก account". CASHIER has no screen since D105, so the owner chose STAFF + STOCK for everyone, for the shop-floor positions only.

1. **Rule.** The ERP import maps `sale`, `store manager`, `cashier` and `stock` positions to **STAFF + STOCK** (`POSITION_ROLE_RULES`). Other positions (technician, housekeeper, …) still get no account. (Superseded by D114: they get STAFF + STOCK too.) CASHIER is never given; an old CASHIER role on an ERP account is dropped at the next run. ADMIN / MANAGER stay hand-managed (D54).
2. **Now, without waiting for the import.** Migration `202611050002_erp_accounts_staff_stock`: every account with an ERP id gets STAFF and STOCK and loses CASHIER; the extra people picked by hand (D87) are reset to STAFF + STOCK once (ADMIN can change them again). Hand-made accounts are untouched.
3. **Effect.** Cashier-position staff can sign in to SES again (as STAFF + STOCK; the till stays in U POS); everyone on the floor sees both the staff and the stock screens.


## D107 — Pickers made for a phone: models as a list, choices as chips, payments with an FMP type first (2026-11-06)

Owner, with three phone screenshots: "สามารถทำให้ง่ายขึ้นหรือดีขึ้นได้ไหม" (the model dropdown, the Ontop / Points / Burn Point / Payment
tick boxes, the STOCK send button). Agreed plan, all three.

1. **Model, RAM, capacity, colour.** No native dropdowns (tiny on a phone, ~19 iPad models to scroll). `SkuPicker`
   (`features/session/SkuPicker.tsx`, catalog helpers in `catalog.ts`) shows the models of the chosen device line as full-width buttons in
   name order (a series stays together), only the model name (the product name underneath only where the model name does not say it, or two
   models share a name), with a search box above more than 8 models (every word must match; `wi-fi` = `wifi`). A picked model folds into one
   row with "เปลี่ยน". RAM, capacity and colour are chips; a colour chip shows the stock and is struck through when out of stock. A step
   with one choice is still taken for the user (`settleChoice`). The change-item modal uses the same picker (it now asks for the RAM of a Mac
   too, which it skipped before) and chips for the device line.
2. **Add-ons.** No "None / ล้างรายการ" buttons (tapping a ticked box again takes it off). Points and Burn Point share the same cards, so
   they are one table: a row per card, "สะสม" and "ใช้แต้ม (Burn)". Payment is marked optional; the methods with an FMP type other than
   `อื่นๆ` come first under "ช่องทางหลัก", the rest under "ช่องทางอื่น", **all always shown** (ADMIN moves one up by giving it a type,
   D89). The first build folded the others under a "ช่องทางอื่น (N)" toggle; the owner could not find them ("ตัวเลือกอื่นๆหายไปไหน") and
   the installment methods (UFund, Ulite, Kashjoy, S Leasing, PayNext) are used often, so nothing is folded. If no method has a type yet
   (or the list cannot be loaded), all are shown in one group. On a phone the tick boxes are two to a row, 44 px.
3. **STOCK send button.** "ส่งสินค้าไปที่แคชเชียร์ (SENT_TO_CASHIER)" named a SES cashier that no longer exists (D105) and showed a state
   code. It is now "ส่งให้แคชเชียร์ (U POS)"; while serials are missing it reads "สแกน SN อีก N เครื่อง" (still disabled) instead of only
   greying out. Nothing changes in the API or the data.

## D108 — Scan with the phone camera, or with a scanner without tapping the box; "พบแล้ว" next to the box (2026-11-06)

Owner, with two screenshots: "พบแล้ว" was small and far from the box ("ทำไมมันตัวเล็กและอยู่ไกล"), ticking it still asked for the serial
("พอกดแล้วต้องแสกนใหม่อีกหรอ"), and "เราสามารถกดเปิดกล้องเพื่อ scan ได้หรือไม่ … รองรับการ scan โดยไม่ focus input ได้ด้วยไหม".

1. **"พบแล้ว" (D102) is a big toggle button beside the box** (with "กล้อง"), not a small tick box at the far end of the product row. Once
   pressed the row says "พบแล้ว: สแกน SN ตอนยื่นของ (ต้องครบก่อนกดส่ง)": it records when the unit was found, the serial is still needed
   before "send" (FileMaker opens the bill by serial) or "ส่งโดย SN ยังไม่ครบ" (D103). Nothing changes in that rule.
2. **Camera.** "กล้อง" on each product opens the back camera full screen (`CameraScan`). The browser's own barcode reader is used where it
   reads Code 128 (Chrome on Android); elsewhere (Safari on iPhone) `barcode-detector` / `zxing-wasm`, loaded only when the camera opens
   (a 43 kB chunk + a 0.9 MB `.wasm`, served from our own `/assets`, never from a CDN). Only a serial or an IMEI is taken
   (`serialFromBarcode`: 15 digits = IMEI; 12/13/32 digits = UPC/EAN/EID and anything with "/" = part number are skipped; else 8 to 20
   letters and digits), kept exactly as read so it equals what a scanner types. A serial the order already has is passed over. Several
   candidates at once: STOCK taps the right one, the others are set aside. After each serial the camera holds until "สแกนเครื่องถัดไป"
   and sets aside whatever else it reads meanwhile (an iPhone's IMEI2 must never become the next unit); it closes when the product has
   all its serials. A refusal from the server (e.g. the unit is in another open order) shows in the overlay.
3. **Scanner without focus.** While an order's scan panel is on screen, keys typed with nothing editable focused are read as a scan
   when they come as a burst (≥ 6 characters, ≤ 100 ms between keys, ≤ 60 ms on average; Shift does not break it) ending with Enter
   (`createWedgeReader`). The scan goes to the first product with units left; that Enter is swallowed so it never presses a focused
   button (e.g. "ลูกค้ายกเลิก"). Slow typing is left alone; a focused box (the serial box, the note) takes the typing itself.
4. nginx gzips `application/wasm` too. No API or data change.

## D109 — Not-for-sale ERP parts are left out; models are listed new to old, ADMIN pins a launch (2026-11-06)

Owner, with a screenshot of the iPhone model list (D107): "ทำไม Apple Care + มาอยู่ในนี้ แล้วก็ อยากให้เรียงสินค้าใหม่ไปเก่าได้ไหม เช่นตอนนี้
iphone duo ให้ขึ้นก่อน". Chosen: UPC order + ADMIN pin; demo units hidden too.

1. **Why they were there.** The warroom sync files every part the ERP puts under a device category, including AppleCare+ incident
   fees (`ACSH0164` "INCIDENT SERVICE FEE FOR IPHONE DISPLAY", model "AC+ Incident"), service parts (sub-categories Whole Unit, Display,
   Back Glass, Connectivity Cards: `TA661-…`, `661-…`, `PA661-…`) and demo units (APPLE DEMO UNITS, `3P877ZP/A` "(Demo)"). They were in
   the old dropdown too; the D107 list put them on top (name order).
2. **Rule.** `notForSale(product_subcat, product_subsubcat)` in `buildCatalog`: those five sub-categories, or a model containing "AC+
   Incident", are never created (`skippedNotForSale`; catalog rules version 5). Migration `202611060001_model_pin_and_not_for_sale`
   switches off the ERP-made ones already created, the way ADMIN does (product or model, SKUs, branch rows); reversible. A rule by part
   number was rejected: sellable CTO Macs (`Z1L000024`) do not look like `xxxxxZP/A` either.
3. **Order.** Pinned models first (`ProductModel.pinnedAt`, set by "ปักหมุด" in จัดการสินค้า → แก้ไขสินค้า; the last pinned on top), then
   the newest numeric UPC among the model's SKUs (Apple numbers UPCs in launch order; on prod this gives iPhone 18 Pro, 18 Pro Max, Duo,
   17e, 17 …, iPad Air M4, Pro M5, A16, Air M3, mini, Pro M4), then the name; no UPC (a CTO-only model) goes last. The date a model
   first appeared in SES was tried and rejected: an old model first stocked late jumped to the top. Apple assigns UPCs before a launch,
   so the exact launch order ("Duo first") is ADMIN's pin. Same order in the change-item modal.

## D110 — Queue numbers run sequentially as three digits without A/B prefix; customer type kept for reporting & export (2026-11-09)

Owner instruction via `/grill-me`: "แก้ไขการแสดงคิวให้เป็นการรันคิวเลย ไม่ต้องมี A B เก็บข้อมูลเป็นประเภทลูกค้าเลย", "เก็บไว้ให้สามารถ export data ออกมาแล้วมีข้อมูล ประเภทลูกค้า". Amends D57, D70, and D83.

1. **Queue Number Formatting (`formatQueue`):**
   - The queue display is formatted as a 3-digit zero-padded running number (`001`, `002`, `003`...; 4 digits after 999) without any letter prefix (`A`, `B`, etc.).
   - The shared running counter per branch and Bangkok day (`DailyCounter` scope `queue:<branchId>`, D83) continues unchanged.
   - Applies across all operational screens (Staff Workspace, Stock, Cashier, Receipt, logs, order views) and applies to both new and historical sessions.
2. **Customer Type Data & Classification:**
   - Sessions continue to store `customerTypeId` and auto-classify (e.g. Type A "ลูกค้าทั่วไป", Type B "ลูกค้าใช้เวลานาน") based on payment methods, Ontop, and burn points criteria (D69, D70).
   - `CustomerType` retains its letter (`A`, `B`) and name in the database and back-office admin.
   - **Operational screens (Staff, Stock, Cashier):** Do not display customer type tags; only the queue number and customer phone number are shown.
   - **CSV / Excel Export & Session Logs:** The "ประเภทลูกค้า" column outputs the full format `{letter} - {name}` (e.g. `A - ลูกค้าทั่วไป`, `B - ลูกค้าใช้เวลานาน`) for reporting.
3. **Queue Lookup & Search:**
   - Session lookup / POS filter accepts both padded (e.g. `001`) and unpadded digits (e.g. `1`), matching against `order.queue`.


## D111 — Scan every unit, then send: no "found" stage, no send without serials; FileMaker is the one serial check (2026-11-09)

Owner, WorkTrack SES-7 "ระบบส่ง SN บังคับกรอก + ส่งเช็ค FMP": "แก้หน้า stock เวลาส่งให้ส่ง SN ไปเลยแล้วเช็ค FMP ขาเดียว"; asked to choose, he took
"SN required + FileMaker checks once" over a live FileMaker check per scan (blocked on FileMaker's missing index, D104) and over keeping D103's button.
Amends D101 (FOUND by itself), D102 (the "found" tick), D103 and D104.

1. **SN required.** "ส่งโดย SN ยังไม่ครบ" (D103) is gone from the stock screen. `send` needs every main-product unit scanned (400
   "สแกน Serial Number แล้ว n จาก q เครื่อง" as D101). `{action:'send', serialsLater:true}` is refused with a Thai 400 asking to scan all
   and refresh (the field stays in the DTO only for a screen left open from before). Ticking "พบแล้ว" without scanning (D102) is unchanged:
   the serials are still due before "send".
2. **One check, at FileMaker.** The per-scan serial check no longer reads warroom (hours behind, so its yellow marks misled). `SERIAL_CHECK`
   is off by default; `fmp` (live FileMaker, D104) stays possible once the FMP team indexes `ProductStore_detail::product_sn`; any other value
   is off. FileMaker's `ses` script checks every serial when STOCK sends and its answer shows on the order (D100).
3. **Unchanged.** SES's own guards stay: a serial repeated in the order (400) or in another open order (409). The `ses` v3.1 script still leaves
   out a unit FileMaker does not have in the branch yet (`SN_NOT_FOUND`, `SN_WRONG_BRANCH`, `SN_NOT_READY_FOR_SALE`, e.g. a transfer not
   received): `CREATED_SN_LATER`, the cashier scans it in. `items[].snMissing` stays in the message and is 0 on new orders.
4. **No "found" stage (owner, same day: "เราจะไม่มีการ พบแล้ว จะเป็นการส่งไปแล้วรัน script ของ fmp แล้วก็บังคับกรอก").** The stock flow is
   "รับงาน" → scan every main-product unit → "ส่งให้แคชเชียร์ (U POS)". The "พบแล้ว" tick (D102), the automatic FOUND on the last scan and the
   "พบสินค้าครบ → บันทึก FOUND" button (D101) are gone, and the "พบแล้ว" queue tab with them. `send` now also runs from SEARCHING and does in
   one transaction what `found` did: the shelf deduction (D61) and `stockFoundAt` = the time the last unit was scanned (D101's real time, kept
   between `stockStartedAt` and now; a STOCK_FOUND event at that time), then SENT_TO_CASHIER and the FileMaker message (its `ses` script checks
   the serials and opens the held bill). An order at FOUND (the customer accepted what stock had, D73, or one from before) is listed under
   "กำลังหา" as "รอส่ง" and is sent the same way; the `found` step stays in the API for a screen open from before.
5. **Accessories skip the serial (owner: "อุปกรณ์เสริม บางครั้งอยู่หน้าร้าน in store stock อาจจะยิงไม่ได้ … Part นี้ข้าม SN").** They are listed
   for STOCK to pick and never hold up "send". STOCK ticks one "ขาด/หมด" only to report it ("แจ้งสินค้าไม่ครบ/หมด"); a main product not fully
   scanned counts as missing in that report, as before.

## D112 — AirPods, Apple TV, HomePod and AirTag are main products, a category each (2026-11-09)

Owner (WorkTrack SES-9, from SES-7's list): "แก้หน้าเลือกสินค้าหลักที่หายไปเช่น Apple TV, AirPod, อื่นๆ"; asked to choose, he took four categories
(AirPods, Apple TV, HomePod, AirTag) over two ("AirPods" + "Apple TV & Home") or a catch-all "อื่นๆ". The warroom sync had filed them under
Accessories (D72's accessory words include airpods / apple tv / homepod / airtag), and the main-product tiles leave accessory-like
categories out, so staff could only name them as a free accessory (no SKU, no serial, not on the FileMaker bill, D97).

1. **Categories.** A migration adds AirPods, Apple TV, HomePod, AirTag: switched on, not accessory-like, right after Watch (the later ones
   move down four places). Like iPhone they are SES's own (`erpManaged` false).
2. **Which parts.** `deviceLineOf` (warroom sync) takes an "Apple Accy" part out of Accessories when: AirPods = its sub-category starts
   with "AirPods" ("Airpods 4", "Airpods 5", "Airpods Max", "Airpods Max 2", "Airpods Pro 3"); Apple TV = its model group is "Apple TV";
   HomePod = its name starts with "HomePod" (the ERP files it under "Headphones and Speakers" → "Speakers"); AirTag = its model group is
   "AirTag". What stays an accessory: the "Earbud" spare buds and ear tips, "TV Remote", EarPods, AppleCare+ for AirPods, "AirTag Case"
   key rings and loops, and every other brand's part (read from prod on 2026-11-09).
3. **Names.** AirPods: product = the group, model = the model group, with "Airpods"/"airpods" spelt "AirPods". Apple TV: product and model
   "Apple TV" (capacity stays a choice). HomePod: product "HomePod", model "HomePod" / "HomePod mini" (colour stays a choice). AirTag:
   product and model "AirTag" (the packs are told apart by the SKU name). Two SKUs of one model with the same colour show their part
   number (already so, D107).
4. **Moving what exists.** Catalog rules version 6: on its next scheduled check after the deploy, the sync re-files the SKUs it made earlier
   (with their branch stock) into the new categories and drops the emptied ERP products/models (D78). ADMIN pins on the old AirPods models
   do not follow (D109).
5. **What it changes for the shop.** These are now picked like an iPhone (model, then capacity/colour), STOCK scans their serial (D111) and
   FileMaker gets them as bill lines. Not verified: whether FileMaker keeps a serial for every AirTag pack (if not, its `ses` script
   leaves the unit out of the held bill and the cashier scans it in, D103/D111).
6. **Icons.** One `CategoryIcon` for every screen (was three copies): AirPods headphones, Apple TV a TV, HomePod a speaker, AirTag a pin;
   Accessories now a cable. No product pictures for the four yet.

## D113 — Login codes go to the staff member's LINE (UFiconStaff OA) first, SMS second (2026-11-09; SMS removed by D117)

Owner (WorkTrack SES-8, SES-7's list): "แก้ขอ OTP ผ่าน LineOA Staff", the OA "UFicon Staff" the FMP team uses. On 2026-11-09 every SMS
code failed (`ERROR_SENDER_NOT_FOUND`, D85), so the 72 ERP accounts could not sign in. Checked that day: the OA is **UFiconStaff
(@926vbvae)**, Messaging API quota 35,000 messages a month (3,134 used in November); a test push to the owner arrived. The same OA already
runs the staff's clock-in menu (UFHR) and sends UFPOS's own login code.

1. **Order.** A code goes to the person's LINE on that OA; when LINE is not set up, has no userId for them, or refuses (quota, blocked),
   it goes by SMS to the phone on the account as before (D85). Push only: SES never takes the OA's webhook (UFHR owns it; repointing it
   would break clock-in). OTP login is on when either LINE (`LINE_CHANNEL_ACCESS_TOKEN`) or ThaiBulkSMS is set up.
2. **Who is who on LINE.** UFHR keeps it (`staff::line_uid`; a person links their LINE from the OA's clock-in menu with staff id + ID card).
   FileMaker gets a copy in `staff.line_user_id` from UFHR's `staff_send_to_ufservice` script, but the copy is incomplete: 45 rows on
   2026-11-09 (11 of SES's 72 accounts; the owner, who links through UFHR, had none). So:
   - with `UFHR_API_BASE` + `UFHR_API_KEY`, UFHR's `GET /staff-contacts?ids=<ERP staff id>` (active staff only, ~3 s) decides, the
     way UFPOS does it, and **its answer is final**: when HR answers and has no LINE for the person (never linked, unlinked, or no
     longer active) the code goes by SMS, not to an older copy (an unlinked LINE account must stop receiving codes);
   - only when UFHR is not set up, or does not answer (error, 10 s without a complete answer), is the ERP import's copy used: the import
     reads `line_user_id` into `Staff.lineUserId` (only a real userId, `U` + 32 lower-case hex; a new valid value replaces it, an empty
     ERP field clears it). All 45 copies answered LINE's profile check.
   UFHR only lets in callers it holds a key for (`ufservice`, `tradein`), so SES needs its own key added there (UFHR's team).
3. **Who can ask.** Reachable = an SMS phone (SMS on), or a stored LINE userId, or (UFHR on) an ERP staff id. The answer is still always
   `{ ok: true }`; limits, 5 minutes, 5 tries, the daily cap and the 12-hour session are D85's and count LINE codes too.
4. **Recorded.** `LoginOtp.channel` = `line` / `sms`; `smsStatus` / `smsError` hold the result of either. A LINE miss followed by a
   working SMS stays as a note on the row ("LINE: UFHR ไม่มี LINE ของคนนี้ …"), so ADMIN sees who still has to link. The ERP import warns
   only when a person has neither a mobile number nor a LINE userId.
5. **ADMIN.** The OTP page shows the LINE set-up (token, UFHR, how many ERP accounts have a LINE userId from the ERP), a "ส่ง LINE ทดสอบ"
   to a Staff ID (says whether the userId came from UFHR or the ERP), and the channel of every code.
6. **Login page.** The tab and button say "OTP ทาง LINE / SMS"; the hint after sending points to LINE UFiconStaff and, for anyone who never
   linked, to the clock-in menu.
7. **Open.** UFHR to add a `ses` caller key for `/staff-contacts` (ideally answering only `staffId` + `lineUid` for it). Until then only
   the 11 with an ERP copy get LINE; the rest still depend on SMS. The OA's long-lived token was pasted in chat on 2026-11-09: reissuing it
   also cuts off UFHR/UFPOS, so it is a joint decision.
8. **Review (2026-11-10, Codex, then checked against the code).** Fixed: UFHR's "no LINE" is final (above); the 10-second limit on LINE and UFHR
   calls now covers reading the answer body too (a server that sent headers and stalled used to hold the code back for good; `LINE_TIMEOUT_MS`
   exists for tests); the ERP "cannot get a code" warning counts a contact only when its channel is on (SMS only: a LINE userId alone is
   warned; LINE only: a phone alone is warned); the login toast no longer promises SMS when only LINE is set up. Known and kept:
   (a) setting only the LINE token turns OTP mode on for everybody, as setting the SMS key always did (D85): before running LINE alone
   (no SMS, no UFHR) check the ADMIN page's "บัญชี ERP ที่มี LINE" count, because ERP accounts without a LINE userId then have no way in
   but an ADMIN's Reset; production has SMS set, so adding LINE removes nobody's route; (b) the response time of `auth/otp/request` differs a
   little between an account that can get a code and one that cannot (D85 already did this for phones; LINE adds enrolment to it); the answer
   body is identical and the staff ids are not secret, a fully uniform boundary is left for later.

## D114 — Everyone in an imported branch gets an account (STAFF + STOCK), and each branch's registration page comes from the ERP (2026-11-10)

Owner (WorkTrack SES-7 follow-up, 2026-11-10): the ERP users in SES are incomplete ("user ใน erp ยังขาดหลายท่าน", the test team's k.mild was missing), so "ดึงทั้งหมดมาเลย … ยศค่อยแก้ทีหลัง แต่หลักๆ เป็น staff + stock"; and the per-branch QR address should come from the ERP if it has it.

1. **Positions no longer filter people (reverses D106 item 1's "other positions get no account").** A person in an imported branch whose `position`
   matches none of the rules (technician, housekeeper, trainer, no position at all) is now imported as **STAFF + STOCK** (`DEFAULT_ERP_ROLES`),
   like the shop-floor positions. On 2026-11-10 that was 14 of the 15 people the import had skipped. ADMIN narrows anybody afterwards (an ADMIN's
   change to roles on an ERP account still follows the existing D54 rules). ADMIN / MANAGER / CASHIER are still never given by the import.
2. **Registration page per branch from the ERP.** The ERP `branch` table keeps it in `Branch_regist` (`http://www.uficon.com/register/index.php?branch_id=<id>`,
   which answers 301 → https; `Branch_URL` is FileMaker's own WebDirect `scan_qr` page, not used). The import reads it and **fills an empty
   `Branch.registrationUrl`; an address an ADMIN typed (F10) is never overwritten.** Only a clean http(s) address that fits the column is taken, as written.
   A branch whose ERP field is empty keeps what it has.
3. **Not changed here.** The branch-group scope (`iStudio`, `U-Store`) is as before, so people of the other groups (HO, Huawei Store, iMedic, no
   group: 134 of the 220 active ERP people on 2026-11-10) still get no account until the owner says which SES branch they belong to.
4. **Effect (computed from the real ERP, 2026-11-10 01:32, nothing written):** accounts from the import 72 → **85**, all STAFF + STOCK; 4 of them
   have neither a mobile number nor a LINE userId (warned); 1 skipped (a branch closed in the ERP). It lands with the next scheduled import
   (10:00) or "ซิงก์ตอนนี้".

## D115 — The head-office group joins the import, on the SES HO branch (2026-11-10)

Owner (2026-11-10), after D114: pull more of the ERP people into SES, "เอาเฉพาะ iStudio, U-Store, HO" (not Huawei Store). On 2026-11-10 the ERP had
220 active people: iStudio 72, U-Store 18, HO 77, Huawei Store 14, iMedic 14, no group 25.

1. **Scope.** The import now covers three ERP `branch_group`s: iStudio and U-Store (their branches are SES branches, D53) and **HO**. Huawei Store,
   iMedic and people with no group stay out, as before.
2. **Where HO people go.** SES keeps one hand-made branch with code `HO` (สำนักงานใหญ่). Every active ERP person whose `staff.branch_group` is `HO`
   (their ERP branch is not an imported one) gets an account on that branch, STAFF + STOCK like everybody (D106/D114), no matter the position.
   Nothing else about them is special: OTP sign-in (D85/D113), name, phone and LINE from the ERP, deactivated when the ERP says they left.
   No new SES branches are made. They see HO's own (empty) queue, never a shop's.
3. **Safety.** There must be exactly one active SES branch coded `HO`; with none or several the run adds a branch note ("ไม่พบสาขา HO …") and the
   HO people are neither created nor deactivated (accounts that already exist are kept as they are). A hand-made account whose id is also an ERP id
   (for example 576, the k.mild ADMIN account) is left alone with the existing "สร้างเองใน SES จึงไม่แตะ" note: its roles and branch do not change.
4. **Picked-by-hand people (D87)** are unchanged; a picked HO person who is taken off the list now stays as an ordinary HO person instead of being
   deactivated.
5. **Effect (computed from the real ERP, 2026-11-10 01:41, nothing written):** accounts from the import 85 (after D114) → **162** (85 shop + 77 HO);
   57 active people stay out (Huawei Store 14, iMedic 14, no group 25, others 4); 12 of the 162 have neither a mobile number nor a LINE userId
   (warned); 26 have a LINE userId. Takes effect at the next scheduled import (10:00) or "ซิงก์ตอนนี้".

## D116 — "ออเดอร์ที่ต้องดู": orders stuck at the cashier or failing towards FileMaker, in the ADMIN FileMaker page (SES-10, 2026-11-10)

Owner (WorkTrack SES-10, "เชื่อมเวลาทำงานจาก FMP … + แจ้งเตือนออเดอร์ค้าง"): on 2026-11-09 no order had ever got a bill number back from FileMaker, so every order sat at "sent to cashier" with nothing telling anyone. The FileMaker side (`ses_report_bill` v2) is FMP's work; this is the SES side. Asked how to be told, the owner chose the ADMIN page only (no message to anybody).

1. **Where.** Admin → ส่งไป FileMaker: a new panel "ออเดอร์ที่ต้องดู (n)" above the existing one; `GET /api/admin/fmp/attention` (ADMIN only). It reloads itself every minute.
2. **Waiting for a bill.** Orders sent to the cashier (`SENT_TO_CASHIER` and the retired cashier states) with **no bill after 30 minutes** (counted from the real
   STOCK_SENT_TO_CASHIER event), and orders with a bill open but **not paid after 4 hours** (counted from the bill's real open time). Each row shows branch, queue,
   how long, and the FileMaker side of the order (not sent / failed / FMP error / received). Longest wait first.
3. **Trouble towards FileMaker.** For each order the LATEST message to FileMaker decides: `failed` (gave up after the attempts), `stuck` (still pending or sending
   after 10 minutes), `ack-error` (sent, but the `ses` script answered with an error, e.g. SN_WRONG_BRANCH: the held bill was not opened). A later good message for
   the same order clears it. The row has "ส่งซ้ำ" (the existing retry) or, for an error answer, "ส่งออเดอร์ซ้ำ" (the existing resend).
4. **Limits.** Last 14 days, at most 100 rows of each kind. The three limits are query parameters (`openMinutes` 30, `payMinutes` 240, `stuckMinutes` 10, kept
   within 5 min–24 h, 30 min–7 days, 2 min–24 h) so they can be tuned without a release; the panel shows the ones in force.
5. **What it does not do.** No LINE or e-mail. If FileMaker never reports a bill the ADMIN can still close an order by hand (D105, "ปิดการขาย (แทน U POS)").
   When LINE is on (D113) a push to ADMIN is a small step if the owner wants it, with the question of how often.

## D117 — SMS removed: login codes go by LINE only (2026-11-10)

Owner, 2026-11-10 09:26, after staff 1138 asked for a code and got nothing: "ทำไมทั้ง sms และ line ไม่ได้รับ … เอาระบบ sms ออกไปด้วย เพราะถ้าใช้ line ได้ก็จะได้ไม่ต้องเสียตัง".
What the logs showed (`LoginOtp`, 09:23): LINE had **no userId for 1138** (the ERP `line_user_id` is empty and UFHR is not connected), and SMS was
refused by ThaiBulkSMS with `400 ERROR_SENDER` (the default sender is not accepted since `THAIBULKSMS_SENDER` was removed on 11-09). The LINE token itself was fine.
At that moment 26 of 168 active accounts had a LINE userId and 149 had a phone; the owner chose to remove SMS anyway (asked, with these numbers).

1. **What was removed.** `src/sms/*` (ThaiBulkSMS sender, delivery webhook `/api/webhooks/thaibulksms/:token`), the "ส่ง SMS ทดสอบ" endpoint and button, the
   SMS panel of Admin → เข้าสู่ระบบด้วย OTP, the SMS fallback in `OtpService.deliver`, and `channels` in `GET /auth/config` (now `{ otp }`).
   `THAIBULKSMS_*` env vars are no longer read (delete them in Coolify; the key and secret stay valid at ThaiBulkSMS if it is ever wanted back: it is in git history).
2. **OTP mode** is on exactly when `LINE_CHANNEL_ACCESS_TOKEN` is set. A person can get a code only with a LINE userId (the ERP copy, or UFHR when connected, D113).
   `request` still answers `{ ok: true }` for everybody (D85), so a person with no LINE sees "sent" and nothing arrives: the login page tells them what to do.
3. **Who is locked out is visible.** The staff list shows a "ไม่มี LINE" tag per ERP account (`hasLine` on the account), the OTP panel says how many ERP accounts have no
   LINE userId, and the ERP import warns for every person without one (the warning text says the phone does not help).
4. **Kept on purpose.** `Staff.phone` and the ERP `tel` import (a contact number, shown masked, in the staff sheet) and the `LoginOtp` columns `smsStatus`, `smsError`,
   `smsMessageId`, `smsReport`, `phoneLast4` (names are from the SMS days: `smsStatus` is the delivery status, `smsError` the note; no migration). Old rows keep
   `channel = 'sms'` and show as "SMS (เดิม)". The system-wide daily cap env is renamed `OTP_SMS_DAILY_LIMIT` -> `OTP_GLOBAL_DAILY_LIMIT` (it was never set in production).
5. **Consequence the owner accepted.** Until the ERP `line_user_id` (FMP team) or UFHR (`UFHR_API_BASE` + `UFHR_API_KEY`) gives a userId, that person cannot sign in by OTP.
   They were already locked out by the SMS error; ADMIN can still give a hand-made account or press Reset (password) for someone urgent.
   Supersedes D85's SMS parts and D113 item 1's SMS fallback (the rest of D85: 12-hour session, limits, hash-only codes, stands).

## D118 — LINE userIds come from UFHR's FileMaker layout `api_staff` (2026-11-10)

After D117 only 26 of 159 ERP accounts had a LINE userId (the ERP's `line_user_id` is a copy UFHR's `staff_send_to_ufservice` keeps
incomplete; the owner, staff 1138, had none). The FileMaker team (KoB) made a read-only account for SES in UFHR's own file: database
`UFHR`, layout `api_staff`, user `staff_api`, fields `staff_id`, `line_uid`, `status`, `name_full_th`, `name_full_en` (715 rows; 200 with a
LINE). Read on 2026-11-10: UFHR has a LINE for **122 of SES's 159** ERP accounts (all 26 ERP copies equal UFHR's), 1138 included.
(The SES ERP OData account cannot open UFHR: 401, as it should.)

1. **Env.** `UFHR_FM_HOST` (`https://pos.uficon.net`), `UFHR_FM_USER`, `UFHR_FM_PASSWORD` (Sensitive); `UFHR_FM_DATABASE` / `UFHR_FM_LAYOUT`
   default to `UFHR` / `api_staff`. Set = UFHR counts as "set up" (D113) and is asked through FileMaker's Data API, preferred over the
   HTTP API (`UFHR_API_BASE`) when both exist.
2. **At each OTP request** SES logs in, finds the person by ERP staff id, logs out (about 1 s); the answer is final as in D113: a person
   counts as linked only with `status` Active and a real userId in `line_uid`. Not there, not Active, or no LINE = no code. FileMaker down
   (or no answer in 10 s) = the stored copy.
3. **At each ERP sync** SES reads the whole layout once (one login, one read, one logout) and stores UFHR's LINE on every imported
   person (`Staff.lineUserId`), replacing the ERP copy, so the staff list ("ไม่มี LINE"), the OTP panel counts and the import warnings
   show the real state. UFHR unreadable, or answering with nobody at all: the ERP copy stays and a branch note `UFHR` says why.
4. **Always log out**: FileMaker counts sessions. The password is never logged. The account can read only those five fields.
5. The password was first pasted into a chat (2026-11-10); it was entered into SES through a secret form, and the FileMaker team was
   asked to change it (then update the Coolify env).

## D119 — The serial check comes back from FileMaker (`snCheck`), and a held bill counts as opened (2026-11-10)

The FileMaker team asked how to report which serials they found, and said a bill number exists only at payment.

1. **`snCheck`.** The `ses` script v3.3 (and `ses_fail` v3 on a failure) adds `snCheck` to its answer: per serial `{sn, partNo, found,
   written, code, model, upc, status, branch, name, price}`, from the row it already reads (no extra query). SES keeps it, cleaned
   (`parseSnCheck`: serial required, texts cut, a skipped serial always has a code, at most 100), in `FmpOutbox.snCheck` (JSON). Admin →
   ส่งไป FileMaker shows a tag per serial (✓ on the bill / ✗ with the reason, branch or model); `price` is stored but not shown (D58).
2. **"SN ไม่ได้ลงบิล".** When the latest message got a success answer but some serials were not put on the held bill, "ออเดอร์ที่ต้องดู"
   lists it (kind `sn-skipped`, the serials and reasons; no resend button: the cashier scans those units in FileMaker).
3. **Held bill = opened.** FileMaker opens the held bill when its script answers CREATED and sends a bill number only at payment
   (`ses_report_bill` v3: one call at payment, `paid: 1`, `openedAt` = when the held bill was opened). So an order whose latest message
   got a success answer waits "for payment" (stage `held-bill`, the 4-hour limit, counted from that answer), not "for a bill" (30 min).
4. Not yet: sending only the wrong serials back to STOCK automatically, and a check at scan time (needs a FileMaker layout + index on
   `product_sn`).

## D120 — International phone support, 9-digit Thai company numbers, leading 0 strip, and E.164 storage (2026-11-10)

Customer phone numbers at walk-in and confirmation previously required exactly 10 ASCII digits (`/^[0-9]{10}$/`). To serve international customers and business accounts:

1. **Format & Input (UI).** Walk-in and order confirmation provide a country selector (default: Thailand `+66`) with search (by country name or dial code) and popular countries prioritized at the top.
   - For Thai numbers (`+66`): entering a leading `0` automatically strips the `0`.
   - Supports Thai mobile (9 digits after removing `0`) and Thai company / landline (8 digits after removing `0`, e.g. `02-xxx-xxxx` -> `2xxxxxxx`).
   - For foreign numbers: full international validation using `libphonenumber-js`.
2. **Storage.** Customer phone numbers are normalized and stored in the database in international E.164 format (e.g. `+66812345678`, `+6621234567`, `+819012345678`). `Customer.phone` and `CustomerSession.phone` columns are expanded from `VARCHAR(10)` to `VARCHAR(32)`.
   - Prisma migration `202611100002_international_phone_e164` migrates existing 10-digit/9-digit numbers in the database to E.164.
3. **Display.** Friendly formatting throughout the UI (queue lists, staff workspace, logs): Thai numbers display in standard local format (`081-234-5678` or `02-123-4567`); foreign numbers display with country code (`+81 90 1234 5678`).
4. **Outbound Compatibility (POS & FileMaker).** In `orderView` / outbound payloads (`customerPhone`), Thai numbers starting with `+66` are converted back to standard local format with a leading `0` (`0812345678` or `021234567`) so legacy POS and FileMaker `cust_tel` queries continue matching customer records without modification. Foreign numbers are sent as E.164 strings.

## D121 — A held bill cancelled in FileMaker is reported through the callback; an SES cancel is cleared by hand (2026-11-10)

The FileMaker team asked what to send when a bill from SES is cancelled on their side.

1. **Cancelled in FileMaker.** FileMaker already frees the serials for a new scan, so the same order (same reference, same serials) can
   be sent again. Their new script `ses_report_cancel` v1 (`docs/agents/fmp-scripts/`) clears `ses::ses_status` and `ses::sale_id`
   (otherwise the `ses` script answers `ALREADY_DONE` and opens nothing) and calls the callback door (D90) with the reference,
   `status: "error"` and a message starting `CANCELLED` (reason; "ชำระแล้ว" and the bill number for a paid bill). A held bill has no bill number
   yet (it comes at payment), so the order is named by its reference only; the script sends the held bill's internal key (`ses::sale_id`)
   as `holdKey` for the log. No SES change: an error answer
   already puts the order in "ออเดอร์ที่ต้องดู" (`ack-error`, with the resend button) and stops counting it as a held bill. Key: the
   `FMP_CALLBACK_KEY` FileMaker already used for its test callbacks on 2026-10-31.
2. **Cancelled after payment** (paid = 1): the record is not cleared and the order in SES stays sold; the warning tells staff to sort it
   out by hand. Undoing a sale in SES is not built.
3. **Cancelled in SES** after the order went to the cashier: SES sends nothing to FileMaker (it pushes only `SENT_TO_CASHIER`). For now the
   cashier cancels the held bill in FileMaker by hand; a push of the cancel (and a FileMaker script to clear it) waits until it is
   needed.

## D122 — Customer tax document requests: VAT refund and full tax invoice (2026-11-10)

Cashiers previously had to ask every customer at the till whether they needed a VAT refund or a full tax invoice. To streamline the cashier handoff and bill opening:

1. **Input (UI).** In product selection (`SelectionEditor`), immediately following the payment methods, an optional section "เอกสารภาษี / Tax Documents" allows staff to toggle two independent flags:
   - **ต้องการใบกำกับภาษี (Tax Invoice):** for Thai residents / registered companies requiring a full tax invoice.
   - **ต้องการ VAT Refund:** for foreign tourists requesting the PP10 VAT refund form.
   Both default to `false` (neither required).
2. **Persistence.** `vatRefund` and `taxInvoice` boolean columns on `CustomerSession` (migration `202611100003_vat_refund_tax_invoice`). A re-bought session copies both flags from the previous session.
3. **Outbound (`orderView`).** `orderView` includes `vatRefund: boolean` and `taxInvoice: boolean`. Both the U POS door and the FileMaker outbound message carry these flags so the cashier / POS can prepare the document before or at billing.
4. **Visibility.** Prominently displayed on the order summary (`Summary.tsx`) with badges (`ใบกำกับภาษี`, `VAT Refund`) and in the staff queue cards and logs.
