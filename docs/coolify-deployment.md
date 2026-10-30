# การ Deploy ระบบ Service Efficiency บน Coolify

เอกสารนี้อธิบายขั้นตอนการตั้งค่าและ Deploy ระบบ Service Efficiency (Monorepo) บน Coolify โดยแบ่งเป็น 2 Applications (`api` และ `web`) พร้อมฐานข้อมูล MySQL

---

## 1. โครงสร้างการทำงาน (Architecture)

- **Database**: MySQL 8.4 (สร้างผ่าน Coolify Database Resource)
- **API Service** (`apps/api`): NestJS Backend + Prisma
  - รัน Database Migrations (`prisma migrate deploy`) อัตโนมัติเมื่อ Container เริ่มทำงาน
  - รัน Seed/Bootstrap Initial Admin อัตโนมัติเมื่อมี Environment Variables กำหนดไว้
  - Health check endpoint: `/health` (Port: `3001`)
- **Web Service** (`apps/web`): React + Vite Single Page Application บน Nginx
  - Nginx ทำหน้าที่ Serve static files และทำ Reverse Proxy เส้นทาง `/api/*` ไปยัง API Service
  - รองรับ Session Cookie แบบ Same-Origin ได้อย่างสมบูรณ์
  - Health check endpoint: `/healthz` (Port: `80`)

---

## 2. ขั้นตอนการตั้งค่าบน Coolify

### ขั้นตอนที่ 1: สร้าง MySQL Database

1. ในโปรเจกต์ Coolify เลือก **+ New** > **Database** > **MySQL**
2. ตั้งค่า Database Name เช่น `service_efficiency`
3. บันทึกและสั่ง Start Database
4. นำ **Internal Connection String / URL** มาใช้ เช่น:
   ```env
   DATABASE_URL=mysql://<user>:<password>@<database-host>:3306/service_efficiency
   ```

---

### ขั้นตอนที่ 2: ตั้งค่า API Application (Backend)

1. ใน Coolify เลือก **+ New** > **Application** > เลือก **Public/Private Git Repository**
2. เลือก Repository ของโปรเจกต์นี้
3. ในหน้า Configuration ของ Application:
   - **Build Pack**: `Dockerfile`
   - **Base Directory**: `/` _(สำคัญมาก: ต้องเป็น Root ของ Monorepo)_
   - **Dockerfile Location**: `/apps/api/Dockerfile`
   - **Port**: `3001`
   - **Health Check Path**: `/health`
4. ตั้งค่า **Environment Variables**:
   ```env
   NODE_ENV=production
   PORT=3001
   HOST=0.0.0.0
   DATABASE_URL=mysql://<user>:<password>@<database-host>:3306/service_efficiency
   CORS_ORIGINS=https://your-frontend-domain.com

   # (ทางเลือก) Initial Admin Bootstrap สำหรับการติดตั้งครั้งแรก
   BOOTSTRAP_STAFF_ID=ADMIN001
   BOOTSTRAP_PASSWORD=your-secure-password
   BOOTSTRAP_FIRST_NAME=System
   BOOTSTRAP_LAST_NAME=Admin
   ```

   > **`CORS_ORIGINS` ต้องมี "ทุกโดเมน" ที่ผู้ใช้เปิด Web ได้** (เพิ่มโดเมนใหม่ให้ Web เมื่อไหร่ ต้องมาเพิ่มที่นี่ด้วยทุกครั้ง)
   > - รูปแบบ: origin แบบตรงตัว คั่นด้วย `,` ไม่มี `/` ท้าย ไม่มีช่องว่างพิเศษ
   > - Production ปัจจุบัน: `https://service-efficiency.coolify.pve01.prod.uficon.com,https://ses.uficon.com`
   > - API (`OriginGuard` ใน `accounts.controller.ts`) ปฏิเสธทุก request ที่ไม่ใช่ GET/HEAD/OPTIONS ด้วย **HTTP 403 `Invalid request origin`** ถ้า `Origin` ไม่อยู่ใน `CORS_ORIGINS` หรือไม่มี header `X-Requested-With: ServiceEfficiency`
   > - อาการเมื่อลืมเพิ่ม: หน้า Login ได้ 403 ที่ `POST /api/auth/login` แต่ `GET /api/auth/me` ได้ 401 ปกติ และ console **ไม่มี** ข้อความ "blocked by CORS policy" (อย่าเข้าใจผิดว่าเป็น Cloudflare/Caddy ให้ดู response body ว่าเป็น `Invalid request origin`)
   > - แก้ค่านี้แล้วต้อง **Restart** API Application ถึงจะมีผล
