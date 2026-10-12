# Grilling backlog: what to run `/grill-with-docs` on, in priority order

Each topic below is a decision that code cannot make by itself. Run them **one at a time**
(`/grill-with-docs <topic>`), because several answers feed the next topic. The grilling rules
are in `~/.claude/skills/grilling/SKILL.md`: one sharp question at a time, a recommended default
each time, and no coding until the spec has no TBD.

**What a finished session must leave behind**
1. A new `D##` in [docs/decisions.md](../decisions.md) (next free number: **D52**).
2. Updated terms and entities in [CONTEXT.md](../../CONTEXT.md).
3. An ADR in `docs/adr/` if the choice is architectural or hard to reverse.
4. The matching `OQ-xx` removed from `docs/open-questions.md` and the matching `H-##` in [hazards.md](hazards.md) re-labelled "decided, not yet implemented".

Ask the **user (the business owner)** about business rules. Technical options (locks, schema shape)
are for the agent to recommend, and the user to approve.

---

## G-1 Cancellation rules (OQ-02, H-13). Start here
Why first: it is a small, self-contained rule, and it is where code and the confirmed matrix differ today.
- In which exact states may a session be cancelled (WALK_IN? DECISION? CONFIRMATION/STOCK_REQUESTED? SENT_TO_CASHIER? BILL_OPENED?)?
- Who may cancel at each state? The confirmed rule says STAFF can in DEMO/PRODUCT_SELECTION/Stock/Cashier. Code requires the STOCK/CASHIER role in those stages. Which one wins? (Recommended default: follow the confirmed rule, "STAFF can cancel in all four stages; STOCK/CASHIER also in their own stage; MANAGER+STAFF inherits.")
- Does ADMIN cancel (OQ-01, D1 vs D4)? With which reason and which audit trail?
- After the last state where cancel is allowed, what does the user see?

## G-2 Duplicate and concurrent actions: response contract (OQ-06, H-01)
- When a second identical action arrives (double-click, retry, two devices), should the API return 409 with the current state, or an idempotent 200? Does the UI show an error or just refresh?
- Which actions need an idempotency key (the money-relevant ones: `found` stock deduction)?
- Technical recommendation to be approved: conditional `updateMany` on `state` inside the transaction.

## G-3 Work ownership, handoff and DEMO workload (OQ-06, H-04, H-18)
- Who owns a session at each stage (creator only? any STAFF in the branch)? Can a MANAGER reassign it?
- "STAFF sees only their current work": which sessions exactly (created by me and not finished? DEMO assigned to me?)?
- One active DEMO per Staff (D5): does a Staff member with a session in PRODUCT_SELECTION count as busy? What does the UI show when the rule blocks `startDemo`?
- What happens to a session when its Staff is deactivated mid-flow?

## G-4 Stock quantity semantics (D41, H-07, H-09, H-10)
- Can stock go negative (a sale of a unit the system believed was 0)? Or must `found` fail at 0?
- Out-of-stock and missing-item reports set stock to 0 (D41). Who restores it, and is that an ADMIN-only absolute edit? Is an audit trail of every quantity change required (who/when/why)?
- Cancel after FOUND adds +1 (D41). What if stock was reset to 0 in between: still +1?
- Should the selection API reject a SKU that is inactive or has stock 0 in the branch? (The UI does today.)
- Merge the two partial-fulfilment paths (STOCK `out-of-stock partial` and D40 report-missing then resolve)? Which one survives?

## G-5 Session reference numbering (OQ-08, H-05)
- Business timezone for `YYYYMMDD` (recommended: Asia/Bangkok).
- Is the running number global or per Branch? What happens after 999999 (practically never)?
- Must references be gapless? (A counter table makes gaps possible after a rolled-back transaction.)

## G-6 History visibility and API scoping (D3, D47, H-06)
- Make the server enforce "STAFF sees only current work" and "Stock/Cashier queues are today only"? What counts as "today" (Bangkok midnight)?
- What does the Logs view need from the server (filters, paging, max range, export size)?
- Is the audit log (`/admin/audit-logs`) ADMIN-only forever, or should a MANAGER see their branch?

## G-7 Master data hierarchy and history integrity (OQ-07, OQ-09, H-12)
- `product_SubCategory` / `product_SubSubCategory` from D13: do they exist? The code has only Category → Product → Model → SKU.
- A confirmed purchase must keep its historical meaning when a product is renamed or deactivated: snapshot the names on the session, or rely on FKs with `Restrict`?
- Branch Code uniqueness, accessory quantity maximum, duplicates in option lists.
- Split `reason`/`otherReason` into separate columns for NOT_BUY, cancellation and out-of-stock, or keep the shared pair and document it?

