# SES -> FileMaker: the orders SES sends (D88)

What SES sends to the FileMaker `UFService` database, when, and how it behaves when FileMaker is slow or down. Decisions: D88, D89
(payment types), D90 (log and callback) in `docs/decisions.md`. Code: `apps/api/src/fmp/`, `apps/api/src/sessions/order-view.ts`, test `apps/api/tests/fmp-outbound.test.mjs`.

## Contract (what the FileMaker team receives)

One **new record** in layout `ses` per message (Data API `POST /fmi/data/vLatest/databases/UFService/layouts/ses/records`), the field
`ses_body` holding a JSON text:

```json
{
  "source": "SES",
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
  "items": [{ "partNo": "MG8G4ZP/A", "name": "iPhone 17 Pro 256GB Deep Blue", "quantity": 2 }],
  "accessories": [{ "name": "Case", "quantity": 1 }],
  "payments": ["Cash", "Transfer"],
  "paymentTypes": ["เงินสด", "โอนเงิน"],
  "ontop": ["AIS"],
  "points": ["MCard"],
  "burnPoints": [],
  "posBillNo": null
}
```

- Everything from `reference` down is **the same view the U POS door serves** (`GET /api/integrations/pos/orders`), produced by one function.
- `reference` is the key (`SES-YYYYMMDD-NNNNNN`); `queue` is what staff call the customer by. Report the bill back with
  `POST /api/integrations/pos/bills {reference, billNo, openedAt}` (docs/agents/pos-integration.md).
- `payments` = the payment **methods** as picked in SES (`Cash`, `Transfer`, `0% Credit Card`, `PayNext`, … — the list ADMIN keeps, so
  it can grow). `paymentTypes` = the same payments by **type**, each type once, in the FileMaker team's words: `เงินสด`, `โอนเงิน`,
  `บัตรเครดิต`, `บัตรเงินผ่อน`, `ใช้มัดจำ`, `Trade In`, `U-Joy`, `Partner Mall`, or `อื่นๆ` for a method with no type yet (D89).
  Map on `paymentTypes`; `payments` says which method exactly. U-Joy points are in `points` / `burnPoints`, not here. SES stores no
  amount per method, so the cashier enters the amounts.
- `outboxId` is unique per message: **dedupe on it** (delivery is at-least-once). `event`: `SENT_TO_CASHIER` (the order reached the
  cashier) or `RESEND` (an ADMIN sent an existing order again).
- **No serial numbers and no prices**: SES has neither (stock is by part number; no price is stored, D58). `partNo` is the Apple part
  number (the key warroom uses). `customerPhone` is personal data.
- Times are ISO 8601 UTC. If the FileMaker team asks for `script` + `script.param`, SES sends
  `{"source":"SES","reference":"…","event":"…","outboxId":"…"}` as the param once `FMP_SCRIPT` is set.

## Behaviour

| Situation | What SES does |
| --- | --- |
| Not configured (`FMP_*` unset) | queues and sends nothing |
| FileMaker up | the worker (every 10 s) logs in once, creates one record per message, logs out |
| FileMaker down / error | retries after 1, 2, 5, 10, 20, 30, 60 min (8 attempts), then `failed`; Admin → "ส่งไป FileMaker" → "ส่งซ้ำ" |
| Token dropped mid-round | logs in again once |
| Script error from FileMaker | recorded, the message counts as sent (the record exists) |
| Two containers | a message is claimed before it is sent, so one sends it |

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
Only "order at the cashier" is sent. An order cancelled or sent back to stock later is not reported yet; serial numbers need a STOCK
step in SES (not built).
