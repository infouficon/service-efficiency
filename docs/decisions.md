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
5. **Pictures.** The category tiles show Icons8 pictures (iPhone, iPad, Mac, Watch, Battery, Accessories) bundled in `apps/web/src/assets/category-icons/` (downloaded once from the URLs the owner gave, no runtime hotlinking). Icons8's free licence needs a link back, so the picker shows "ไอคอนสินค้าโดย Icons8"; remove it only with a paid licence. Categories without a picture (other brands) get a plain line icon. The Accessories picture is a stand-in (fluency "airpods-pro"): the owner's wireless-charger link was cut off in the message; replace `accessories.png` with it.
6. **Not changed:** non-product rows warroom files under Mac (for example "Connectivity Cards - MacBook Air (13-inch, 2017)", "Other - AC+ Incident") are still created as models; see H-33.

## D80 — Mac storage and colour are read from the names, not from warroom's capacity/colour columns (2026-10-15)

Owner, after D79 went live: a Mac showed "ความจุ: 24GB", the model "MacBook Pro M5 14.2 1TB" and the colour "1TB SSD - Space Black". Warroom's `capacity` column is the first GB/TB figure of a name, which on a Mac is the RAM ("Ram 24 1TB" -> "24GB"), and its `color` column can carry the storage in front ("1TB SSD - Space Black"). Amends D79.

1. **Storage.** When a memory was read from the names (D79), the storage is the first GB/TB figure in the names that is not that memory ("Ram 24 1TB" -> `1TB`); with no storage in the names it is empty (never the RAM). Without a memory the `capacity` column is used as before (phones, iPads).
2. **Colour.** A leading capacity / RAM / SSD part and its dash are removed ("1TB SSD - Space Black" -> "Space Black"; "16GB/512GB - Silver" -> "Silver"); a value that would become empty is kept.
3. **Model name** is cleaned with the corrected storage, so "1TB" no longer stays in "MacBook Pro M5 14.2 1TB".
4. **Existing rows** are corrected by the next sync run (SKU attributes are refreshed, and the SKUs are re-filed, D78). The picker's selected-product card now shows the category picture.

