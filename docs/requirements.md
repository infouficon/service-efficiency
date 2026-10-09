# Service Efficiency System — Requirements

This document organizes the current project specification into confirmed requirements, open questions, and technical decisions. Existing application code demonstrates infrastructure only; it does not establish new business rules. Section numbers below retain the source specification identifiers for traceability.

## Confirmed

### 1. Document Purpose

This document is the single source of truth for the confirmed business
and product requirements of the Service Efficiency System.

The system is a web application for recording the timestamps and
operational data of a retail service workflow. The collected raw data
must support future analysis of service efficiency and KPI performance.

Requirement rules

Confirmed requirements in this document must be followed.

Do not invent business rules that are not confirmed.

Do not add fields, statuses, options, permissions, integrations, or
calculations without a confirmed requirement.

Unresolved items must be recorded as open questions rather than
guessed.

Server time is the source of truth for workflow timestamps.

Historical timestamps/events must not be editable by users.

KPI and efficiency formulas are not yet defined.

### 4. System Objective

The system must:

Create a customer session immediately when a customer walks into a
store.

Record each important stage of the service workflow.

Record server-generated timestamps for each confirmed workflow
action.

Support the DEMO, purchase, Stock, and Cashier workflows.

Record customer cancellation and cancellation reasons.

Preserve raw operational data for future efficiency analysis.

Provide Dashboard/Report functionality.

Support data export to Excel and CSV.

Support role-based access.

Support multiple roles assigned to the same Staff member.

The system does not currently define KPI formulas. KPI calculation must
therefore remain a future concern unless separately specified.

### 5. Core Business Concept: Customer Session

CustomerSession is the central business object.

A session starts immediately when a customer walks into the store.

Conceptually:

```text
Customer
   └── CustomerSession
        ├── Branch
        ├── Staff / DEMO
        ├── Customer decision
        ├── Main Product
        ├── Accessories
        ├── Ontop
        ├── Points
        ├── Burn Points
        ├── Payments
        ├── Stock workflow
        ├── Cashier workflow
        ├── Cancellation
        └── Events / timestamps
```

A single session initially has exactly one main Product.

Accessory selections may contain multiple items.

A Customer can have multiple Sessions over time, as confirmed in the initial project specification.

### 6. Customer Master

The current Customer Master contains only:

Customer ID

Phone Number

Do not add customer name, email, address, birthday, gender, or other
personal fields unless explicitly required later.

Customer phone number is manually collected by asking the customer only after the customer decides BUY. Do not collect a phone number at Walk-in, during DEMO, or for NOT_BUY. After BUY, Customer Phone Number is required and must contain exactly 10 ASCII digits (0–9), with no required starting digit. The phone number must be valid before product selection is available.

### 7. Branch

Confirmed Branch fields:

Branch Code

Branch Name

Phone

A branch-bound Staff account belongs to exactly one Branch. ADMIN-only accounts have no Branch.

A Manager belongs to exactly one Branch.

Admin is global and is not limited to one Branch.

Admin can manage branches across the entire system.

### 8. Staff and Roles

8.1 Roles

The current roles are:

ADMIN

MANAGER

STAFF

STOCK

CASHIER

8.2 Multiple roles

One Staff member can have multiple roles at the same time.

Examples:

Staff A
- STAFF
- STOCK
- CASHIER

Manager B
- MANAGER
- STAFF
- STOCK

A Manager can also be:

Staff

Stock

Cashier

Role assignment must therefore be modeled as a many-to-many relationship
between Staff and Roles rather than as a single role field.

8.3 Admin

Admin is a Global Admin.

Admin has system-wide scope across all branches.

8.4 Manager

Manager belongs to exactly one Branch.

Manager can manage Staff only within the Manager's own Branch.

8.5 Staff

Staff belongs to exactly one Branch.

Staff ID is the username used for login.

Login credentials are:

Staff ID

Password

Authenticated identity must be the source of truth for the acting Staff
member. Do not trust an arbitrary Staff ID supplied by the client
request body when authenticated identity is available.

### 9. DEMO

DEMO means the staff activity of demonstrating/offering/selling a
product to a customer.

DEMO is not the name of the system.

One DEMO Staff member can handle only one customer at a time.

The acting Staff ID must come from the authenticated user.

### 10. Main Workflow

The confirmed high-level workflow is:

