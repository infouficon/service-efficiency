# Products and stock from the warroom database (D52, D55)

How SES gets its real products and stock numbers. Background and measured facts about the ERP and warroom:
[erp-integration.md](erp-integration.md). Code: `apps/api/src/warroom/`, `apps/api/src/products/products.service.ts`
(`availableUnits`, `loadReservations`), tests `apps/api/tests/warroom-sync.test.mjs`.

## What it does

```text
ERP (FileMaker) ──5×/day──▶ warroom Postgres: mart.stock_mv ──read-only SELECT──▶ SES API ──▶ MySQL (BranchInventory, catalog)
   12:15 15:15 18:15 21:15 23:45 Bangkok, full pull ≈16 min          every WARROOM_SYNC_MINUTES (10): peek, run only on a newer snapshot
```

1. The SES API (not a person's machine) connects with `WARROOM_DATABASE_URL`, a **read-only** Postgres role, runs `BEGIN READ ONLY`,
   a 20 s statement timeout, and ONE aggregate `SELECT` on `mart.stock_mv` grouped by (branch_code, part number, upc).
2. A tick (60 s) peeks at `max(snapshot_at)` plus a size fingerprint (row count and total qty, so sales that do not move the max
   are noticed too); a run is claimed per (snapshot time, fingerprint) (`ErpSyncRun`, kind `warroom-products`, slot
   `snap-<ISO>-<fp>`), so containers and restarts process it once; a failed one is retried every 10 minutes up to 12 times. A run
   that is still open (here or in another container) blocks a second one; a run is cut off after 10 minutes.
3. Per SES `Branch` (matched by `Branch.code` = ERP `branch_code`, D53) and SKU (`ProductSku.sku` = Apple part number, compared
   case-insensitively, D52) it stores `BranchInventory.erpReady`, `erpTransfer`, `erpAsOf`, in ONE transaction. Every branch that is in
   the snapshot gets a row (0 if need be) for every part SES has or is creating in this run, so a hand-made SKU never keeps its manual stock where
   warroom says none. Rows of those branches for parts that left the snapshot become 0. A branch warroom did not report at all keeps
   its last numbers.
4. What staff see = `availableUnits()` = `erpReady` − sessions that reached FOUND in the 24 h before the OLDEST snapshot in play (or
   now) without an outcome and were not COMPLETED before `erpAsOf` (the ERP still counts their unit) → never below 0; and 0 when a D41
   "missing / out of stock" report (`outOfStockAt`) is newer than `erpAsOf` **and younger than 6 hours** (a mistaken tap must not black
   a SKU out until warroom changes; a newer snapshot ends it too). Rows without ERP data keep the manual `stock` (D41).

`erpAsOf` is `max(snapshot_at)` of `stock_mv`: the last time a stock row changed in warroom (unchanged rows are dropped as duplicates),
so it can be somewhat older than the real pull; that errs on the safe side (see H-32).

## Modes (`WARROOM_STOCK_MODE`, default `shadow`; nothing runs without `WARROOM_DATABASE_URL`)

| Mode | Stores ERP numbers | Creates/updates catalog | Staff screen | Manual stock edit |
| --- | --- | --- | --- | --- |
| `off` | no | no | manual stock | allowed |
| `shadow` | yes, for SKUs SES already has | **no products** (dry run shows `wouldCreate`); new warroom categories are added to the SES list, switched off (D72) | manual stock (unchanged) | allowed |
| `on` | yes | yes, **only for active categories** (Product → Model → SKU, `erpManaged`, with the UPC) | ERP availability | refused (409) for rows with ERP data |

Admin → "ซิงก์ ERP" shows both syncs (staff/branch and products/stock): status, dry run, run now, last runs and, after a dry run, the
**unmapped category list** (the thing to read first).

## Categories (D72)

A category is a row of `Category` (Admin → หมวดหมู่สินค้า). The migration seeds iPhone, iPad, Mac, Watch, Accessories (active). The sync maps each warroom `product_cat` like this:

- Apple words → the five categories ("Apple Accy" → Accessories; accessory words win over device words: "iPhone Case" is an accessory).
- Anything else, and any other brand ("HUAWEI Phone", "Third Party Accy"), → a category **named exactly as warroom spells it**, added **switched off** (`erpManaged`, `isAccessory` guessed from "accy"/"accessor").
- A part whose category is off is **not created** (`waitingForCategory` in the run summary) and staff see nothing of it. Open the category, then "ซิงก์ตอนนี้": its products are created on that run. A part with no category text at all is skipped (`skippedNoCategory`).
- Batteries (a sub-category starting with "Battery") go to a `Battery` category, added switched off like any new category (D78).
- The memory ("Ram 16") is read into `ProductSku.memory` and, with a trailing "Eng" marker, removed from the model name; names that differ only in case are one model (D79).
- The capacity is taken out of the product and model names ("iPhone 18 Pro Max 1TB" → "iPhone 18 Pro Max") so one model holds all its capacities (D78).
- Only the SKU **part number** (`product_model`) identifies a part; `product_upc` is stored in `ProductSku.upc`.

## Catalog rules

- Category from the ERP `product_cat` (fallback to `product_subcat` only if `product_cat` is empty), see *Categories* above.
- Product = `product_subcat`, Model = `product_subsubcat` or the same name, SKU name = ERP product name without the "Apple <part>"
  prefix, colour and storage from warroom's parsed `color` / `capacity`. Only parts that some SES branch stocks are created.
- Existing hand-made products/models are reused by (category, name) and never renamed; SKUs are matched by part number; only
  `erpManaged` rows are updated; the sync never touches `active`. The sync never deletes anything (only the ADMIN clear action does, D73).
- In mode `on`, `erpManaged` product/model/SKU names, codes, colours, storage and category are read-only in the admin UI and API
  (409); `active` can still be switched.

## Safety

- Refuses to run (unless `force`) when: the snapshot is empty (even with force); its time is more than 5 minutes **in the future**
  (clock / time-zone); it is more than 24 h **older** than the newest stored `erpAsOf` (a restore); fewer than half of the SKUs that
  had stock are in it; fewer than half of the branches that had stock are in it (renamed `branch_code`?); or the total ready units fell
  by more than half. Warroom's `snapshot_at` is cast to `timestamptz` in the query.
- Connection errors never carry the URL (`safeMessage`); the URL lives only in the Coolify env.
- `npi_reader` can read the whole `mart` schema (sales, bills). Prefer a dedicated role limited to `mart.stock_mv`
  (`CREATE ROLE ses_reader LOGIN …; GRANT USAGE ON SCHEMA mart …; GRANT SELECT ON mart.stock_mv …`) and remember warroom re-creates
  `stock_mv` with `DROP … CASCADE` (its SQL re-grants only to `npi_reader`/`npi_writer`).

## Re-filing

A change of the catalog rules re-runs the sync by itself: `CATALOG_RULES_VERSION` is part of the run slot (D81), so after the deploy the next scheduled check (default every 10 min) processes the current snapshot again. Raise it whenever the rules change.

When the rules change (D78), the next `on` run moves ERP-made SKUs to the product / model / category the rules give today (`moved` in the summary, counted by a dry run) and removes the ERP-made models and products left empty. Hand-made records are never moved.

## Starting from a clean slate (D73)

Before the first real catalog, ADMIN can clear the old (test) catalog and queue history: Admin → ซิงก์ ERP → "ล้างสินค้าและประวัติคิวเดิม" → "นับสิ่งที่จะถูกลบ" (counts only) → type `ล้างข้อมูล` → "ลบถาวร". It removes every queue session, the customers, the queue counters and every product / model / SKU with branch stock; staff, branches, categories, payment methods, customer types and settings stay. Irreversible: back up the database first. A second button deletes only what is **not** from the ERP (hand-made SKUs, the hand-made products left empty, and the queues that used them; D78). The old demo catalog no longer re-creates itself.

## Switching on, step by step

1. Coolify env of the SES `api` app: `WARROOM_DATABASE_URL` (the SES container must reach the warroom DB host; test with
   `nc -zv <host> 5432` in its terminal), keep `WARROOM_STOCK_MODE` unset (= `shadow`). Restart.
2. Admin → ซิงก์ ERP → "สินค้าและสต็อกจาก warroom" → **ทดลองรัน**. Read: parts, branches matched / unknown, the categories table and the
   **unmapped** list (extend `mapCategory` if real categories are missing), `wouldCreate`.
3. Let it run in `shadow` for a day: compare `ready`/`available` in Admin → Products with the ERP.
4. (Optional, once) clear the old catalog and queue history (above). Check Admin → หมวดหมู่สินค้า: the Apple categories are on, every other warroom category is off. `WARROOM_STOCK_MODE=on`, restart, dry run again (`wouldCreate` = the Apple parts SES branches stock), then "ซิงก์ตอนนี้". To bring another category in later (HUAWEI …), open it in หมวดหมู่สินค้า and sync again.
5. **Turn the "Stock ไม่จำกัด" switch off** (Admin → ซิงก์ ERP, top panel; D59). It is **on by default** and while it is on SES ignores every stock number when staff pick a product (and FOUND takes nothing from the shelf), so the ERP numbers only start to matter after this step.

## Troubleshooting a failed run (the error is in the run history)

- `getaddrinfo ENOTFOUND <host>`: the SES container is not on the same Docker network as the warroom database (Coolify destination / network settings), or the host name is wrong.
- `no pg_hba.conf entry … no encryption`: the server wants TLS; append `?sslmode=no-verify` to the URL.
- `password authentication failed`: wrong role or password in the URL (special characters must be percent-encoded, `@` = `%40`).
- `permission denied for … mart.stock_mv` or `relation does not exist`: the role cannot see the table (warroom re-creating `stock_mv` drops grants not listed in its SQL).
- `ยกเลิกเพื่อความปลอดภัย…`: one of the guards above; check warroom, then re-run with `force` only if the snapshot is right.

## Known gaps → hazards.md H-32.
