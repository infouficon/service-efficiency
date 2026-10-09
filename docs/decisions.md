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
Stock requested stock_requested_at
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
KTS
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



