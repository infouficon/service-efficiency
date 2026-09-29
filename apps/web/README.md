# Web: real accounts, mock workflow

Run API first (`npm run dev:api` from root), then `npm run dev`. Vite proxies `/api` to port 3001. Login requires an actual MySQL account; no fake passwords/persona switcher. New/reset accounts must change their temporary password. ADMIN/Manager management screens use real API data and enforce permissions server-side

Staff/Stock/Cashier workspaces remain explicitly marked mock. Product fixtures and confirmed option lists stay local; no workflow data is sent to MySQL. Refresh/logout resets mock work. There is no cross-device workflow synchronization yet. Workspace access follows assigned operational roles; ADMIN global scope is not treated as an implicit role grant

Walk-in → DEMO → BUY/NOT_BUY → product selection/review → confirmation → Stock → Cashier → separate COMPLETED action. Phone is collected only after BUY and must be exactly ten ASCII digits before product selection. Accessory quantity starts at 1, is a positive integer, appears inline and clears when deselected. None never becomes a selected transaction line

## Still unresolved

OQ-01/02: ADMIN workflow conflicts and cancellation substate boundaries. OQ-04/05/06: workflow storage/action boundaries and ownership/concurrency. OQ-07: product hierarchy/history. OQ-08: numbering. OQ-09: remaining field constraints, including Branch Code uniqueness (real Branch relations use a technical ID). Remaining MFA/reset-delivery matters in OQ-10. No new workflow policy is introduced by this phase

Workflow timestamps are browser display values only; production workflow APIs must supply server time. Account authentication and idle expiry already use server time. Local preview abstractions do not approve a database workflow design

Checks: `npm run lint`, `npm run build:web`, `npm run test --workspace=@service-efficiency/web` from root. Full setup and integration tests: [root README](../../README.md)
