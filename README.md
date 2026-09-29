# Service Efficiency System

React/Vite + NestJS + Prisma/MySQL ใน npm monorepo. Login และการจัดการ Staff/Role/Branch ใช้ API และฐานข้อมูลจริงแล้ว ส่วน Customer Session, Product และ workflow ยังเป็น mock ในหน่วยความจำและไม่บันทึกข้อมูลจริง

ข้อกำหนด: [requirements](docs/requirements.md), [decisions D39](docs/decisions.md), [permissions](docs/permissions.md), [open questions](docs/open-questions.md)

## Development setup

ใช้ Node.js 22.12+, npm 10+ และ Docker Compose. รันจาก root:

```sh
npm install
cp .env.example .env.mysql
cp apps/api/.env.example apps/api/.env.development
```

ใส่รหัสผ่านแบบสุ่มสองค่าที่ต่างกันใน `.env.mysql` และใส่ MYSQL_PASSWORD เดียวกันใน DATABASE_URL ของ `apps/api/.env.development` (URL-encode อักขระพิเศษ). ห้าม commit credentials. ไฟล์เหล่านี้ถูก ignore. การติดตั้งครั้งนี้เตรียมไฟล์ local ไว้แล้ว ไม่ต้อง copy ทับ

```sh
docker compose --env-file .env.mysql -f compose.dev.yml -p service-efficiency-dev up -d
npx prisma generate
npx prisma migrate deploy
npm run build:api
```

MySQL development อยู่ที่ `127.0.0.1:3307` ใน volume แยก. ไม่ใช้ MySQL ของโปรเจกต์อื่นบน 3306. รอ container healthy ก่อน migrate. เปลี่ยนรหัสผ่านใน env ภายหลังไม่ได้เปลี่ยนบัญชีใน volume เดิมโดยอัตโนมัติ

สร้าง ADMIN เฉพาะ database ที่ยังไม่มี Staff โดยตั้ง `BOOTSTRAP_STAFF_ID` และ `BOOTSTRAP_PASSWORD` ผ่าน environment ของ terminal แล้วรัน:

```sh
npm run db:bootstrap --workspace=@service-efficiency/api
```

บัญชีเริ่มต้นที่ผู้ใช้ยืนยันคือ `0001`; ใช้รหัสชั่วคราวที่ผู้ใช้ให้ผ่าน environment ไม่เก็บใน source. Script ปฏิเสธหากมี Staff อยู่แล้วและไม่ทับบัญชีเดิม. Login ครั้งแรกต้องเปลี่ยนรหัส จากนั้น Login ใหม่. ADMIN เพิ่ม Branch และ Staff ผ่านหน้าจัดการได้ ไม่มี Branch/Staff ตัวอย่างถูก seed

เปิดสอง terminal:

```sh
npm run dev:api
npm run dev
```

Web ใช้ `http://localhost:5173` (หรือพอร์ตว่างถัดไป เช่น 5174 ตาม Vite output). API ใช้ `http://127.0.0.1:3001`; Vite proxy `/api` ไป API. `GET /health` เป็น liveness endpoint

## Configuration

API และ Prisma CLI โหลด `apps/api/.env.development` ก่อน `.env` ใน development; environment ที่ inject มีลำดับสูงกว่า. Production ใช้ `.env`/platform environment เท่านั้น. ไฟล์ `.env` เดิมที่มีอยู่ไม่ได้ถูกเปลี่ยน

| Variable     | Meaning                                                         |
| ------------ | --------------------------------------------------------------- |
| DATABASE_URL | MySQL connection; never expose to frontend                      |
| NODE_ENV     | development or production                                       |
| HOST / PORT  | API bind address; local 127.0.0.1:3001                          |
| CORS_ORIGINS | exact allowed Web origins, comma-separated; local 5173 and 5174 |

## Validation

```sh
npm run lint
npm run build
npx prisma validate
npm run test
```

`npm run test` builds API, runs real MySQL HTTP integration tests, then Web unit tests. API tests require isolated database **service_efficiency_test** and `apps/api/.env.test` containing its DATABASE_URL and allowed development CORS origins. Tests explicitly refuse any other database name and clean only their generated fixtures. Do not put business data in this database

Create the test database and grant access using the development container:

```sh
docker compose --env-file .env.mysql -f compose.dev.yml -p service-efficiency-dev exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "CREATE DATABASE IF NOT EXISTS service_efficiency_test; GRANT ALL ON service_efficiency_test.* TO service_efficiency;"'
```

Copy development env to `.env.test`, change only database name to `service_efficiency_test`, then:

```sh
node --env-file=apps/api/.env.test node_modules/prisma/build/index.js migrate deploy
npm run test
```

Web-only tests: `npm run test --workspace=@service-efficiency/web`. Integration tests cover forced password changes, per-account lockout, scoped management, branch membership, session expiry/revocation, device-specific logout and concurrent last-ADMIN protection

## Structure and security

- `apps/api/src/accounts`: DTOs, password hashing, account authorization, session lifecycle and controllers
- `apps/api/prisma`: account-only schema and versioned migrations
- `apps/api/scripts/bootstrap.mjs`: explicit initial ADMIN creation
- `apps/api/tests`: isolated database integration tests
- `apps/web/src/features/auth`: real login/session gate and password change
- `apps/web/src/features/admin`: real Staff/Role/Branch forms
- `apps/web/src/services/api.ts`: cookie-based API client
- `apps/web/src/mocks`: product/workflow display fixtures only

Passwords use salted scrypt; only session-token hashes are stored. Cookies are HttpOnly/SameSite=Lax, Secure in production. Unsafe requests require allowed Origin plus custom header. Authorization reads current database roles/status/Branch on every protected request. Account mutations are serialized using a database lock row, including last-ADMIN checks; this initial implementation is not a workflow concurrency design

Sessions expire after eight hours without server activity. UI interaction checks identity at most once per minute; no automatic heartbeat keeps an idle user logged in. Logout revokes the current session; reset/deactivation revoke every session. Password change also clears existing sessions and returns to Login

## Coolify — later phase

Not deployed in this phase. Production domains, proxy configuration and database credentials remain OPEN. Serve Web and `/api` through the same HTTPS origin; Vite's development proxy is not part of a static production build. Build with `npm ci`, `npx prisma generate`, `npm run build`; run migrations through the release process and start API with `npm run start:prod --workspace=@service-efficiency/api`. Configure production environment and HTTPS before enabling Secure cookies

## Dependency limitation

The last `npm install` reported three high vulnerabilities in the existing Prisma tooling dependency chain. No forced major upgrade/downgrade was applied. Review dependencies before production deployment