## G-8 Reports, KPIs and export (OQ-11)
- Which efficiency numbers does the business want first (for example walk-in → demo wait, demo → decision, confirm → found, found → bill)?
- Who sees which scope (MANAGER own branch, ADMIN all)? Daily/weekly? Targets or SLA thresholds?
- Export: server-side CSV/Excel with fixed columns, or keep the client-side CSV? (The current CSV looks up event names that don't exist in the enum; see hazards.md.)

## G-9 Security hardening (H-02, H-03)
- Agree on the CSRF/Origin guard scope (all mutating routes) and whether the 401/403 behaviour changes.
- Authentication without the global mutex: is a once-per-minute `lastSeenAt` update acceptable for the 8-hour idle rule?
- Any need for MFA or password reset outside the admin-entered temporary password (OQ-10)?

## G-10 Delivery process (H-15, H-16)
- Introduce CI (lint + build + test + `prisma validate`) and branch protection on `main`?
- A staging environment, or at least a pre-deploy migration step?
- Where does real MySQL for CI come from (service container)?

## G-11 ERP stock in SES (read [erp-integration.md](erp-integration.md) §2 first). Supersedes the stock-source part of G-4
**Status:** the warroom endpoint exists as draft PR #1 in `taspotae-lab/dashboard-npi-warroom` (`docs/SES_API.md` there is the contract); SES has no client yet. Owner said "write the endpoint yourself" (2026-10-12).
Already decided by the owner on 2026-10-12 (D52): stock comes from warroom, SES follows warroom's product keys, first-version availability = ERP ready − SES sessions at FOUND not yet billed in the ERP.
Still to grill:
- Which warroom column is the key (`product_upc` or the Apple part number) and how `ProductSku.sku` gets loaded from `mart.sku_catalog` (and what to do with the demo-seeded SKUs).
- How does SES know that a FOUND session's unit has been billed in the ERP (no invoice number in SES, D26; warroom sees bills at the next sync)? Time limit for a reservation?
- D41's remaining rules: manual ADMIN quantity edit, zero-on-missing-item, +1 on cancel: keep, replace or become overrides?
- Accepted staleness: warroom syncs 12:15/15:15/18:15/21:15/23:45, so shops open on last night's numbers. Keep, or ask the warroom owner (โปเต้) for a morning slot?
- Delivery: warroom needs a machine-to-machine endpoint (API key) or a read-only DB view, and its owner must agree. Who builds it, and which network path does SES use?

## G-12 Staff login from the ERP `staff` table via OData, daily 10:00 + Branch master (D53). [erp-integration.md](erp-integration.md) §3
Facts now verified (aggregates, 2026-10-12): `user password` is **plaintext** in the ERP (all 8 characters or longer for the D54 group of 89 people); `user name` is empty for 194 of 713 rows and has duplicates; `staff_id` is not unique; "active" is inconsistent across `status` (12 spellings) and `status_group`.
Answered 2026-10-12 (recorded as D54): the ERP is the source of staff; employed = `status` active; only D53 branches; passwords used as they are ("no encryption needed"); existing SES accounts kept for testing.
**Status 2026-10-12 evening: built on branch `feat/erp-sync` (not merged, not deployed, not verified against the live ERP, see erp-integration.md §0). Waiting for the owner's role table, a healthy ERP for a first dry run, and the Coolify env.**
Settled 2026-10-12 (D54): scrypt hash at import; login id = `staff_id` (also the ERP `user name`, which equals it); the ERP owns the password (SES change/reset refused for synced accounts); roles from `position` for now (owner will correct the table later), ADMIN/MANAGER never touched.
Agreed proposal, not yet challenged: leavers and closed branches (deactivate only accounts the sync created, revoke sessions, spare the last ADMIN; staff of a closed branch get no account); the 10:00 Bangkok job with a DB slot claim, an ADMIN "run now" and a run log; the shared `dashboard` account in Coolify env for now, a dedicated read-only account later.
8. Branch sync (D53): fields copied, frequency (same 10:00 job), unique `Branch.code`.

---

### Suggested order and dependencies
`G-1` → `G-2` → `G-3` (each unlocks tests for the next) → `G-4` → `G-5` → `G-6` → `G-7` → `G-8`.
`G-11` and `G-12` are the current priority and are independent of each other. Start with G-12 questions 1 to 3 (plaintext passwords, who counts as employed, which people get accounts): they can change the whole design. G-11 also settles the stock part of G-4.
`G-9` and `G-10` are technical and can run in parallel with any of them.
Before implementing any of them, add real integration tests for the current behaviour (H-15).