5. กด **Save** และ **Deploy**

#### Environment ของการซิงก์สาขา/พนักงานจาก ERP (D53/D54)

| ตัวแปร | ความหมาย |
| --- | --- |
| `ERP_ODATA_BASE_URL` | `https://pos.uficon.net/fmi/odata/v4/UFService` |
| `ERP_ODATA_USER` / `ERP_ODATA_PASS` | บัญชี OData แบบอ่านอย่างเดียว (ตอนนี้ยืมของ warroom ไปก่อน แนะนำขอบัญชีของ SES โดยเฉพาะ) **ห้ามใส่ใน git** |
| `ERP_SYNC_TIMES` | เวลาไทยที่ให้ซิงก์ คั่นด้วย `,` ค่าเริ่มต้น `10:00` ตั้งว่าง = ไม่ซิงก์ตามเวลา (กดเองจากหน้า Admin) |
| `ERP_SYNC_CATCHUP_MIN` | พลาดเวลาแล้วตามทำย้อนได้กี่นาที (ค่าเริ่มต้น 60) |

#### Environment ของสินค้า/สต็อกจาก warroom (D52, D55)

| ตัวแปร | ความหมาย |
| --- | --- |
| `WARROOM_DATABASE_URL` | `postgres://<user>:<password>@<host ภายในของ DB warroom>:5432/Dashboard_NPI_Warroom` ใช้ role **อ่านอย่างเดียว** (ใส่ใน Coolify ไม่ใส่ใน git) container ของ SES ต้องต่อ host นี้ได้ |
| `WARROOM_STOCK_MODE` | `off` / `shadow` (ค่าเริ่มต้น: เก็บเลข ERP ไว้ แต่หน้าจอพนักงานยังใช้สต็อกเดิม ไม่สร้างสินค้า) / `on` (สร้างสินค้า + ใช้เลข ERP) |
| `WARROOM_SYNC_MINUTES` | เช็กทุกกี่นาทีว่ามี snapshot ใหม่ (ค่าเริ่มต้น 10; 0 = กดเองอย่างเดียว) warroom เองอัปเดตวันละ 5 รอบ |

ไม่ตั้ง `WARROOM_DATABASE_URL` = ปิดทั้งหมด รายละเอียดและขั้นตอนเปิดใช้: `docs/agents/warroom-products.md`

#### Environment ของการส่งออเดอร์ไป FileMaker (D88)