```text
CUSTOMER WALK-IN
      ↓
DEMO
      ↓
CUSTOMER DECISION
      ├── NOT BUY
      │      ↓
      │    CLOSED
      │
      └── BUY
             ↓
       PRODUCT SELECTION
             ↓
        CONFIRMATION
             ↓
       STOCK REQUESTED
             ↓
          SEARCHING
             ├── OUT_OF_STOCK
             │       ↓
             │     CLOSED
             │
             └── FOUND
                    ↓
              SENT_TO_CASHIER
                    ↓
             CASHIER RECEIVED
                    ↓
               CASHIER SCAN
                    ↓
                BILL OPENED
                    ↓
                COMPLETED
```

CUSTOMER_CANCELLED is a terminal outcome and may occur from:

DEMO

Product Selection

Stock

Cashier

### 11. Confirmed Timestamp Requirements

The system must store the following timestamps:

```text
customer_walk_in_at
demo_start_at
demo_end_at
product_selection_start_at
product_selection_confirmed_at
stock_started_at
stock_found_at
cashier_received_at
cashier_scan_at
bill_opened_at
```

Timestamp rules

All timestamps must be generated by the server.

Client applications must not submit timestamps as authoritative
values.

Users must not be able to edit timestamps after creation.

A timestamp represents the time when the corresponding action was
performed.

Do not add extra business timestamps unless explicitly approved.

### 12. Customer Decision

After DEMO, the customer decides whether to buy.

Supported decisions:

```text
BUY
NOT_BUY
```

### 13. NOT_BUY Workflow

For a customer who does not buy, store:

startedAt

demoStartedAt

demoEndedAt

decisionAt

result

NOT_BUY result options

Exactly these options are confirmed:

ราคา

ยังไม่ตัดสินใจ

เปลี่ยนใจ

สินค้าไม่ตรงความต้องการ

ต้องการสอบถามราคาหรือรายละเอียดเฉยๆ

อื่น ๆ

Do not add other result options without confirmation.

### 14. BUY Workflow

When the customer decides to buy, the system collects:

Branch

Staff ID

Customer Phone Number

Product Category

Product

Model

SKU

Accessories

Ontop

Points

Burn Point

Payment

Before sending the request to Stock, the system must show a Confirmation
step.

Once the purchase data is confirmed:

It cannot be edited after confirmation.

Corrections must be made before confirmation.

### 15. Product Master

Product categories are:

iPhone

iPad

Mac

Watch

Accessories

The system must support product information down to:

```text
Product
  └── Model
       └── SKU
```

The actual Product / Model / SKU master data exists externally.

For the initial version, use mock/master data inside this application's
own database.

Branch-Isolated Inventory & Stock Rules (Confirmed):
- Master catalog (Product, Model, SKU) is centrally managed by Admin.
- Inventory is tracked per branch and SKU (`BranchInventory` with `stock` and `active`).
- Defaults for new SKU / new Branch: `stock = 0`, `active = true`.
- Visibility: Branch staff (Staff, Stock, Cashier) only see active SKUs of their own branch.
  - In-stock (`stock > 0`): Visible and selectable.
  - Out-of-stock (`stock = 0`): Visible with "สินค้าหมด" badge, cannot be selected.
  - Inactive (`active = false`): Hidden from branch staff.
- Permissions:
  - Admin: Global access, creates/edits master catalog, sets branch stock quantity, toggles branch active status.
  - Manager: Branch access, toggles branch active status for own branch. Cannot modify stock quantity.
- Stock Deduction & Restoration Lifecycle:
  - When Stock marks `FOUND`: Deducts 1 from branch stock.
  - When Session cancelled after `FOUND`: Restores 1 to branch stock.
  - When Stock marks `OUT_OF_STOCK`: Sets branch stock to 0 immediately and alerts Branch Manager to investigate loss vs misplaced item.

External master-data integration is a future requirement and must not be
implemented unless separately specified.

### 16. Accessories

The confirmed Accessory options are:

Apple Pencil

Apple Keyboard

Magic Mouse

Magic Trackpad

Case

Protection

Power & Battery

AirPods & Audio

Adapters & Hubs

Charging

Storage / Connectivity

Headphones & speakers

Apple Care+

iProtect

Software

None

Accessory rules

Optional.

Multiple selections are allowed.

