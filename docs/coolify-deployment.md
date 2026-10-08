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