| ตัวแปร | ความหมาย |
| --- | --- |
| `FMP_HOST` | เซิร์ฟเวอร์ FileMaker เช่น `https://pos.uficon.net` (ไม่ต้องมี path) |
| `FMP_DATABASE` | ชื่อฐานข้อมูล เช่น `UFService` |
| `FMP_USER`, `FMP_PASSWORD` | บัญชี Data API ที่ทีม FMP ให้ (ตั้ง `FMP_PASSWORD` เป็น **Sensitive** ห้ามใส่ใน git/แชต) |
| `FMP_LAYOUT`, `FMP_FIELD` | ค่าเริ่มต้น `ses` และ `ses_body` |
| `FMP_SCRIPT` | ชื่อสคริปต์ที่ให้ FMP เรียกต่อหลังสร้าง record ว่าง = สร้าง record เฉย ๆ |
| `FMP_CALLBACK_KEY` | กุญแจที่ FileMaker ใช้เรียก `POST /api/integrations/fmp/callback` เพื่อรายงานผลกลับ (D90) · อย่างน้อย 32 ตัวอักษร เช่น `openssl rand -hex 32` · ตั้งเป็น **Sensitive** · ส่งให้ทีม FMP ทางช่องทางที่ปลอดภัย ห้ามใส่ใน git/แชต · ไม่ตั้ง = ประตูปิด (404) |
| `FMP_WORKER_INTERVAL_SECONDS` | ความถี่ของตัวส่ง (ค่าเริ่มต้น 10; 0 = ปิดตัวส่งอัตโนมัติ) |

ตั้ง 4 ตัวแรกครบ + Restart = เริ่มส่ง (ออเดอร์ที่ถึงแคชเชียร์หลังจากนั้น) ไม่ตั้ง = ไม่ส่งและไม่เก็บอะไร ดูผลที่ Admin → "ส่งไป FileMaker" รูปแบบข้อมูลและกติกา: `docs/agents/fmp-outbound.md`

#### Environment ของการเข้าสู่ระบบด้วย OTP ทาง SMS (D85)

| ตัวแปร | ความหมาย |
| --- | --- |
| `THAIBULKSMS_API_KEY`, `THAIBULKSMS_API_SECRET` | API key / secret จาก ThaiBulkSMS (ตั้งค่า → API Key) ตั้งเป็น **Sensitive** ตั้งครบทั้งสองตัวเมื่อไหร่ ระบบสลับไปเข้าสู่ระบบด้วย OTP ทันที (พนักงานที่ซิงก์จาก ERP เข้าด้วยรหัสผ่านไม่ได้อีก) ยังไม่ตั้ง = รหัสผ่านแบบเดิม |
| `THAIBULKSMS_SENDER` | ชื่อผู้ส่ง (sender) ที่ลงทะเบียนกับ ThaiBulkSMS ว่าง = ค่าเริ่มต้นของเขา |
| `THAIBULKSMS_WEBHOOK_TOKEN` | ความลับท้าย URL ของ webhook ยาวอย่างน้อย 16 ตัวอักษร (`openssl rand -hex 16`) ตั้งเป็น **Sensitive** ใส่ URL `https://<โดเมน>/api/webhooks/thaibulksms/<ค่านี้>` ในหน้าสร้าง API Key ของ ThaiBulkSMS (method GET หรือ POST ก็ได้ ระบบรับ GET/POST/PUT ทั้งหมด; ThaiBulkSMS ให้เลือกได้แค่ GET ในฟอร์ม) ไม่ตั้ง = webhook ปิด (OTP ใช้ได้ปกติ แค่ไม่เห็นผลส่งถึงเครื่อง) |
| `OTP_SMS_DAILY_LIMIT` | เพดานจำนวน SMS OTP ทั้งระบบใน 24 ชม. (ค่าเริ่มต้น 1000) กันค่า SMS บานปลาย |
| `THAIBULKSMS_API_URL` | ใช้เฉพาะทดสอบ (ค่าเริ่มต้น `https://api-v2.thaibulksms.com/sms`) |

ขั้นตอนเปิดใช้: (1) deploy (2) ตั้ง env ข้างบน แล้ว Restart api (3) Admin → "เข้าสู่ระบบด้วย OTP" กด "ส่ง SMS ทดสอบ" ไปที่เบอร์ตัวเองก่อน (4) กด "ซิงก์ตอนนี้" ที่ ซิงก์ ERP เพื่อให้เบอร์ `tel` และตัวทำเครื่องหมายแทนรหัสผ่าน ERP เข้าฐาน (5) ลองเข้าด้วย OTP ด้วย Staff ID ตัวเอง ก่อนบอกพนักงาน เบอร์ของบัญชีที่ซิงก์จาก ERP มาจากฟิลด์ `tel` ใน ERP ใครไม่มีเบอร์ต้องแก้ที่ ERP ย้อนกลับ: ลบ `THAIBULKSMS_API_KEY` / `THAIBULKSMS_API_SECRET` แล้ว Restart (ซิงก์ ERP รอบถัดไปคืนรหัสผ่านให้บัญชี ERP)

