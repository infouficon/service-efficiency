# SES -> FileMaker: the orders SES sends (D88)

What SES sends to the FileMaker `UFService` database, when, and how it behaves when FileMaker is slow or down. Decisions: D88, D89
(payment types), D90 (log and callback), D91 (script parameter), D92 (serial numbers), D95/D96 (one record per order, script answer,
retries) in `docs/decisions.md`. **For the FileMaker team, in Thai:** [fmp-team-th.md](fmp-team-th.md) (why, what their `ses` script
needs to change, how FMP reports the bill back). Code: `apps/api/src/fmp/`, `apps/api/src/sessions/order-view.ts`, test `apps/api/tests/fmp-outbound.test.mjs`.

## Contract (what the FileMaker team receives)

One record in layout `ses` **per order**, the field `ses_body` holding a JSON text. The first message of an order creates the record
(Data API `POST …/layouts/ses/records`); every later message of the same order **updates** it (`PATCH …/layouts/ses/records/<recordId>`)
and runs the script again (D95). A retry of a message that may have reached FileMaker looks the order up first (`_find` on `ses_id`), so
it never creates a second record (D96).

```json
{
  "source": "SES",
  "version": 1,
  "test": false,
  "createdAt": "2026-10-29T17:31:31+07:00",
  "event": "SENT_TO_CASHIER",
  "outboxId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "queuedAt": "2026-10-29T10:31:31.123Z",
  "branch": { "code": "ISTUDIO-01", "name": "iStudio Central" },
  "reference": "SES-20261029-000042",
  "queue": "A012",
  "state": "SENT_TO_CASHIER",
  "customerPhone": "0812345678",
  "staffId": "1004",
  "confirmedAt": "2026-10-29T10:20:03.411Z",
  "items": [{ "partNo": "MG8G4ZP/A", "upc": "194253000001", "name": "iPhone 17 Pro 256GB Deep Blue", "quantity": 2, "sn": ["F9XXXXXXXX01", "F9XXXXXXXX02"] }],
  "accessories": [],
  "accessoriesForCashier": [{ "name": "Case", "quantity": 1 }],
  "payments": ["Cash", "Transfer"],
  "paymentTypes": ["เงินสด", "โอนเงิน"],
  "ontop": ["AIS"],
  "points": ["MCard"],
  "burnPoints": [],
  "posBillNo": null
}
```

- **Accessories (D97):** `accessories` is always `[]` in the FileMaker message (the `ses` script refuses any; the shop adds them in
  FileMaker by hand); what the customer picked is under `accessoriesForCashier` for information. The U POS door still lists them.
- Everything from `reference` down is **the same view the U POS door serves** (`GET /api/integrations/pos/orders`), produced by one function.
- `reference` is the key (`SES-YYYYMMDD-NNNNNN`); `queue` is what staff call the customer by. Report the bill back with
  `POST /api/integrations/pos/bills {reference, billNo, openedAt, completedAt?}` (docs/agents/pos-integration.md).
- `payments` = the payment **methods** as picked in SES (`Cash`, `Transfer`, `0% Credit Card`, `PayNext`, … — the list ADMIN keeps, so
  it can grow). `paymentTypes` = the same payments by **type**, each type once, in the FileMaker team's words: `เงินสด`, `โอนเงิน`,
  `บัตรเครดิต`, `บัตรเงินผ่อน`, `ใช้มัดจำ`, `Trade In`, `U-Joy`, `Partner Mall`, or `อื่นๆ` for a method with no type yet (D89).
  Map on `paymentTypes`; `payments` says which method exactly. U-Joy points are in `points` / `burnPoints`, not here. SES stores no
  amount per method, so the cashier enters the amounts.