Each selected accessory has a quantity input immediately after its name on the same row. Selecting an accessory initializes its quantity to 1. Quantity must be a positive integer: zero, negative numbers and fractions are not accepted. Deselecting an accessory clears its quantity; selecting it again starts at 1.

Quantity is required only for Accessory selections because the
business requirement explicitly supports quantity.

If nothing is selected, store no accessory selection.

If None is selected, treat it as no selection and store null /
no related selection.

None is not an actual accessory purchase line.

### 17. Ontop

Confirmed options:

AIS

True

CATH

KTS

None

Ontop rules

Optional.

Multiple selections are allowed.

No amount/value is stored.

If nothing is selected, store null / no related selection.

If None is selected, store null / no related selection.

None is not an actual Ontop transaction line.

### 18. Points

Confirmed options:

MCard

The 1

UJOY

None

Points rules

Optional.

Multiple selections are allowed.

Store only the selected option(s).

Do not store Point quantity.

Do not store Point monetary value.

If nothing is selected, store null / no related selection.

If None is selected, store null / no related selection.

None is not an actual Point selection.

### 19. Burn Point

Confirmed options:

MCard

The 1

UJOY

None

Burn Point rules

Optional.

Multiple selections are allowed.

Store only the selected option(s).

Do not store Point quantity.

Do not store monetary value.

If nothing is selected, store null / no related selection.

If None is selected, store null / no related selection.

None is not an actual Burn Point selection.

### 20. Payment

Confirmed options:

Cash

Transfer

SPayLater

TrueMoney

Full Credit Card

0% Credit Card

PayNext

UFund

Ulite

Thisshop

Kashjoy

Payment rules

The UI supports multiple selections.

Store only the selected payment method(s).

Do not store payment amount.

Do not store payment fee.

Do not store payment discount, as confirmed in the initial project specification.

Do not store payment transaction amount.

Do not invent financial fields.

There is currently no requirement to store a monetary value per
payment method.

### 21. None Semantics

For Accessory, Ontop, Points, and Burn Point:

```text
Nothing selected → null / no related selection
None selected    → null / no related selection
Actual selection → store selected item(s)
```

None should not become a persistent business transaction line.

### 22. Confirmation and Immutability

Before Stock receives a purchase request, the Staff must confirm the
selected purchase data.

After confirmation:

Main purchase data cannot be edited.

Product selection cannot be changed.

Accessory selection cannot be changed.

Ontop selection cannot be changed.

Points selection cannot be changed.

Burn Point selection cannot be changed.

Payment selection cannot be changed.

The system must preserve the confirmed data for downstream workflow.

### 23. Stock Workflow

Stock uses the same web application.

The UI must be role-based.

After a confirmed purchase is sent to Stock, Stock can see the request.

Seeing the request does not automatically mean that Stock has started
searching.

Stock must explicitly press the SEARCHING action.

When Stock presses SEARCHING:

stock_started_at = server timestamp

Confirmed Stock statuses

SEARCHING

FOUND

SENT_TO_CASHIER

OUT_OF_STOCK

CUSTOMER_CANCELLED

There is deliberately no NOT_FOUND status.

OUT_OF_STOCK

If Stock determines that the product is out of stock:

```text
OUT_OF_STOCK
    ↓
Session ends
```

The session is terminal at this point.

No additional Stock status is required.

### 24. Cashier Workflow

The existing Cashier system is FileMaker.

The Service Efficiency System does not integrate with the
Cashier/FileMaker API.

Cashier manually enters the following information in FileMaker:

Invoice Number

Bill Number

Transaction ID

The Service Efficiency System does not currently require these external
identifiers to be integrated unless separately specified.

The Service Efficiency System tracks these workflow actions:

```text
SENT_TO_CASHIER
      ↓
CASHIER_RECEIVED
      ↓
CASHIER_SCAN
      ↓
BILL_OPENED
      ↓
COMPLETED
```

The following timestamps are generated when Cashier presses the
corresponding action:

cashier_received_at

cashier_scan_at

bill_opened_at

There is no API integration with FileMaker in the current requirement.

### 25. Customer Cancellation

Staff can trigger CUSTOMER_CANCELLED from:

DEMO

Product Selection

Stock

Cashier

CUSTOMER_CANCELLED is a terminal Session outcome.

Cancellation reason

The Staff must select exactly one reason from:

ลูกค้าเปลี่ยนใจ

รอนาน

อื่น ๆ

