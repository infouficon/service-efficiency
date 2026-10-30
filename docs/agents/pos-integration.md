# U POS integration (F17, D60): what SES offers and what U POS is asked to do

Status 2026-10-13: **SES side built** (branch `feat/pos-integration`), inert until `POS_API_KEY` is set. **U POS side not started**:
nothing has been opened in `infouficon/UFPOS` yet (it is another team's repo; the owner decides when). This file is the
contract and the ready-to-paste request.

## 1. The problem and the owner's answer

The cashier opens the bill twice: "เปิดบิล" in SES and the real bill in U POS. SES's `billOpenedAt` is the click in SES, not the
real bill time, so the KPI cannot be measured. The owner chose a **two-way** integration (D60): SES sends the order lines to U POS
so the bill is pre-filled, and U POS reports back when the bill is really opened, so SES records the real time.

```text
STOCK sends the goods ─▶ SES order at the cashier (SENT_TO_CASHIER)
cashier in U POS ──GET /api/integrations/pos/orders?branch=<code>[&queue=A012]──▶ SES   (pick the order, the bill is pre-filled)
cashier saves / issues the bill in U POS
U POS ──POST /api/integrations/pos/bills {reference, billNo, openedAt}──▶ SES           (SES: BILL_OPENED at the real time)
cashier completes the sale in SES (one click) · or no click in SES at all, a later step
```

## 2. The contract (SES side, built)

Live documentation (OpenAPI, public, "Try it out" with the key): **`https://ses.uficon.com/api/pos-docs`** (D84). The JSON is at `/api/pos-docs-json`.


Base: `https://ses.uficon.com/api` · server to server · `Authorization: Bearer <POS_API_KEY>` · JSON · no cookies, no CSRF header.
Without the key configured (or shorter than 32 characters) the routes answer **404** with the message `POS integration is off: POS_API_KEY is not set …` (an unknown branch is also 404 but says `Unknown branch`); a wrong key is **401**. Responses are `Cache-Control: no-store`.

### `GET /integrations/pos/orders?branch=<branch_code>[&queue=<A012>]`
The orders of that branch (ERP `branch_code`) that have reached the cashier and have no bill yet: states `SENT_TO_CASHIER`,
`CASHIER_RECEIVED`, `CASHIER_SCAN`, not cancelled. Oldest first. 400 without `branch`, 404 for an unknown branch.

```json
{
  "branch": { "code": "ISTUDIO-01", "name": "iStudio Central" },
  "orders": [
    {
      "reference": "SES-20261013-000042",
      "queue": "A012",
      "state": "SENT_TO_CASHIER",
      "customerPhone": "0812345678",
      "staffId": "100234",
      "confirmedAt": "2026-10-13T05:12:03.411Z",
      "items": [{ "partNo": "MG8G4ZP/A", "name": "iPhone 16 Pro 256GB Desert Titanium", "quantity": 2 }],
      "accessories": [{ "name": "Case", "quantity": 1 }],
      "payments": ["Cash", "Transfer"],
      "paymentTypes": ["เงินสด", "โอนเงิน"],
      "ontop": ["AIS"],
      "points": ["MCard"],
      "burnPoints": [],
      "posBillNo": null
    }
  ]
}
```
- `reference` is the key to report back with; `queue` is what staff call the customer by (not unique across days).
- `items[].partNo` is the Apple part number (SES `ProductSku.sku`, the same key warroom uses); accessories are free names (SES has no SKU for them);
  payments / Ontop / points are names; `paymentTypes` files the payments under the FileMaker payment types (D89, see fmp-outbound.md). **No prices anywhere**: SES stores none (D58/D26).
- `customerPhone` (10 digits) lets U POS find or create the customer. It is personal data: the key is the only protection, keep it secret.

### `POST /integrations/pos/bills`
```json
{ "reference": "SES-20261013-000042", "billNo": "INV-2026-000123", "openedAt": "2026-10-13T05:20:11.000+07:00" }
```
- `openedAt`: ISO 8601 with a time zone, not later than 5 minutes ahead, not before the order's walk-in, not older than a year (else 400).
- An order **at the cashier** (`SENT_TO_CASHIER` / `CASHIER_RECEIVED` / `CASHIER_SCAN`) moves to `BILL_OPENED`: `billOpenedAt` = `openedAt`, event `BILL_OPENED` by actor `U-POS`
  (`{source, billNo, openedAt}`). The cashier then only completes the sale in SES.
- If the cashier **pressed first** in SES (`BILL_OPENED`) or the sale is already `COMPLETED`: SES's own time is kept and the bill number and time are stored beside it
  (`posBillNo`, `posBillOpenedAt`); no second event.
- **Idempotent**: the same `reference` + `billNo` again returns 201 with the same body and changes nothing; another `billNo` for the same order is **409**.
- 404 unknown reference · 409 order cancelled / ended, or not at the cashier yet · 400 bad body (unknown fields are refused).
- Response: `{ reference, state, posBillNo, posBillOpenedAt, billOpenedAt }` (the status code is 201).

U POS should **retry until it gets a 2xx** (the call is idempotent) and may poll the orders list at a calm rhythm (every 10 seconds or on demand when the cashier opens the picker).

## 3. Keys and configuration
- SES (Coolify, the `api` app): `POS_API_KEY` = a random string of 32 or more characters, **Sensitive**. Restart the api after setting it.
- U POS (Vercel): the same value under a name of its choice (for example `SES_API_KEY`), Sensitive, plus `SES_API_BASE=https://ses.uficon.com/api`.
- Rotation changes both sides at once (as for the trade-in key). Nobody pastes the key into chat, an issue or a file in a repo.

## 4. What the owner / U POS team decide
1. Where in U POS the cashier picks the SES order (a button on the new-bill screen listing the branch's orders, or a field for the queue number).
2. How `partNo` maps to U POS products and what to do with accessory names (no SKU in SES).
3. When exactly "the bill is opened": at save, at issue (e-Tax), at payment? That moment is the KPI timestamp.
4. A bill voided or credited after it was reported: SES has no endpoint for that yet; say if it is wanted.
5. The registration page `/register` for the receipt QR (F10, D67): will it accept `?branch=<branch_code>` to attribute the registration to a branch? SES only needs the address per branch.

## 5. Request to paste into `infouficon/UFPOS` (label `integration:pos`)

> **ขอเชื่อม SES (Service Efficiency) กับ U POS: เปิดบิลครั้งเดียว และวัดเวลาเปิดบิลจริง**
>
> SES (ses.uficon.com) บันทึกขั้นตอนบริการหน้าร้านถึงแคชเชียร์ ตอนนี้แคชเชียร์ต้องกด "เปิดบิล" ใน SES แล้วเปิดบิลจริงใน U POS ซ้ำอีกรอบ
> และเวลาใน SES เป็นเวลาที่กดปุ่ม ไม่ใช่เวลาเปิดบิลจริง จึงวัด KPI ไม่ได้ เจ้าของงานเลือกแนวทาง **สองทาง**:
> 1. U POS **ดึงรายการสั่งซื้อจาก SES** (สินค้า/จำนวน/ช่องทางชำระเงิน/เบอร์ลูกค้า) มาเติมในบิลให้อัตโนมัติ
> 2. U POS **แจ้งกลับ SES** ทันทีที่เปิดบิลสำเร็จ (เลขบิล + เวลาจริง) SES จะบันทึกเวลาจริงและเลื่อนสถานะให้เอง
>
> ฝั่ง SES ทำเสร็จแล้ว (ปิดอยู่จนกว่าจะตั้งคีย์): สัญญา API ครบใน `docs/agents/pos-integration.md` ของ repo `infouficon/service-efficiency`
> (`GET /api/integrations/pos/orders`, `POST /api/integrations/pos/bills`, Bearer key, idempotent)
>
> ขอให้ทีม U POS: (1) ตัดสินใจจุดที่แคชเชียร์เลือกออเดอร์จาก SES ในหน้าสร้างบิล (2) map `partNo` (เลขชิ้นส่วน Apple) กับสินค้าใน U POS
> (3) เรียก `POST /bills` ตอนเปิดบิลสำเร็จ (retry จนได้ 2xx) (4) ตกลงว่า "เวลาเปิดบิล" คือขณะไหน (บันทึก/ออกใบกำกับ/รับชำระ)
> (5) ตอบว่าหน้า `/register` รับ `?branch=<branch_code>` เพื่อบอกสาขาที่ลูกค้าลงทะเบียนได้ไหม (ใช้กับ QR ท้ายใบเสร็จของ SES)
> คีย์ (`POS_API_KEY` ฝั่ง SES / ชื่อที่ U POS ตั้งเอง) ให้เจ้าของระบบตั้งใน Coolify/Vercel เอง ไม่ส่งในแชตหรือ issue
