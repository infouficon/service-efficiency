# Phase 1 — Permissions

Sources: requirements §§7–9, 25, 27, 32; decisions D1–4, D12, D21, D28; current Phase 1 request.

## Evaluation dimensions

- **Authentication:** trusted Staff identity from cookie/session authentication, never request-body Staff ID. Password minimum 8; reset by ADMIN. D39 confirms eight-hour idle sessions, multi-device access, current-device logout, forced temporary-password change and per-account lockout. MFA remains OPEN.
- **Role:** assigned roles are combined by union (D1). A denial in a single-role column means that role does not grant the action; it is not a veto over a grant from another assigned role.
- **Branch scope:** ADMIN is global; MANAGER is restricted to their Branch; STOCK and CASHIER see Sessions only in their own Branch (D2). Staff belongs to exactly one Branch. D39: ADMIN-only has no Branch; accounts with other roles have one home Branch.
- **Action permission:** a grant below permits only the named action subject to state/data guards. It is not generic CRUD permission.
- **Data visibility:** STAFF sees only their current work, not historical Sessions; MANAGER sees own-Branch history; ADMIN sees all-Branch history. STOCK/CASHIER see own-Branch work within their workflow, not history (D1–3). Exact current-work ownership/handoff predicates remain OPEN.

Legend: **YES** = explicitly granted, **NO** = explicitly not granted to this role, **+STAFF** = requires a separately assigned STAFF role, **OPEN** = insufficient or contradictory sources. All grants retain scope and immutable-data restrictions.

## Action matrix

| Action                           | ADMIN                                    | MANAGER                                                                   | STAFF                                        | STOCK               | CASHIER               |
| -------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------- | ------------------- | --------------------- |
| Create Customer Session          | YES                                      | +STAFF                                                                    | YES                                          | NO                  | NO                    |
| View current Session             | YES                                      | YES                                                                       | YES: own current work                        | YES: Stock workflow | YES: Cashier workflow |
| View historical Session          | YES                                      | YES: own Branch                                                           | NO                                           | NO                  | NO                    |
| Cancel Session                   | OPEN: D1 vs D4                           | No grant from MANAGER alone; union of assigned STAFF/STOCK/CASHIER grants | YES: DEMO, PRODUCT_SELECTION, STOCK, CASHIER | YES: Stock workflow | YES: Cashier workflow |
| Edit before Product confirmation | OPEN: D1 vs D4                           | +STAFF                                                                    | YES                                          | NO                  | NO                    |
| Select Product                   | YES                                      | +STAFF                                                                    | YES                                          | NO                  | NO                    |
| Edit Product before confirmation | OPEN: D1 vs D4                           | +STAFF                                                                    | YES                                          | NO                  | NO                    |
| Confirm Product/Purchase         | YES                                      | +STAFF                                                                    | YES                                          | NO                  | NO                    |
| View Stock request               | YES                                      | YES: own Branch                                                           | NO                                           | YES: own Branch     | NO                    |
| SEARCHING                        | YES                                      | NO                                                                        | NO                                           | YES                 | NO                    |
| FOUND                            | YES                                      | NO                                                                        | NO                                           | YES                 | NO                    |
| OUT_OF_STOCK                     | YES                                      | NO                                                                        | NO                                           | YES                 | NO                    |
| SENT_TO_CASHIER                  | YES                                      | NO                                                                        | NO                                           | YES                 | NO                    |
| CASHIER_RECEIVED                 | YES                                      | NO                                                                        | NO                                           | NO                  | YES                   |
| CASHIER_SCAN                     | YES                                      | NO                                                                        | NO                                           | NO                  | YES                   |
| BILL_OPENED                      | YES                                      | NO                                                                        | NO                                           | NO                  | YES                   |
| COMPLETED                        | YES                                      | NO                                                                        | NO                                           | NO                  | YES                   |
| Manage Staff                     | YES                                      | YES: own Branch                                                           | NO                                           | NO                  | NO                    |
| Manage Branch                    | YES                                      | NO                                                                        | NO                                           | NO                  | NO                    |
| Product/Model/SKU CRUD           | YES                                      | NO                                                                        | NO                                           | NO                  | NO                    |
| Reports                          | YES                                      | YES: own Branch                                                           | NO                                           | NO                  | NO                    |
| Export                           | YES                                      | YES: own Branch                                                           | NO                                           | NO                  | NO                    |
| Perform DEMO                     | OPEN                                     | +STAFF                                                                    | YES                                          | OPEN                | OPEN                  |
| Record customer decision         | OPEN                                     | OPEN                                                                      | OPEN                                         | OPEN                | OPEN                  |
| Manage role assignments          | YES: all roles; Branch transfer          | YES: STAFF/STOCK/CASHIER, own Branch only                                 | NO                                           | NO                  | NO                    |
| Reset password                   | YES: revokes all sessions; forced change | NO                                                                        | NO                                           | NO                  |
| Manage System Configuration      | YES: details OPEN                        | OPEN                                                                      | OPEN                                         | OPEN                | OPEN                  |
| Delete Session                   | OPEN                                     | OPEN                                                                      | OPEN                                         | OPEN                | OPEN                  |

