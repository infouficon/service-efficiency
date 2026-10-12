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
2. A tick (60 s) peeks at `max(snapshot_at)`; a run is claimed per snapshot (`ErpSyncRun`, kind `warroom-products`, slot
   `snap-<ISO time>`), so containers and restarts process a snapshot once; a failed one is retried after 10 and 20 minutes.
3. Per SES `Branch` (matched by `Branch.code` = ERP `branch_code`, D53) and SKU (`ProductSku.sku` = Apple part number, D52) it stores
   `BranchInventory.erpReady`, `erpTransfer`, `erpAsOf`. Rows that had ERP data and are missing from the new snapshot become 0.
4. What staff see = `availableUnits()` = `erpReady` − sessions that reached FOUND in the last 24 h without an outcome and were not
   COMPLETED before `erpAsOf` (the ERP still counts their unit) → never below 0; and 0 when a D41 "missing / out of stock" report
   (`outOfStockAt`) is newer than `erpAsOf`. A newer snapshot ends the override. Rows without ERP data keep the manual `stock` (D41).

`erpAsOf` is `max(snapshot_at)` of `stock_mv`: the last time a stock row changed in warroom (unchanged rows are dropped as duplicates),
so it can be somewhat older than the real pull; that errs on the safe side (see H-32).

## Modes (`WARROOM_STOCK_MODE`, default `shadow`; nothing runs without `WARROOM_DATABASE_URL`)

| Mode | Stores ERP numbers | Creates/updates catalog | Staff screen | Manual stock edit |
| --- | --- | --- | --- | --- |
| `off` | no | no | manual stock | allowed |
| `shadow` | yes, for SKUs SES already has | **no** (dry run shows `wouldCreate`) | manual stock (unchanged) | allowed |
| `on` | yes | yes (Product → Model → SKU, `erpManaged`) | ERP availability | refused (409) for rows with ERP data |

Admin → "ซิงก์ ERP" shows both syncs (staff/branch and products/stock): status, dry run, run now, last runs and, after a dry run, the
**unmapped category list** (the thing to read first).

## Catalog rules (provisional; first dry run decides)

- Category from the ERP `product_cat` (fallback to `product_subcat` only if `product_cat` is empty): accessory words win
  ("iPhone Case" → Accessories), then iphone / ipad / watch / mac. **Anything else is not guessed**: skipped and listed.
- Product = `product_subcat`, Model = `product_subsubcat` or the same name, SKU name = ERP product name without the "Apple <part>"
  prefix, colour and storage from warroom's parsed `color` / `capacity`. Only parts that some SES branch stocks are created.
- Existing hand-made products/models are reused by (category, name) and never renamed; SKUs are matched by part number; only
  `erpManaged` rows are updated; the sync never touches `active`. Nothing is ever deleted.
- In mode `on`, `erpManaged` product/model/SKU names, codes, colours, storage and category are read-only in the admin UI and API
  (409); `active` can still be switched.

## Safety

- Refuses to run (unless `force`) when: the snapshot is empty; it is **older** than the newest stored `erpAsOf`; or fewer than half
  of the SKUs that had stock before are in it.
- Connection errors never carry the URL (`safeMessage`); the URL lives only in the Coolify env.
- `npi_reader` can read the whole `mart` schema (sales, bills). Prefer a dedicated role limited to `mart.stock_mv`
  (`CREATE ROLE ses_reader LOGIN …; GRANT USAGE ON SCHEMA mart …; GRANT SELECT ON mart.stock_mv …`) and remember warroom re-creates
  `stock_mv` with `DROP … CASCADE` (its SQL re-grants only to `npi_reader`/`npi_writer`).

## Switching on, step by step

1. Coolify env of the SES `api` app: `WARROOM_DATABASE_URL` (the SES container must reach the warroom DB host; test with
   `nc -zv <host> 5432` in its terminal), keep `WARROOM_STOCK_MODE` unset (= `shadow`). Restart.
2. Admin → ซิงก์ ERP → "สินค้าและสต็อกจาก warroom" → **ทดลองรัน**. Read: parts, branches matched / unknown, the categories table and the
   **unmapped** list (extend `mapCategory` if real categories are missing), `wouldCreate`.
3. Let it run in `shadow` for a day: compare `ready`/`available` in Admin → Products with the ERP.
4. `WARROOM_STOCK_MODE=on`, restart, dry run again, then "ซิงก์ตอนนี้".

## Troubleshooting a failed run (the error is in the run history)

- `getaddrinfo ENOTFOUND <host>`: the SES container is not on the same Docker network as the warroom database (Coolify destination / network settings), or the host name is wrong.
- `no pg_hba.conf entry … no encryption`: the server wants TLS; append `?sslmode=no-verify` to the URL.
- `password authentication failed`: wrong role or password in the URL (special characters must be percent-encoded, `@` = `%40`).
- `permission denied for … mart.stock_mv` or `relation does not exist`: the role cannot see the table (warroom re-creating `stock_mv` drops grants not listed in its SQL).
- `ยกเลิกเพื่อความปลอดภัย…`: one of the guards above; check warroom, then re-run with `force` only if the snapshot is right.

## Known gaps → hazards.md H-32.
