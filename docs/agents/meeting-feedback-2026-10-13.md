# Meeting feedback 2026-10-13: requirements, current behaviour, impact, proposed decisions

Source: the owner (M2Dev) relayed the meeting's feedback on 2026-10-13. The raw list is kept verbatim in §1 so no wording is lost.
Everything else here was derived by reading the code (`main` @ `ecd82e0`) and, for U POS, the `infouficon/UFPOS` repo (read only).
Decisions are recorded as `D56+` in [../decisions.md](../decisions.md); this file is the working brief for `/grill-with-docs`.

## 0. Status board (updated as each step ships)

| Item | Status | Where |
| --- | --- | --- |
| F1 phone first | **built** (PR `feat/queue-types-phone-first`) | D56, `WalkInForm`, `CreateSessionDto` |
| F7 queue numbers, F8 "คิว" wording | **built** (same PR) | D57, ADR 0001, `queue/` module |
| F15 customer types (back office, A-Z) | **built** (same PR) | D57, Admin → "ประเภทลูกค้า / คิว" |
| F5 unlimited stock (global ADMIN switch) | **built** (PR `feat/quick-wins-stock-unlimited`) | D59, `settings/`, Admin → ซิงก์ ERP |
| F4 + / − quantities (accessories) | **built** (same PR; the main-product quantity comes with F3) | `stepAccessory`, `SelectionEditor` |
| F14 export with the time of each step | **built** (same PR) | `stepDurations`, export category 6 |
| F16 "stock data as of …" | **built** (same PR) | line above the product grid |
| F9 print receipt without prices | decided (D58), not built | |
| F17 U POS two-way | decided (D60), not built, no issue opened in UFPOS yet | |
| F2 step-by-step picker like trade-in | **built** (PR `feat/session-items-wizard`; the trade-in app itself could not be viewed) | D62, `SelectionEditor` |
| F3 several main products + `+ / −` on their quantity | **built** (same PR) | D61, `SessionItem`, migration `202610130003` |
| F6, F10, F11, F12, F13 | not built | see §2 and §4 |

## 1. The feedback, verbatim

> การรันคิวอยากให้มีการแยกประเภทอะไรไหม
>
> - เริ่มการทำงานที่ กรอก เบอร์โทร
> - กดเลือกหมวดหมู่ ทำแบบเทรนอิน เพื่อให้ดูง่าย
> - Main product เพิ่มได้หลายอัน
> - ตัวเลข จำนวนที่เพิ่ม ให้มี + - เพื่อให้ง่ายต่อการใช้
> - ใส่ Stock unlimited ไว้ก่อน เพื่อใช้งานให้สามารถกด product ได้
> - เพิ่มช่องทางชำระเงินอีก 3 ช่องทาง
> - เปลี่ยนการ รัน คิว แบบดูง่าย เพื่อให้เรียกลูกค้าง่าย
> - ให้ทุกที่ที่เป็น SES-XXXXX เปลี่ยนเป็น คิว ให้หมด
> - ปุ่ม พิมพ์ใบเสร็จ เพื่อปริ้นใบเสร็จ ตาม format แบบใบเสร็จทั่วไป
> - QR แนบท้ายใบเสร็จ เพื่อกรอกข้อมูลลงทะเบียน ไว้ (QR แยกแต่ละสาขา)
> - เหตุผลในการเปลี่ยน เปลี่ยนรุ่น สี ความจุ พนง เลือกสินค้าผิดพลาด (มีปุ่ม ให้กดซื้อใหม่โดยดึง data อันเก่า ใช้คิวเก่าในการทำงาน)
> - ยกเลิกได้ทุก role เมื่อยกเลิกแล้ว แจ้ง stock แบบเห็นชัดๆ
> - Cashier สามารถ reject order กลับมา stock ได้ กรณีหยิบสินค้ามาผิด
> - export data ให้มีเวลาที่ใช้ในแต่ละขั้นตอนออกมาให้ด้วย
> - แยกประเภทลูกค้าเป็น A B โดยแบ่ง B พวกใช้เวลานาน
> - Data update ทุก 3 ชั่วโมง อยู่แล้ว โดยดึงจาก FMP
> - แก้เปิดบิลบน U POS เพื่อให้ Cashier ไม่ทำงานซ้ำซ้อน วัด KPI ไม่ได้

