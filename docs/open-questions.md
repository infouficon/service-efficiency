# Open questions — Phase 1

Only unresolved matters affecting future implementation are listed here. Sources: [requirements](requirements.md), [confirmed answers](decisions.md), and the current Phase 1 request. Resolved answers from decisions.md have been incorporated into the design documents; they are not asked again. Conflicting statements remain OPEN.

## OQ-01 — ADMIN session actions

D1 grants ADMIN cancel and pre-confirmation edit actions, but D4 says ADMIN Session view/cancel/edit needs separate confirmation. Which statement controls cancellation and editing? View is explicit in D1–3; generic Session deletion and other unnamed CRUD remain unspecified. Do not infer deletion or immutable-data overrides from “manage Customer Session.”

## OQ-02 — Cancellation substate/action boundaries

STAFF cancellation permission in DEMO, PRODUCT_SELECTION, STOCK and CASHIER is explicitly confirmed by requirements §25 and the Phase 1 correction; it is not an open question and does not require an additional workflow role. Only the following finer-grained state/action boundaries remain unresolved.

Which exact substates in Stock and Cashier permit cancellation? Does eligibility include CONFIRMATION, STOCK_REQUESTED, SENT_TO_CASHIER or BILL_OPENED before COMPLETED? No cancellation is allowed after a terminal outcome. Confirmation UI, reasons, optional/required notes, return to queue and no undo are already resolved in D18–20.

## OQ-04 — Physical state and outcome representation

The flow closes NOT_BUY/OUT_OF_STOCK Sessions, while D7 names those outcomes as terminal states. Should storage use CLOSED plus a terminal outcome or outcome-specific terminal states? Both must retain exact NOT_BUY/OUT_OF_STOCK meaning and immediate finality. BUY/NOT_BUY naming is resolved by D11; NOT_PURCHASE must not be introduced.

## OQ-05 — Action boundaries and missing grants

- Who may record the customer decision and begin/end DEMO beyond the explicitly confirmed STAFF grant?
- Are BUY recording and Product Selection start separate actions? Which moment generates each approved event/timestamp?
- Is CONFIRMATION a persisted review state or a UI step? What pre-confirmation return-to-edit behavior is permitted?
- Are accepted confirmation and Stock request separate actions? If separate, who dispatches and how is the confirmed-but-not-yet-requested situation represented without inventing a state?
- What are the concrete actions/fields for System Configuration management beyond D4's broad grant? Role assignment is resolved by D39.

## OQ-06 — Work ownership and concurrency contract

How is current work assigned to Staff at walk-in and subsequent stages? What handoff/reassignment, if any, is allowed? Clarify STAFF's “own current work” visibility predicate and the effect of workflow handoff. What response/retry contract applies to duplicate or simultaneous actions? Single active DEMO per Staff, multiple active Sessions per Customer and no auto-timeout are already confirmed.

## OQ-07 — Product hierarchy and historical integrity

D13 confirms `product_Category`, `product_SubCategory`, `product_SubSubCategory`, `product_name` and selection down to Product/Model/SKU, but not their exact hierarchy/cardinalities. Confirm keys, relationships and required selection fields before physical FKs are designed.

ADMIN Product/Model/SKU CRUD is confirmed. What happens to referenced records on edit/delete, and how must already-confirmed purchases retain their historical product meaning? Do not infer cascades, snapshots or versioning as business requirements. Approved mock records await the user's master-data file (D14). Future external integration remains unspecified and outside version one.

## OQ-08 — Session reference details

For confirmed `SES-YYYYMMDD-NNNNNN` daily numbering, what business timezone defines YYYYMMDD, is the sequence global or per Branch, and what happens after 999999 in a day? No numbering rule is inferred from the developer machine timezone.

## OQ-09 — Remaining field constraints

Confirm Customer Phone Number uniqueness, Branch Code uniqueness scope, accessory quantity maximum (if any) and duplicate-selection behavior. Confirm how `None` combined with real options is handled at input (no-selection persistence itself is confirmed). Final field lengths, nullability and referential actions remain subject to ERD approval; do not add extra business fields.

## OQ-10 — Authentication lifecycle

D39 resolves idle timeout, multiple devices, current-device logout, per-account lockout, temporary-password change, reset session invalidation and initial ADMIN. MFA, password-reset delivery outside the administrator-entered temporary-password flow and future additional authentication policies remain unspecified. No MFA, external reset delivery or absolute lifetime is introduced in this phase.

## OQ-11 — Dashboard, reports and exports

Confirm KPI/Efficiency formulas, targets, SLA thresholds, Dashboard metrics, Date/Branch/Staff/Role filter behavior and default ranges, report grouping/aggregation, and Excel/CSV columns/filters/report definitions. Preserve raw timestamps; no duration formula or KPI metric is approved by examples in D32.

## OQ-12 — Deployment

Provide Coolify web/API domains, reverse-proxy configuration, MySQL instance/version, production database settings, CORS origins and environment variables (D38). These remain deployment-phase decisions.