If อื่น ๆ is selected, additional text must be entered.

The cancellation record must preserve:

reason

otherReason, when applicable

cancelledBy

cancelledAt

Rules:

cancelledBy comes from the authenticated Staff identity.

cancelledAt is generated by the server.

Cancellation timestamp cannot be edited.

Do not accept an arbitrary client-provided Staff ID as the
cancellation actor.

### 27. Roles and Permission Scope

Confirmed permission requirements:

Admin

Global system scope.

Can manage branches across the system.

Global Admin is not restricted to one Branch.

Manager

Belongs to exactly one Branch.

Can manage Staff only within their own Branch.

May also have Staff, Stock, and/or Cashier roles.

Staff

Belongs to exactly one Branch.

Can perform DEMO.

Can trigger CUSTOMER_CANCELLED during the confirmed stages.

Can have additional roles.

Stock

Operates the Stock workflow.

Sees Stock requests in the web application.

Starts searching by pressing SEARCHING.

Can progress Stock status according to the confirmed workflow.

Cashier

Operates the Cashier workflow in the web application.

Presses the actions that generate Cashier timestamps.

Unresolved details are tracked in [Open questions](open-questions.md).

### 28. Dashboard and Reports

Dashboard / Report functionality is required.

The system must preserve sufficient raw operational data to support
future analysis.

Unresolved details are tracked in [Open questions](open-questions.md).

### 29. Export

The system must support:

Excel export

CSV export

Unresolved details are tracked in [Open questions](open-questions.md).

### 32. API Identity and Security

The application must treat authenticated identity as authoritative.

Examples:

Staff ID for DEMO comes from the authenticated user.

Staff ID for cancellation comes from the authenticated user.

Actor identity for Stock/Cashier actions comes from the
authenticated user.

The client must not be able to impersonate another Staff member by
simply submitting another Staff ID in the request payload.

### 33. Server Timestamp Rules

All workflow timestamps must be generated on the backend.

For example:

Client:
POST /sessions/:id/stock/search

Server:
stock_started_at = now()

Do not support:

```text
POST ... {
  "stock_started_at": "2026-..."
}
```

as an authoritative value.

The server decides the timestamp.

### 38. Initial Mock Master Data

The initial system will use local mock/master data for Product / Model /
SKU.

The confirmed Product Categories are:

iPhone

iPad

Mac

Watch

Accessories

Other master option lists are also confirmed:

Accessories

Apple Pencil

Apple Keyboard

Magic Mouse

Magic Trackpad

Case

Protection

Power & Battery

AirPods & Audio

Adapters & Hubs

Charging

Storage / Connectivity

Headphones & speakers

Apple Care+

iProtect

Software

None

Ontop

AIS

True

CATH

KTS

None

Points

MCard

The 1

UJOY

None

Burn Point

MCard

The 1

UJOY

None

Payment

Cash

Transfer

SPayLater

TrueMoney

Full Credit Card

0% Credit Card

PayNext

UFund

Ulite

Thisshop

Kashjoy

Unresolved details are tracked in [Open questions](open-questions.md).

### 40. Data Integrity Principles

The implementation should protect these invariants:

A branch-bound Staff account belongs to exactly one Branch. ADMIN-only accounts have no Branch.

A Manager belongs to exactly one Branch.

Admin is global.

Staff can have multiple roles.

A Session belongs to a Customer.

A Session has one main Product.

Accessory selections may have multiple lines and quantities.

Ontop, Points, Burn Point, and Payment support multiple selected
options at the UI/business-model level.

None does not represent a real selected transaction line.

Confirmed purchase data cannot be edited after confirmation.

Workflow timestamps are server-generated.

Workflow timestamps cannot be edited by users.

Cancellation requires a predefined reason.

Cancellation reason อื่น ๆ requires additional text.

OUT_OF_STOCK terminates the session.

There is no NOT_FOUND Stock status.

Cashier integration with FileMaker is not part of the current
system.

### 41. Confirmed account implementation decisions (2026-09-28)

The user confirmed the following for the first backend phase. These supersede older unspecified authentication/account details, not workflow permissions.