## 2. Item by item

Legend: **Now** = what the code does today · **Change** · **Touches** · **Decision / default** (the default is what I would build if the owner says
"as proposed"; `?` = needs an answer that cannot be defaulted).

### F1 Start the work at the phone number · **built (D56)**
> The *Now* line below describes the code before this change.
- **Now:** walk-in creates the session with no customer; the phone is asked only after BUY, at product selection (requirements §6, ERD "phone collection timing";
  `updateSelection` upserts `Customer`, `confirmPurchase` requires 10 digits). NOT_BUY sessions never have a phone.
- **Change:** step 1 of a walk-in is the 10-digit phone; `Customer` is created/linked immediately. **Supersedes** the "phone only after BUY" rule (new D-entry).
- **Touches:** `createWalkIn` + `CreateSessionDto`, `StaffWorkspace` start screen, `Summary`, exports, privacy wording (non-buyers now keep a phone number).
- **Default:** phone is required (exactly 10 ASCII digits, as today); no skip. `?` whether a customer who refuses must still be servable.

### F2 Choose the category "like Trade-in"
- **Now:** `SelectionEditor` = category tabs (iPhone/iPad/Mac/Watch) + product grid + a separate accessories block (D48).
- **Change:** a step-by-step picker with big cards (category → product → model → capacity/colour) like the trade-in app (u-bid.uficon.com).
- **Touches:** web only (`SelectionEditor.tsx`, styles). No API change.
- **Default:** 4-step wizard on the existing hierarchy. `?` a screenshot of the trade-in screen if it must look identical.

### F3 More than one main product
- **Now:** one main product per session (`productId/modelId/skuId` on `CustomerSession`; requirements §5, D8). Stock deduction at FOUND, out-of-stock partial logic,
  stock review (`missingItems`), reservations (`availableUnits`), cashier list, export and the web mapper all assume one SKU.
