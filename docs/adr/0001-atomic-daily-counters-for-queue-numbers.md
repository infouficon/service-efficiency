# 0001. Allocate queue numbers and references with an atomic counter row

- **Status:** accepted
- **Date:** 2026-10-13
- **Implements / resolves:** D57 · H-05
- **Decided with:** grilling session 2026-10-13 (owner answers recorded in D57)

## Context
Staff call a customer by a short queue number (`A012`, D57): one running number per branch, per type letter, per Bangkok day.
Before this change the only running number was `SES-YYYYMMDD-NNNNNN`, allocated in `createWalkIn` by reading the day's highest reference and
adding 1 with no lock (H-05): two walk-ins at the same moment collided on the unique key (HTTP 500), and the date came from the server's time zone.
Queue numbers repeat by design (a "buy again" keeps the old number, F11), so the database cannot enforce them with a unique key.

## Decision
A table `DailyCounter (scope, day, lastNo)` holds one row per counter and Bangkok day. A number is taken with a single statement inside the
caller's transaction:

```sql
INSERT INTO DailyCounter (scope, day, lastNo) VALUES (?, ?, LAST_INSERT_ID(1))
ON DUPLICATE KEY UPDATE lastNo = LAST_INSERT_ID(lastNo + 1);
SELECT LAST_INSERT_ID();
```

Scopes: `queue:<branchId>:<letter>` and `reference`. The row stays locked until the walk-in commits, so two walk-ins can never get the same number, and a
rolled-back walk-in gives its number back (no gaps). The walk-in transaction runs at **READ COMMITTED**. A reference that already exists
(a session from before the counters, a restored backup) is skipped in a loop instead of failing. The migration seeds the `reference` counters from the
existing references so the first walk-in after the deploy continues the day.

## Alternatives considered
- **`MAX(...) + 1` under the default isolation level:** what H-05 is; races, and a table scan per walk-in.
- **A unique key on (branch, letter, day, no) plus retry on P2002:** queue numbers must be allowed to repeat (re-buy), and a retry loop hides the contention instead of removing it.
- **AUTO_INCREMENT side table or a MySQL sequence:** MySQL has no sequences, and an auto-increment id is never reset per day, branch and type.
- **`SELECT … FOR UPDATE` on the counter row, then UPDATE:** also correct, but two statements, and it still needs the row to exist first.

## Consequences
- Walk-ins can no longer collide (H-05 fixed) and the day boundary is Asia/Bangkok whatever the server's time zone.
- The `reference` counter is one hot row: every walk-in of every branch queues on it for the length of the transaction (a few milliseconds). Acceptable at this volume; the per-request global `AccountLock` (H-02) already serialises more.
- **READ COMMITTED is required for local tests.** The local test database is MariaDB 12, where `innodb_snapshot_isolation=ON` makes a REPEATABLE READ transaction fail with error 1020 ("Record has changed since last read") when it touches a counter row another walk-in just committed. Production MySQL 8.4 does not do that, but READ COMMITTED is correct on both. It needs `binlog_format=ROW` or no binary log on the production MySQL (the 8.x default).
- The migration is additive (new tables, nullable columns) and backwards compatible with the previous release.
- Follow-up: other hot rows added later (inventory counters, F13/F5) need the same care.