#### Environment ของการเชื่อม U POS (D60, F17)

| ตัวแปร | ความหมาย |
| --- | --- |
| `POS_API_KEY` | คีย์ที่ U POS ส่งเป็น `Authorization: Bearer <คีย์>` เมื่อเรียก `/api/integrations/pos/*` ต้องยาวอย่างน้อย 32 ตัวอักษร (สุ่มเอง เช่น `openssl rand -hex 32`) ตั้งเป็น **Sensitive** ใน Coolify ของ api และตั้งค่าเดียวกันฝั่ง U POS (ต้องหมุนพร้อมกันทั้งสองฝั่ง) **ห้ามใส่ใน git/แชต** |

ไม่ตั้ง (หรือสั้นกว่า 32 ตัว) = ปิดการเชื่อม: เส้นทางเหล่านั้นตอบ 404 รายละเอียดสัญญาและข้อความขอให้ทีม U POS ทำฝั่งตัวเอง: `docs/agents/pos-integration.md`

ไม่ตั้ง 3 ตัวแรก = ปิดการซิงก์ (API ยังเริ่มทำงานปกติ แค่ log เตือน) หลังตั้งค่าให้ **Restart** API ครั้งแรกให้กด "ทดลองรัน" ที่หน้า Admin → "ซิงก์ ERP" ดูผลก่อนเสมอ

---

### ขั้นตอนที่ 3: ตั้งค่า Web Application (Frontend)

1. ใน Coolify เลือก **+ New** > **Application** > เลือก Git Repository เดียวกัน
2. ในหน้า Configuration:
   - **Build Pack**: `Dockerfile`
   - **Base Directory**: `/` _(สำคัญมาก: ต้องเป็น Root ของ Monorepo)_
   - **Dockerfile Location**: `/apps/web/Dockerfile`
   - **Port**: `80`
   - **Health Check Path**: `/healthz`
   - **Domain / FQDN**: ตั้งชื่อ Domain หรือใช้ Coolify Generated Domain (เช่น `https://app.yourdomain.com`)
3. ตั้งค่า **Environment Variables**:
   - กำหนด `API_URL` ให้ชี้ไปยัง Internal Container/Host URL ของ API Service:
   ```env
   API_URL=http://<coolify-internal-api-service-name>:3001
   ```
   _(หรือใช้ Public URL ของ API เช่น `https://api.yourdomain.com` ก็ได้)_
4. กด **Save** และ **Deploy**

---

## 3. การตรวจสอบความถูกต้อง (Verification & Troubleshooting)

- **ตรวจสอบ Migration & Startup ของ API**:
  ดู Logs ของ API Container จะต้องพบข้อความ:
  ```text
  [Entrypoint] Running database migrations...
  [Entrypoint] Starting application server...
  ```
- **ทดสอบเรียก API**:
  - `GET https://app.yourdomain.com/healthz` -> ได้รับ `healthy` จาก Nginx
  - `GET https://app.yourdomain.com/health` (หรือ `GET https://api.yourdomain.com/health`) -> ได้รับ `{"status":"ok"}`
- **การเข้าใช้งานครั้งแรก**:
  ล็อกอินด้วย Staff ID และ Password ที่ระบุไว้ใน `BOOTSTRAP_STAFF_ID` และ `BOOTSTRAP_PASSWORD` (ระบบจะให้เปลี่ยนรหัสผ่านในการเข้าใช้งานครั้งแรก)