- **Change:** a list of items (SKU + quantity) per session: new table `SessionItem` (+ migration that turns every existing session's main product into one item).
- **Touches:** the biggest refactor in this list: `sessions.service.ts` (select/confirm/found/out-of-stock/stock-review/cancel/restore), `products.service.ts` (reservations),
  `sessionApi.ts` mapper, Staff/Stock/Cashier/Logs/Summary UIs, CSV export. Supersedes "exactly one main Product" (requirements §5, D8).
- **Default:** items are (SKU, quantity 1..n); the legacy single-SKU columns are kept for old rows and read-only.

### F4 + / − on quantities
- Web only: replace the number inputs of accessories (and of main-product quantity from F3) with `−  n  +` steppers (min 1, remove at 0). **Default:** yes.

### F5 Stock "unlimited" for now
- **Now:** a SKU with stock 0 is shown as "สินค้าหมด" and cannot be selected (D41); real numbers arrive with the warroom sync (mode `on`, D55).
- **Change:** a temporary switch: while on, nothing is blocked by stock, the screen says "ไม่จำกัด", FOUND does not decrement.
- **Touches:** `ProductsService.findByBranch` (stock value + a flag), `SelectionEditor` (no disable), `advanceStep('found')` and the D41 restore/zero paths (skip), Admin toggle + setting storage.
- **Default:** one global ADMIN switch (stored in the database, not an env var), **on** until the warroom sync is switched to `on`; it overrides the ERP numbers while on.

### F6 Three more payment methods
- **Now:** a fixed client-side list of 11 (`constants/options.ts` `payments`); the server accepts any string (H-11).
- **Change:** add three names. `?` **the three names.** Optional improvement: move the list to the server (one source of truth).

### F7 + F8 Queue numbers that are easy to call; "SES-…" becomes "คิว" everywhere · **built (D57)**
> The *Now* line below describes the code before this change. Built as: letter + 3 digits per branch, per type, per Bangkok day; `reference` stays internal; see D57 and ADR 0001.
- **Now:** `reference = SES-YYYYMMDD-NNNNNN` (D6, one running number per day for all branches; allocation is racy, H-05). It is the lookup key (`getById` accepts it),
  the deep link (`#/logs?ref=`), shown in Staff/Stock/Cashier/Logs and in the CSV, and parsed in `StaffWorkspace.tsx:72` to find the day.
- **Change:** a short per-branch, per-day queue number (e.g. `A012`) shown as "คิว A012"; `reference` stays as the internal unique id (not shown).
  Allocation moves to an atomic counter (fixes H-05). Needs a rule for a **re-buy that reuses the old number** (F11).
- **Touches:** schema (`queueNo`, `queueDate`, counter table), `createWalkIn`, every screen that shows `reference`, CSV, deep link, tests.
- **Default:** `<letter><3 digits>` per branch per Bangkok day, resetting at midnight; the letter is the customer type (F15); 4 digits after 999.

### F9 Print receipt button, general receipt format
- **Now:** nothing prints. SES stores **no prices or amounts** by design (payments are method names only, requirements §20; D26 "no invoice/bill numbers").
- **Change:** a "พิมพ์ใบเสร็จ" button (browser print, print-only CSS) on the cashier screen: branch name/phone, date-time, queue, staff, items with quantities, payment methods, QR (F10).
- **Touches:** web (new print view). Prices/totals would need price data (warroom `price_sell` exists but is not read by SES) and a decision on legal status.
- **`?`** does the receipt show **prices and a total**? Default: **no prices** (an order summary / "ใบรับสินค้า"; the legal receipt stays in U POS). Paper: 80 mm thermal, A4 as fallback. `?` when it may be printed (at BILL_OPENED / COMPLETED).

### F10 Registration QR at the bottom of the receipt, one per branch
- **Now:** nothing. U POS (`infouficon/UFPOS`) has a public self-registration page `/register` (phone + OTP, writes the customer record found by phone). It takes **no branch parameter** today.
- **Change:** `Branch.registrationUrl` (ADMIN-editable, default built from a base URL + branch code) rendered as a QR on the receipt (client-side QR drawing).
- **Touches:** web + one nullable column; **U POS must accept `?branch=` to attribute the registration** (separate change in UFPOS, §3).
- **`?`** the registration URL pattern to encode.

### F11 Reasons "change model / colour / capacity / staff picked the wrong product" + "buy again" button
- **Now:** cancel reasons are fixed (`ลูกค้าเปลี่ยนใจ`, `รอนาน`, `อื่น ๆ`); a cancelled session is terminal, no reopen (D20).
- **Change:** two new reasons; after cancelling with one of them a **"ซื้อใหม่" button** creates a **new session pre-filled from the old one** (phone, items, accessories, payments, Ontop, points) that **keeps the old queue number**; the old session ends CUSTOMER_CANCELLED (stock restored, stock notified).
- **Touches:** `cancelSession`, new `rebuyOfId` link, queue number may repeat for the pair (uniqueness rule), D20 "no reopen" stays true (it is a new session), timing reports must chain the two.
- **Default:** allowed from any non-final state by the roles in F12; the pair counts as one visit for the total time.

### F12 Any role can cancel; stock is told clearly
- **Now:** cancel rights differ by stage and disagree with the confirmed matrix (H-13); the alert for STOCK about a cancelled session is dismissed only in the browser (`localStorage`, H-23).
- **Change:** any signed-in role of the branch can cancel any non-final session; when it happens **after FOUND** STOCK gets a persistent, unmissable notice (banner/modal, optional sound) that stays until a STOCK/MANAGER user acknowledges "คืนของเข้าชั้นแล้ว" (stored on the session, visible on every device).
- **Touches:** `cancelSession` (role check removed), new acknowledgement fields + endpoint + event, `StockWorkspace`. Supersedes the stage-based cancel matrix (OQ-01/OQ-02 become moot).
- **Default:** as written.

### F13 Cashier can send an order back to stock (wrong item picked)
- **Now:** the cashier steps only go forward (receive → scan → bill → complete) and can cancel.
- **Change:** "ส่งกลับ Stock" with a reason from SENT_TO_CASHIER / CASHIER_RECEIVED / CASHIER_SCAN: the session returns to the STOCK stage (`SEARCHING`), the unit counted at FOUND is released (+1), STOCK sees a banner "Cashier ส่งกลับ: <reason>", new event `CASHIER_REJECTED`.
- **Touches:** state machine (first backward transition besides D40 CHANGE_ITEMS), timestamps are single-valued and immutable so durations rely on events (F14), stock accounting.
- **Default:** back to `SEARCHING`; whole order, not per item.

### F14 Export with the time spent in each step
- **Now:** the CSV (`SessionLogsWorkspace` export) has the raw milestone timestamps only.
- **Change:** extra columns: wait before demo, demo, decision, selection, confirm→search (queue at stock), search→found, found→sent, sent→received, received→scan, scan→bill, bill→complete, total; rejects/re-buys add up per step. Format `H:MM:SS` plus minutes.
- **Touches:** web export (computed from timestamps/events); optionally a server endpoint later.
- **Default:** as written.

### F15 Customer type A / B (B = takes long) · **built (D57)**
> Built as a back-office list (letters A-Z, owner-created); the staff member picks at the phone step; the letter is the queue letter.
- **Now:** none. (U POS's repair queue has ticket types A/B/D, which are unrelated: pick-up / drop-off.)
- **`?`** who decides and when: see §5 Q2. **Default:** the staff member chooses at the phone-number step; the letter becomes the queue letter (F7); reports compare A and B durations.

### F16 "Data updates every 3 hours from FMP"
- Matches warroom (5 pulls a day, about 3 h apart; 12.5 h overnight). Action: show "ข้อมูลสต็อก ณ <time>" on the staff screen (the `erpAsOf` field exists). **Default:** yes.

### F17 Fix bill opening on U POS (cashier does the work twice; KPI cannot be measured)
- **Now:** the cashier presses "เปิดบิล" in SES **and** opens the bill in U POS: two actions, and SES's `billOpenedAt` is the SES click, not the real U POS bill time.
- **Change:** needs a contract with U POS (UFPOS, a separate repo, maintained by another team/AI session; cross-repo requests go through GitHub Issues labelled `integration:pos`, see §3).
- **`?`** which option: see §5 Q3.

## 3. U POS facts (read from `infouficon/UFPOS`, 2026-10-13)

U POS replaces the FileMaker UFService (Next.js 16 + Prisma 7 + Postgres, Vercel). It already has: sales, deposits, receipts, billing, cashier closing, stock ledger,
a **repair** queue with kiosk and TV display (`/pos/queue`, `/queue-display/[branchCode]`, ticket types A/B/D), and a public customer self-registration (`/register`, phone OTP).
Its rules: read `project.md`/`docs/HANDOFF.md` before changing it; sibling-system requests use GitHub Issues with the label `integration:pos`; secrets are never shared by an AI.
Not done yet there: sender for e-Tax/ERP, data migration, cut-over date. **Consequence for SES:** the FileMaker feed that warroom reads (stock, bills) will eventually come from U POS instead;
anything SES builds on warroom should keep that in mind (the `branch_code` and part-number keys must survive the switch).

## 4. Proposed delivery order (nothing started)

1. **Quick, low risk (no schema change):** F4 steppers, F6 payments, F8 wording if the queue number already exists, F14 export durations, F16 stock timestamp.
2. **Small schema:** F5 unlimited-stock switch, F7 queue numbers (counter, fixes H-05) with F15 letter, F10 branch QR + F9 print (no prices), F12 any-role cancel + persistent stock notice.
3. **Model changes:** F1 phone first, F3 multiple main products (`SessionItem`), F2 wizard, F11 "buy again", F13 cashier reject.
4. **Cross-repo:** F17 (+ the `?branch=` parameter for F10) with UFPOS.
Each step = one PR with tests first (see [recipes.md](recipes.md) §3), docs and decisions updated in the same PR.

## 5. Questions that cannot be defaulted (asked to the owner 2026-10-13)

Answered by the owner on 2026-10-13:
- Q1 Receipt: **no prices** (D58).
- Q2 Customer type A/B: **configured in the back office, the owner creates the types, ordered A-Z**; the queue letter is the type's letter (D57). Defaults still to confirm: the staff member picks the type at the phone step, and it cannot change afterwards.
- Q3 U POS bill opening: **two-way** (D60).
- Q4 Unlimited stock: **one global ADMIN switch**, on by default (D59).

Still open (nothing blocks the work; defaults in brackets; recorded as OQ-13, OQ-14, OQ-15 in [../open-questions.md](../open-questions.md)):
- the three payment method names (F6) (a list the back office can edit is the fallback, so no deploy is needed to add them);
- the registration URL to encode in each branch's QR (F10) (a per-branch URL field, set in the back office);
- whether a customer may refuse to give a phone number (F1) (no: the phone is required, D56).
