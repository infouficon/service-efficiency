# ERP stock and staff integration: what exists and what is missing

Findings from reading `taspotae-lab/dashboard-npi-warroom` (private; local clone
`~/ghq/github.com/taspotae-lab/dashboard-npi-warroom`, read at `cf21e40`, 2026-10-05) on 2026-10-12.
**Nothing was run against the live warroom or the ERP.** No OData call, no Coolify call, no change in that repo.
Goal of the work: show ERP stock in SES (replacing or feeding `BranchInventory`, D41) and
log SES users in with the Staff table from FileMaker (FMP), refreshed daily at 10:00.

## 0. Implementation status (2026-10-12, branch `feat/erp-sync`)

| Phase | State |
| --- | --- |
| 1. Backend: branch + staff import (D53/D54), run log, ADMIN endpoints | **Built, tested, merged and deployed** (squash `a199c6b`, PR #2, live on ses.uficon.com since 2026-10-12 16:20): `apps/api/src/erp/`, migration `202610120001_erp_sync`, `apps/api/tests/erp-sync.test.mjs` (24 tests). The job is **off** until `ERP_ODATA_BASE_URL/USER/PASS` are set in Coolify |
| 2. Web: "ซิงก์ ERP" panel, ERP badge/locked fields in the staff table | **Built, merged, deployed** (bundle `index-Bg1qHHmf.js`). Checked in headless Chrome against a mock API only |
| 3. Products and stock from the warroom database (D52, D55) | **Built, tested (17 tests against a Postgres stub of `mart.stock_mv`), not deployed until merged and `WARROOM_DATABASE_URL` is set**: SES reads `mart.stock_mv` read-only itself; modes off / shadow (default) / on. See [warroom-products.md](warroom-products.md). The API route written first (warroom PR #1, `GET /api/ses/stock`) is not needed and was closed. **Never run against the real warroom database yet** (its host is internal to Coolify): the first dry run in the admin panel is the first real read |

**Still NOT verified against the live ERP.** A health probe at 16:18 (after the owner said the ERP was normal) got HTTP 503 from `branch/$count`; no further ERP request has been made since.

(Earlier note:) A real end-to-end dry run was started at about 15:35 and never completed: the ERP's OData service stopped answering
(even `branch/$count` and the unauthenticated OData root hung for 12 to 90 s while the web root answered in 0.1 s). The only live facts used are the read-only
aggregates in §3.1 and the field syntax. **The first run on any environment must be "ทดลองรัน" (dry run), watched, and only when the ERP is healthy.**
**Cause unknown, and probably not my query.** Warroom's own freshness (`GET /api/freshness`, public, needs a browser User-Agent) at 17:14 showed the last successful stock load at **12:31 Bangkok** and sales at 12:21, i.e. the **15:15 slot never loaded anything**, before or while my first request hung (about 15:35). Warroom itself sends `status eq 'ready' or status eq 'transfer'` filters on a table 1000 times bigger at every slot, so my `$filter` on `staff` is an unlikely cause. The code still never sends `$filter` to the ERP (precaution), treats a timeout as final (no retry), and sends one request at a time.

## 1. The three systems

```text
FMP ERP  (https://pos.uficon.net/fmi/odata/v4/UFService, HTTP Basic, account "dashboard")
   │  pull via OData, 5 times a day (12:15 15:15 18:15 21:15 23:45 Bangkok), full stock every time
   ▼
warroom  (Bun + Hono, Coolify project UFicon.Tech, https://npi-warroom.coolify.pve01.prod.uficon.com)
   │  Postgres "Dashboard_NPI_Warroom": src.* (raw mirror, all text) → mart.* (views) → app.* (users, logs)
   ▼
dashboard UI (email-OTP login)          SES  ← NOT connected yet
```

Warroom's own docs are in that repo: `CONTEXT.md`, `docs/ODATA_FINDINGS.md` (read this one before any OData work),
`docs/ODATA_RUNBOOK.md`, `docs/adr/0001-pull-odata-instead-of-push-webhook.md`.

## 2. Stock: the data is already in warroom, but it is not realtime and not yet an API

**What it holds.** `src."Export_stock"` is loaded from FMP table `ProductStore_detail` where
`status` is `ready` (at a branch, sellable) or `transfer` (in transit, not sellable). **One row per serial number (SN)**,
all products, not only iPhone (the iPhone-17/18 scope is applied later in `mart.in_scope` for the dashboard).
`mart.stock_current` (view; latest definition in `sql/73_stock_partner_header_status.sql`) is "latest row per SN,
minus SNs that appear in a completed sale bill". Order of 90k rows (`sql/51`: 94,558; `sql/69`: 97,369 in Sept 2026).
Columns SES would use: `product_upc`, `ProductStore::product_model` (Apple part no., e.g. `MG8G4ZP/A`),
`ProductStore::product_name`, `product_sn`, `status`, `BranchStore_id`, `StockBranch::branch_code`,
`StockBranch::branch_name`, category / sub-category, `ProductStore::Price_Sell`, `transfer_id`, `date_transfer`, `Branch_From_id`.

**Freshness (verified 2026-10-12).** Stock is **not** updated every N minutes: warroom pulls the ERP **5 times a day** at `ODATA_TIMES = 12:15,15:15,18:15,21:15,23:45` Bangkok (`src/lib/syncSchedule.ts`; the Coolify env pasted by the owner has no `ODATA_TIMES`/`ODATA_ENABLED`, so the defaults apply; a DB switch `app.switch` can also pause it). Every slot pulls ALL stock (about 88k+ serial numbers) and then refreshes `stock_mv`: today's 12:15 slot loaded sales at 12:21 and stock at **12:31** (about 16 minutes). Gaps: 3 h, 3 h, 3 h, 2.5 h, then **12.5 h overnight**. A slot that fails is **not retried** (the next chance is the next slot). Before 2026-09-24 it ran every 30 minutes (48 a day); the owner cut it to protect the ERP. SES therefore needs to read `max(snapshot_at)` only occasionally and re-read when it changes.
The owner (โปเต้) cut this from 48 runs a day on 2026-09-24 to protect the ERP that the shops sell on, and accepted
that the dashboard is stale from 23:45 until 12:15 next day. **At shop opening SES would see last night's stock.**
`GET /api/dashboard/_meta` returns a data version; the README mentions `/api/freshness`.

**The ERP is fragile; copy these rules** (measured in `docs/ODATA_FINDINGS.md` §5, §10): FileMaker queues requests, so
parallel calls make everything slower, including the shops; filtered queries on big tables take 7–35 s; one request at a
time; never `$orderby` without `$filter` on a large table. SES must not call the ERP per user action.

**API surface today (`src/index.ts`).** Nothing fits SES yet:
- `/api/dashboard/:block` returns JSON shaped for the dashboard's charts (`docs/DASHBOARD_CONTRACT.md`), not stock by branch and SKU.
- `/api/pm/*` is the purchasing page. `/admin/*` is for admins.
- Every route above needs a **cookie session created by email OTP** for `@uficon.com` / `@uficon.net` (`src/middleware/auth.ts`,
  `ALLOWED_EMAIL_DOMAINS`). There is **no API key or service account**, so SES cannot call it as it is.
- The live host answered **HTTP 403 with an empty body** to a plain GET from this machine. The app itself would answer `/` with
  a 302 to `/login`, so the 403 most likely comes from the proxy in front (an allow-list?). Unverified; ask the owner.

### Ways SES can get stock (decided 2026-10-12, D55: option B, direct read-only; kept here for the reasoning)

| Option | How | For | Against |
| --- | --- | --- | --- |
| **A. New read endpoint in warroom** (recommended) | e.g. `GET /api/stock?branch=&partNo=` behind an API key, reading a dedicated stable view `mart.ses_stock_by_branch_part` | one owner of ERP knowledge; SES stays decoupled from `mart` internals | needs a change in the warroom repo and the owner's approval |
| B. SES reads Postgres directly | read-only role `npi_reader` on a stable view | no new service code | couples SES to their DB; credentials and network path to manage; schema changes break SES |
| C. SES calls the ERP itself | its own OData calls | realtime-ish | breaks the "protect the ERP" rule; SES would add load per click |

None of these makes the data fresher than the warroom schedule. If SES needs stock fresher than the 12.5-hour night gap, the
schedule (the owner's decision) or the double-counting rule below has to change.

### 2.1 Proposed contract for the missing warroom endpoint (for the warroom owner; nothing here is built)

`GET /api/ses/stock?branchCode=<code>[&partNo=<MG8G4ZP/A>]` with an API key header (a dedicated key, not the OTP cookie), reading a stable view such as
`mart.ses_stock_by_branch_part`. Response `{ asOf: ISO, source: "stock_current", rows: [{ branchCode, partNo, upc, ready: int, transfer: int }] }`:
one row per branch and part number, counts of serial numbers with `status = 'ready'` (and separately `transfer`), `asOf` = the last successful ERP sync
time (so SES can show how old the number is). Rate: SES would poll at most every few minutes and cache. SES side to build after the owner agrees:
`BranchInventory.erpReady` + `erpAsOf`, the availability rule of D52, and a flag to keep D41's manual quantity until then.

### Mapping and semantics gaps (unresolved)

1. **SKU key.** Decided in D52: follow warroom's identifiers. Still to fix: ERP has both `product_upc` and the Apple part number (`MG8G4ZP/A`);
   SES `ProductSku.sku` currently holds demo codes (`IP16P-128-NAT`, `products.service.ts:53+`) and the real SES master is unknown
   (D14: "awaiting the user's master-data file"). Candidate: `ProductSku.sku` = part number, loaded from warroom's `mart.sku_catalog`.
2. **Branch key.** ERP `branch_code` / `branch_name` (e.g. `iStudio @ Central Khonkaen Campus`) vs `Branch.code` (a free-text,
   non-unique value in SES). Needs a mapping table or a rule that codes are equal.
3. **Granularity.** ERP counts serial numbers. SES `BranchInventory.stock` is a quantity per SKU. Aggregate by part number and
   branch, `status = 'ready'` only (a `transfer` unit is not sellable).
4. **Double counting.** D41 makes SES deduct 1 at `FOUND`, restore on cancel, and zero the stock on out-of-stock reports. The ERP only
   removes the unit when the cashier closes the sale bill in FMP, and warroom sees it hours later. If SES shows
   ERP stock directly, `FOUND` will not be reflected, so two customers can be promised the last unit. **Owner accepted (D52):**
   *available = ERP ready − SES sessions that reached FOUND and are not billed in the ERP yet*. Open: how SES knows a session's unit
   has been billed (SES has no invoice number, D26; warroom sees bills only after its next sync) and the fate of D41's other rules (G-11).
5. **Who may edit.** With ERP as the source, the ADMIN stock-quantity edit (D41, `PUT …/stock`) and the cascade/active toggles need a
   decision: read-only, an override, or `active` only.
6. **Scope.** The warroom stock covers all branches the ERP knows (45 rows in `branch`), SES covers its own `Branch` rows.

## 3. Staff and branches from the ERP: not in warroom; a new OData job in SES

### 3.1 Staff: what the ERP table really contains (probed read-only on 2026-10-12)

Entity `staff` (`GET …/UFService/staff`, probably the same table as warroom's `SalesRept`/`HR`, which had 704 rows on 2026-09-08):
**713 rows, 367 fields.** Warroom only reads `staff_id` and `name_full_th` (`STAFF_FIELDS`, `odataSync.ts:140`).
Credentials were supplied by the owner in chat (the shared `dashboard` account); they are **not stored anywhere in this repo**. A probe
needs one request per table. Only aggregates are recorded here, no personal values.

**Sensitive content.** Each row holds national-ID number, birth date, salary, home address, bank, emergency contact, LINE user id and
**login credentials in plaintext**. The `dashboard` account can read all of it. SES must `$select` only the fields it needs and must
never log or store the rest.

**Field syntax (this corrects `ODATA_FINDINGS.md` §9.1).** Names with spaces work if double-quoted and URL-encoded with `%20`:
`$select=staff_id,%22user%20name%22,%22user%20password%22`. A `+` for the space gives 400 (`curl --data-urlencode` and most URL
builders produce `+`). Whole table with ~25 narrow fields: 515 KB, 0.3 s.

**Login fields (what could be used for a SES login).**

| Field | Findings (713 rows) |
| --- | --- |
| `user name` | 519 non-empty, **194 empty**, numeric only; equals `staff_id` in 513 rows; **5 duplicated values** |
| `user password` | 632 non-empty, 81 empty. **Plaintext, not hashed** (no hash-like value): 434 are 8 chars of letters+digits, 103 have 6, 87 have 4 (digits only for 195 rows). **39 values repeat across different people** |
| `authorize_p` | 470 non-empty; looks like a second 8-char code (purpose unknown) |
| `password` | 1 non-empty row (3 digits): unused |
| `staff_id` | integer, **not unique across rows** (713 rows) |

Which field the ERP login actually checks (`user password`? `authorize_p`?) is **unconfirmed**: ask the ERP Dev team.

**"Is this person still employed?" is inconsistent.** `status` has 12 spellings (`resign` 417, `active` 142, `Active` 81 with capital A, `closed` 28,
`n/a` 14, `fired` 11, empty 10, `lay_off`, `Lay-off`, `conEnd`, `retire`, `hold`); `status_group` is empty for 235 rows. 43 rows say
`status=resign` but `status_group=ปฏิบัติงานอยู่` with no resign date; 80 `Active` rows have no group. `status sw` is `on` for 704 rows
(useless). Lower-case `active` with no `date_resign`: 141 people, of which 130 have a `user name`, all but one a branch. Their
`branch_group`: HO 64, iStudio 53, U-Store 11, iMedic 9, Huawei Store 3, none 1.

**Role hints in the data** (no mapping decided): `position` (Sale Representative 184, Customer Support 38, Store Manager 36, Cashier 31,
Technician 19 …; 109 empty) and `level`; permission flags `permit_sale` (93 people on), `permit_stock` (11), `permit_stockList` (28),
`permit_pm` (85), `permit_product` (63), `permit_acc` (35), `permit_hr` (6). Home branch: `branch_id` + `branch_group`.

**Least privilege.** Ask the ERP Dev team for **its own read-only account for SES, limited to the few staff fields and the branch table**
(FileMaker privilege sets can restrict fields). Do not reuse warroom's `dashboard` account for SES. Because that account's password
was pasted into a chat on 2026-10-12, consider rotating it.

**Numbers for the D54 population** (`status` active ignoring case, `branch_id` in the 20 D53 branches; aggregates, 2026-10-12): **89 people**.
None has a resign date. `user name` present for 65, **empty for 24**; `user password` present for 88 and **all 88 are 8 characters or longer**
(so D39's minimum is not an issue here). No duplicate `user name` or `staff_id` inside this group, and none of these user names occurs on any
other ERP row. Where `user name` exists it equals `staff_id` (65 of 65). `authorize_p` equals `user password` in all 88 rows that have one, so it is
the same secret (`authorize_u`/`authorize_p` look like the ERP's approval login, not a different password). One person works in a closed branch
(`USMUPH`). The staff row's own `branch_group` disagrees with the branch table for a few people (2 rows, and 4 more people are labelled
iStudio/U-Store but have a `branch_id` outside the 20): use `branch_id` joined to the `branch` table as the authority.
Position text of the 89 (free text, several spellings): Sale(s) Representative about 54 (incl. contract variants), Store Manager 12,
Cashier 8, Sale Supervisor 3, In Store Stock 2, Technician 2, Housekeeper 2, no position 11, others 5.
The `permit_*` flags do **not** track the job: 27 of 89 have `permit_sale` and most Sale Representatives do not, so do not use them for roles
(`permit_stock`/`permit_stockList` are on for 3/8 people, mostly Store Managers and In Store Stock).

### 3.2 Branch master from the ERP (D53)

Entity `branch`: 45 rows, 69 fields, 0.05 s. `branch_group` counts: U-Store 12, HO 12, Huawei Store 9, iStudio 8, iMedic 4.
`branch_code` is unique and never empty (the same code warroom puts on stock rows, `StockBranch::branch_code`).
D53 scope = `iStudio` + `U-Store` = **20 branches**: 16 `active` and 4 `close` (`USCH`, `USMU`, `USMUPH`, `USSU`).

| ERP field | SES `Branch` | Note |
| --- | --- | --- |
| `branch_code` | `code` | upsert key (SES has no unique constraint on `code`, OQ-09; add one or look up before insert) |
| `branch_name` | `name` | e.g. `iStudio @ Fashion Island` |
| `branch_tel` | `phone` | `phone` is required in SES, the ERP value may be empty |
| `status` (`active`/`close`) | `active` | proposal; D39: a branch with active Staff cannot be deactivated |
| `branch_group` | — | filter only |

A new `Branch` automatically gets `BranchInventory` rows (stock 0, active) the next time the product list is read (`syncBranchInventory`, H-17).
This section is a **proposal** until G-11/G-12 are grilled.

### 3.3 The job

**Things that apply when writing the job** (all from `ODATA_FINDINGS.md`):
- Field names with spaces must be double-quoted and encoded with `%20` (see §3.1); case-sensitive string `$filter`; numeric fields without quotes in `$filter`.
- No `@odata.nextLink`: page yourself with `$top` / `$skip`. 704 rows with a narrow `$select` is one request.
- Timestamps end in `Z` but are already Bangkok time: strip the `Z`, never convert.
- A read is not a snapshot (duplicate keys seen in one response): upsert by key, ignore older `_ModificationTimestamp`.
- Empty is JSON `null`, not the string `"None"`.
- One request at a time, off the shop's peak. 10:00 is when the shops are opening, so keep the job tiny.

**Where to run it.** SES has no scheduler or worker today (`apps/api/package.json` has no schedule dependency). Warroom's pattern to copy:
a ticking loop plus a **DB claim of the time slot** (`claimSlot`: `INSERT … ON CONFLICT … WHERE slot differs`, `worker.ts:271-294`) so that two
containers or a restart do not run the same slot twice, and a catch-up window for a missed tick. Recommend the job lives in **SES**, not
in warroom: it is one small table, and putting ERP passwords into warroom's database would add a second place that holds them.

**It collides with SES account rules (D39, `accounts.service.ts`).** Decide in G-12 before coding:
1. *Passwords.* **Verified: the ERP stores them in plaintext** (`user password`), many of them short (4 to 6 characters) and 39 repeated across
   people. SES stores only scrypt hashes (`password.ts`) with an 8-character minimum (D39). Importing them means: hash at import in memory,
   never log or persist plaintext; and accounts with a password shorter than 8 would violate D39's rule on first login or must be forced to
   change. Pulling plaintext credentials through OData also widens the blast radius: ask the Dev team for a safer way (for example an
   ERP-side "verify this login" call, or a one-time temporary password per person).
2. *Source of truth.* A user changes a password in SES (forced change, D39), then the 10:00 job overwrites it. Either FMP owns passwords
   (disable change-password in SES) or SES owns them after first login (the sync must not touch a hash that was changed in SES).
3. *Roles and branch.* SES needs one home branch for any non-ADMIN role and a role set from `RoleCode`. Which FMP fields map to them?
   Unmapped people: skip or create with no role?
4. *Leavers.* A person removed or flagged inactive in FMP: deactivate in SES, which revokes all Login Sessions (D39). Never deactivate
   the last active ADMIN. Never let the sync grant ADMIN or MANAGER (D39: only an ADMIN does).
5. *Staff ID.* SES `Staff.staffId` is the primary key and also the actor on every `SessionEvent`; it must be the same as FMP `staff_id`
   so history stays attributable. Existing SES staff (e.g. bootstrap `0001`) that are not in FMP must be left alone.
6. *Audit.* Add a trail for sync changes (SES's audit feed only reads `SessionEvent`, `LoginSession`, `stockReview`).
7. *Failure.* If the ERP is down at 10:00: keep the last good data, retry with a limit, tell an admin (warroom mails admins on failure,
   `src/lib/alert.ts`). Staff must still be able to log in.

### 3.4 Design (D53/D54 decided; role table to be given by the owner later; the rest is the agreed proposal)

**Pull.** Branch: `GET /branch?$select=branch_id,branch_code,branch_name,branch_tel,branch_group,status` (45 rows, ~0.05 s), keep `iStudio`/`U-Store`.
Staff: one request, `$select` of only `staff_id`, `"user name"`, `"user password"`, `status`, `branch_id`, `position`, `name_first_th`, `name_last_th`,
`_ModificationTimestamp` (never the personal/payroll fields). Run branch first, then staff. Credentials from env only:
`ERP_ODATA_BASE_URL`, `ERP_ODATA_USER`, `ERP_ODATA_PASS` (Coolify), plus `ERP_SYNC_TIMES=10:00`. Temporarily the shared `dashboard` account, later a dedicated one.

**Staff mapping.**

| SES `Staff` | From the ERP |
| --- | --- |
| `staffId` | `String(staff_id)` (D54: the ERP `user name` equals it where present, 65 of 65, so both work as the login; the 24 without `user name` use `staff_id`). A row whose `user name` differs from `staff_id` is reported. No `user password` (1 person today) means no account, reported |
| `firstName` / `lastName` | `name_first_th` / `name_last_th` |
| `branchId` | `branch_id` → ERP `branch.branch_code` → SES `Branch.code`; staff of a closed branch get no account |
| `active` | `status` active (ignore case) AND the branch is active |
| `passwordHash` | scrypt of `user password`, recomputed only when the stored hash no longer verifies (≈ 90 hashes, a few seconds; compute **before** taking the `AccountLock`, see H-02) |
| `mustChangePassword` | `false`: the ERP owns the password, so SES change/reset-password is refused for synced accounts with a Thai message |
| roles | sync-managed set = STAFF, STOCK, CASHIER; from `position` (normalised, contains): `sale` → STAFF, `cashier` → CASHIER, `in store stock` → STOCK; other positions (technician, housekeeper, …) get an account with no role. `ADMIN`/`MANAGER` are never granted or removed by the sync (proposal; "Store Manager" is 12 of the 89 and would then be MANAGER by hand in SES, or the owner overrides D39 for that one position) |

**Never touched:** any account the sync did not create (existing/test users, `0001`). Track it with an additive column (for example
`Staff.erpStaffId Int? @unique` plus `erpSyncedAt`); an ERP `user name` equal to an existing SES `staffId` is skipped and reported, never adopted.
**Leavers:** a synced account that is no longer in the active set gets `active=false` and all its Login Sessions are revoked (D39), except the last active ADMIN.
**Branches:** upsert by `code` (adopt a same-code SES branch, add `Branch.erpBranchId Int? @unique`); copy `name`, `phone`, `active`. A closed branch is deactivated
only after its synced staff were deactivated in the same run (D39 order).

**Built as follows (differences from the first proposal).** No `$filter` (see §0); manual runs return at once and the panel polls `status` (an awaited run would hit
the 60 s proxy timeout of the web container); a closed ERP branch that SES never had is not created; an ERP-linked branch is read-only in SES (409 on `PUT /branches/:id`);
a mass-deactivation guard aborts a run that would deactivate more than max(5, 30%) of the synced accounts unless `force=true`; positions that map to no role get **no account**
(an account without a role could still read the branch's session list, H-06); "Store Manager" maps to STAFF until the owner sends the table.

**Job.** A tick every 30 s in the API process (no scheduler dependency today), a DB row per `(kind, slot)` claimed with `INSERT … ON CONFLICT`
(the warroom `claimSlot` pattern) so two containers or a restart run a slot once, a 60-minute catch-up window, and a new table `ErpSyncRun`
(slot, started/finished, ok, counts, error). ADMIN-only `POST /api/admin/erp-sync/run` and `GET …/status`. If the ERP is down the run is recorded as failed,
no data is changed, logins keep working with the last data; SES has no e-mail sender, so the failure shows in the admin page and the audit feed.
**Tests first:** a fake OData server (Node `http`) and the existing real-MySQL test style: plan/apply, untouched existing user, leaver, closed branch, ERP down, double slot.

## 4. What I did not verify
- Whether the warroom host is reachable from SES's Coolify network, and why the proxy returns 403.
- Which ERP field the FileMaker login actually checks, and how `status`/`status_group` should define "employed" (§3.1).
- That `staff` is the same table as `SalesRept`/`HR`; whether the ERP account rights stay the same for a dedicated SES account.
- The `/api/freshness` payload and `mart.data_version` columns (only seen in docs / code).
- That `sql/73_stock_partner_header_status.sql` is what is deployed (the repo has 73 sql files; prod may be behind).