- Implement real Login, Staff/Role/Branch management against development MySQL first. Connect workflow in later phases; remove each portion's mocks when its API is ready.
- Start without invented Branch/Staff master data. Users enter their data through management screens. Create initial ADMIN Staff ID `0001` using the user-provided temporary password, supplied outside source control.
- ADMIN-only accounts have no Branch. Any account with MANAGER, STAFF, STOCK or CASHIER has exactly one home Branch. ADMIN global scope remains separate from workflow-action permissions. Assigned roles combine by union.
- MANAGER may assign STAFF/STOCK/CASHIER only within their own Branch. Granting MANAGER/ADMIN and transferring Branch are ADMIN-only.
- Deactivate Staff instead of deleting them; revoke all their login sessions. A Branch with active Staff cannot be deactivated.
- Never deactivate or remove ADMIN if that leaves no active ADMIN.
- Cookie/session authentication has an eight-hour idle timeout, supports multiple devices and logs out only the current device. No absolute session lifetime is added in this phase.
- Passwords have a minimum of eight characters. New/reset accounts, including the initial ADMIN, must change their temporary password before using the application.
- Five consecutive failed logins lock the account for fifteen minutes, counted per account. ADMIN reset revokes all login sessions and requires a password change again.
- Accessories/Ontop/Points/Burn Point/Payment keep their already confirmed exact lists. This phase does not implement product/workflow persistence or decide remaining workflow questions.

## Open questions

[docs/open-questions.md](open-questions.md) is the unresolved-requirements register. Its questions do not override confirmed options, terminal outcomes, immutable data, or server-generated timestamps. Do not implement an unresolved rule by assumption.

## Technical decisions

These sections preserve the specification’s stack, architecture, design guidance, and implementation process. Proposed structures and conceptual examples are not approval for additional business fields, event types, statuses, or endpoints.

### 2. Technology Stack

The confirmed technology stack is:

Architecture: Monorepo

Package manager: npm

Frontend: React + TypeScript

Frontend build tool: Vite

Backend: Node.js + NestJS + TypeScript

ORM: Prisma

Database: MySQL

Deployment target: Coolify

The project should be production-oriented and use TypeScript strictness
and clear domain/module boundaries.

### 3. Project Structure

The intended repository structure is:

```text
service-efficiency/
├── apps/
│   ├── web/
│   │   └── React + TypeScript + Vite
│   └── api/
│       └── NestJS + Prisma
├── packages/
│   └── shared/
├── docs/
│   ├── requirements.md
│   ├── architecture.md
│   ├── erd.md
│   ├── state-machine.md
│   ├── permissions.md
│   └── open-questions.md
├── package.json
├── package-lock.json
└── README.md
```

The exact internal file structure may evolve, but business/domain
boundaries must remain clear.

### 26. Event / Audit Data

The SessionEvent structure below is conceptual design guidance; its exact schema and event types still require confirmation.

Because the system exists primarily to analyze operational efficiency,
workflow history must be preserved.

The design should support an immutable session event/audit concept.

A conceptual event contains:

```text
SessionEvent
├── id
├── sessionId
├── eventType
├── actorStaffId
├── createdAt
└── metadata
```

The exact event model and event types must follow the confirmed state
machine and must not invent additional business events.

Events/timestamps that have already occurred must not be editable by
normal users.

### 30. Backend Domain Boundaries

The backend should be organized around clear domains. The expected
domains include:

```text
auth
users / staff
roles
branches
customers
sessions
products
accessories
ontop
points
burn-points
payments
stock
cashier
events
reports
exports
```

The exact NestJS module structure may evolve as implementation proceeds.

### 31. Frontend Feature Boundaries

The frontend should use feature-oriented organization.

Expected areas:

```text
src/
├── app/
├── features/
│   ├── auth/
│   ├── sessions/
│   ├── demo/
│   ├── stock/
│   ├── cashier/
│   ├── customers/
│   ├── products/
│   ├── accessories/
│   ├── ontop/
│   ├── points/
│   ├── burn-points/
│   ├── payments/
│   ├── dashboard/
│   ├── reports/
│   └── exports/
├── components/
├── layouts/
├── hooks/
├── services/
├── permissions/
├── types/
└── utils/
```

Do not create unnecessary empty abstractions just to match this
structure.

### 34. Initial Infrastructure Requirements

The initial project setup must provide:

npm workspaces

React + TypeScript + Vite

NestJS + TypeScript

Prisma

MySQL datasource

.env.example

.gitignore

ESLint

Prettier

root development scripts

root build scripts

NestJS health endpoint

PrismaService

Expected root commands:

npm run dev:web
npm run dev:api
npm run build:web
npm run build:api

Expected API health endpoint:

GET /health

Expected response:

```text
{
  "status": "ok"
}
```

Initial setup should not create business tables before the approved
ERD/schema design.

### 35. Environment and Secrets

Database credentials and secrets must not be hardcoded.

Use environment variables, for example:

DATABASE_URL="mysql://USER:PASSWORD@localhost:3306/service_efficiency"

.env must not be committed.

Provide .env.example.

### 36. Production Code Quality

The project should follow these principles:

TypeScript strict mode

Clear naming

Small cohesive modules

No unnecessary abstraction

Avoid any unless technically justified

DTO validation

Consistent error handling

Environment-based configuration

No hardcoded credentials

Clear domain boundaries

Automated tests for important business rules

Lint and format checks

Build validation

Do not refactor unrelated code during feature implementation.

### 37. Coolify Deployment

Deployment target is Coolify.

The architecture must allow the following components to be deployed:

```text
React Web
     ↓
NestJS API
     ↓
MySQL
```

The exact Coolify deployment configuration, domains, reverse proxy
setup, and environment variables are deployment concerns and should not
be hardcoded into application business logic.

### 39. Conceptual State Model (source heading: Confirmed State Model)

The source diagram below is preserved verbatim for traceability. Its `NOT_PURCHASE` label conflicts with the explicitly confirmed `NOT_BUY` decision value. It is not an additional decision option or an approved persistence enum. Resolve naming before implementing the state model.

The conceptual workflow is:

```text
WALK_IN
  ↓
DEMO
  ↓
DECISION
  ├── NOT_PURCHASE → CLOSED
  │
  └── PRODUCT_SELECTION
          ↓
      CONFIRMATION
          ↓
      STOCK_REQUESTED
          ↓
       SEARCHING
          ├── OUT_OF_STOCK → CLOSED
          │
          └── FOUND
               ↓
        SENT_TO_CASHIER
               ↓
        CASHIER_RECEIVED
               ↓
          CASHIER_SCAN
               ↓
          BILL_OPENED
               ↓
           COMPLETED
```

CUSTOMER_CANCELLED may terminate the session from:

DEMO
PRODUCT_SELECTION
STOCK
CASHIER

The exact state transition implementation should enforce only the
transitions that have been confirmed.

### 42. Implementation Rule

When implementing this system:

```text
Confirmed requirement
        ↓
Design
        ↓
Implementation
        ↓
Validation / Tests
```

When an implementation decision is not covered:

```text
Missing requirement
        ↓
OPEN QUESTION
        ↓
Do not guess
```

The goal is not to maximize the amount of code written at once. The goal
is to build a correct, maintainable, production-ready system without
silently inventing business rules.

### 43. Definition of Done for Each Development Phase

Each implementation phase should:

Read the relevant requirements/docs.

Implement only the requested scope.

Avoid unrelated refactoring.

Add or update tests for affected business rules.

Run lint.

Run tests.

Run build.

Fix failures caused by the implementation.

Report changed files and validation results.

Record newly discovered unresolved requirements in
docs/open-questions.md.

Do not claim a phase is complete when tests or builds are failing.

### 44. Development Phases

The project should be developed incrementally:

Phase 0
Initial project setup

Phase 1
Architecture + ERD + State Machine + Permission Matrix

Phase 2
Prisma schema + migrations + mock master data

Phase 3
Authentication + RBAC

Phase 4
Customer + Customer Session + DEMO

Phase 5
Product Selection + Confirmation

Phase 6
Stock workflow

Phase 7
Cashier workflow

Phase 8
Customer Cancellation + immutable events

Phase 9
Dashboard + Reports

Phase 10
Excel + CSV exports

Phase 11
Production hardening

Phase 12
Coolify deployment

Each phase should be reviewed before proceeding to the next phase when
the change affects database structure or business rules.

### Current infrastructure choices

The existing project uses npm workspaces `apps/*` and `packages/*`, Prisma 6 with `prisma-client-js`, a MySQL datasource, and a schema with no business models. `GET /health` returns `{"status":"ok"}` as a liveness check. PrismaModule is prepared but is not imported into AppModule. Helmet, environment-configured CORS, and global DTO validation are configured. These are setup choices, not additional business requirements. See [README](../README.md) for commands and environment configuration. `docs/decisions.md` is currently empty.