- One record per order (D95): a second send of an order (after a cashier reject and a new scan, or an ADMIN's "ส่งซ้ำ") **updates the same
  record**, so `ses_id` stays unique and the script sees the serial numbers scanned last. `outboxId` is unique per message (delivery is
  at-least-once). `event`: `SENT_TO_CASHIER` (the order reached the
  cashier) or `RESEND` (an ADMIN sent an existing order again).
- **No prices**: SES has none (D58). `partNo` is the Apple part number (the key warroom uses; the script compares it with `product_model`).
  **Serial numbers (D92/D101):** `items[].sn` are the ones STOCK scanned at the shelf, one by one while picking (each saved at once), and
  the message goes when STOCK presses "send"; normally exactly `quantity` per product (D103: fewer when STOCK chose "send with serials
  missing"; `items[].snMissing` says how many, the `ses` v3.1 script leaves those units out of the held bill and the cashier scans them in), none repeated, none
  in another open order; they are typed or scanned as the shop reads them, so a wrong one is only caught by your script (`SN_*`). `upc` is
  the warroom barcode (null if unknown). `version` is 1 until a field changes meaning; `test` is false for real orders; `createdAt` is the
  moment the message was made, in Thai time with its offset (your script reads the digits as written). `customerPhone` is personal data.
- Times are ISO 8601 UTC. Once `FMP_SCRIPT` is set (the script is named `ses`), the create call also runs it with `script.param` = the
  order's **reference** as plain text (`SES-20261030-000002`), nothing else (D91). A reference can have two records (the first send and a
  `RESEND`): take the latest, or read `outboxId` from `ses_body`. A script error is recorded in the admin log but SES does not send the
  record again.

## Behaviour

| Situation | What SES does |
| --- | --- |
| Not configured (`FMP_*` unset) | queues and sends nothing |
| FileMaker up | the worker (every 10 s) logs in once, creates the order's record (or updates it on a later send), logs out; a create or update that runs the script may take up to 60 s |
| FileMaker down / error | retries after 1, 2, 5, 10, 20, 30, 60 min (8 attempts), then `failed`; Admin → "ส่งไป FileMaker" → "ส่งซ้ำ" |
| Token dropped mid-round | logs in again once |
| Script error from FileMaker | recorded, the message counts as sent (the record exists) |
| Two containers | a message is claimed before it is sent, so one sends it |

## Notes from reading the `ses` script (2026-11-02), for the FileMaker team

What the script does with what SES sends, so nothing surprises anyone. These are for the FileMaker side to settle; SES changes only what is said above.

| The script | SES sends | What happens |
| --- | --- | --- |
| `accessories` must be empty (`ACCESSORIES_NOT_SUPPORTED`) | most orders have some (free names, no SKU, no price) | those orders fail until accessories are handled or ignored |
| `payments` is mapped by English words (Cash, Transfer, Credit Card, Installment, Deposit…) | SES method names: `Cash`, `Full Credit Card`, `0% Credit Card`, `PayNext`, `ใช้มัดจำ`, `WEB`… (ADMIN can add more) | names that do not contain those words do not map; **`paymentTypes`** (D89: เงินสด, โอนเงิน, บัตรเครดิต, บัตรเงินผ่อน, ใช้มัดจำ, Trade In, U-Joy, Partner Mall, อื่นๆ) is the field meant for this |
| the customer must exist by phone (`customer.cust_tel`, else `WRONG_PHONE`) | the phone typed at the walk-in; new customers are not in FileMaker | a first-time customer fails |
| `state` must be `SENT_TO_CASHIER` | `state` is the order's state at the time: a "send again" after the cashier moved on carries the later state | `INVALID_STATE` |
| finds its record by `ses_id` and needs exactly one | an ADMIN's "send again" makes a second record with the same reference | `NOT_FOUND` (two found); pick the latest, or find by `outboxId` |
| `staffId` read as a number | SES staff ids (numeric for ERP accounts, free text for hand-made ones) | a non-numeric id becomes 0 |
| the bill price comes from FileMaker (`Price_Sell` of the serial's model) | SES has no price | nothing to do |

## What SES reads from the script's answer (D95)

When `FMP_SCRIPT` is set, the Data API returns the script's result. SES reads the script's JSON (`{ok, code, sesID, saleID, lines,
message}`) and shows it on the order's row in Admin → ส่งไป FileMaker (and in the log): `ok:true` = success (e.g. `CREATED saleID …`),
`ok:false` = error with its code and message (`SN_NOT_FOUND`, `SN_WRONG_BRANCH`, `SN_ALREADY_SOLD_OR_HELD`, `WRONG_PHONE` …).
`ALREADY_DONE` when SES updated an existing record (a second send) is shown as an error: the serial numbers of that send were not used.
Keep the result JSON as it is; a result that is not JSON is stored but not interpreted.

## Reporting back: the callback door (D90)

FileMaker tells SES what it did with a message by calling:

```
POST https://ses.uficon.com/api/integrations/fmp/callback
Authorization: Bearer <FMP_CALLBACK_KEY>
Content-Type: application/json

{
  "outboxId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "status": "success",
  "message": "บันทึกบิลแล้ว",
  "time": "2026-10-30T17:31:31+07:00"
}
```

- Identify the message by `outboxId` (copy it from the record's `ses_body`; unique per message) or, if that is not handy, by
  `reference` (SES takes the latest message of that order). Both given and not belonging together: 400. Unknown: 404.
- `status`: `"success"` or `"error"` (any case; Thai `สำเร็จ` / `ล้มเหลว` and true/false work too). Anything else is kept as
  "reported". **Do not send a bare number** (SES does not read 0/1 as a result).
- `message` (optional, 255 characters): shown in the admin page. `time` (optional): when FileMaker did it. Send **ISO 8601 with the
  offset** as above. Without an offset, or as `YYYY-MM-DD HH:mm:ss`, it is read as Bangkok time; epoch seconds work. FileMaker's
  `MM/DD/YYYY HH:mm:ss` is not guessed: SES keeps the text and shows "อ่านเวลาไม่ได้". Whether you send a time at all is visible in the
  admin page, nothing depends on it.
- Any other fields are kept in SES's log (phone numbers masked). The answer is `200 {"ok":true,"outboxId","reference","status","time","timeReceived"}`:
  read `status` and `time` in it to check SES understood you.
- A report only **records**; it does not change the order in SES. Report as often as you like (the latest is shown, all are logged).
  It may be sent as soon as your script runs, even before SES has finished the create call.
- FileMaker side: *Insert from URL* with cURL options like
  `-X POST -H "Content-Type: application/json" -H "Authorization: Bearer " & $key & "" -d @$json` (the content type header matters: the
  default form encoding carries no JSON).
- The key is set by the SES owner (`FMP_CALLBACK_KEY`, 32 characters at least) and given to you outside any chat or ticket. While it is
  unset the door answers 404 "FileMaker callback is off"; a wrong key is 401. If Cloudflare answers 403 to your server, tell the SES
  owner (a WAF rule may be needed).

## The admin log (D90)
Admin → ส่งไป FileMaker → "บันทึกการสื่อสาร SES ↔ FileMaker": every Data API call (login, create, logout) with path, HTTP status,
FileMaker's code and answer and the time it took; every report received; SES's own steps (queued, retry, gave up). Filter by reference,
direction or "only problems"; click a row for what was sent and what came back. No password or token is stored and phones are masked
to their last four digits; rows are kept 90 days.

## Open
For the bill itself, FileMaker can tell SES it opened the bill through the U POS door, `POST /api/integrations/pos/bills
{reference, billNo, openedAt}` with `Authorization: Bearer <POS_API_KEY>` (the order moves to BILL_OPENED), and that the customer paid,
the same call with `completedAt` (the order is COMPLETED at that time, D101; [pos-integration.md](pos-integration.md); the ready-made
`ses_report_bill` v2 sends both).

Only "order at the cashier" is sent. An order cancelled or sent back to stock later is not reported yet (a cashier reject clears the
serial numbers in SES, the held bill in FileMaker stays). A damaged unit the cashier removes (D75) is not told either.