The first 22 rows follow D1 except conflict cells are explicitly OPEN. DEMO is confirmed for STAFF by requirements §9; do not infer other-role grants from unrelated permissions. D39 resolves role assignment and account safeguards. System Configuration fields/actions remain OPEN. No version-one Admin UI for Accessories/Ontop/Points/Burn Point/Payment (D15).

## Role composition

| Assigned roles                    | Effective workflow permissions                                         | Branch scope |
| --------------------------------- | ---------------------------------------------------------------------- | ------------ |
| MANAGER                           | No automatic STAFF/STOCK/CASHIER workflow grants                       | Own Branch   |
| MANAGER + STAFF                   | STAFF permissions, including cancellation in all four confirmed stages | Own Branch   |
| MANAGER + STOCK                   | STOCK permissions                                                      | Own Branch   |
| MANAGER + CASHIER                 | CASHIER permissions                                                    | Own Branch   |
| MANAGER + STAFF + STOCK + CASHIER | Union of all four roles                                                | Own Branch   |

MANAGER's own management/view/report permissions remain in addition to the assigned workflow roles. Read each action-matrix role column as that role's grant; `NO` does not block a grant from another assigned role. `+STAFF` is shorthand for that particular confirmed grant, not a ban on permissions obtained through STOCK or CASHIER.

Global ADMIN scope and workflow-action permission are separate. Existing ADMIN YES cells are supported by explicit D1/D4 action grants, never inferred from global scope. ADMIN cancellation/edit conflicts and other genuinely unconfirmed actions remain OPEN.

## Immutable constraints

No role, including ADMIN, may edit recorded timestamps, modify/delete events, edit purchase data after confirmation, reopen a cancelled Session, or override terminal outcomes through generic CRUD. Product CRUD must preserve historical purchase integrity; deletion/FK behavior is OPEN, so CRUD does not authorize cascading deletion of Session history.

## Source conflicts and enforcement

D1 explicitly grants ADMIN session editing/cancellation, whereas D4 says those actions require separate confirmation. They are OPEN pending reconciliation (OQ-01).

Requirements §25 and the explicit Phase 1 correction confirm STAFF cancellation during DEMO, PRODUCT_SELECTION, STOCK and CASHIER. This grant is resolved and does not require an additional STOCK or CASHIER role. The correction supersedes any restrictive reading of D21. OQ-02 now concerns only unconfirmed substate/action-boundary details, not this role permission.

D4's broad management language does not invalidate D1's explicit view grants. Additional unnamed operations stay OPEN. A permission cannot create an unconfirmed state transition; refer to [state machine](state-machine.md).

## Account-management guards (D39)

MANAGER cannot grant ADMIN/MANAGER, transfer Branch or modify higher-privilege accounts. ADMIN manages Branch and resets passwords. Account deactivation revokes all login sessions; Branch deactivation fails while active Staff remain. Removing/deactivating the last active ADMIN fails atomically, including concurrent requests. These guards do not settle ADMIN session cancellation/edit permissions.
