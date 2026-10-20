import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import { AccountsService } from '../accounts/accounts.service';
import { PosModule } from '../pos/pos.module';

/**
 * API documentation pages (D84), generated from the code (OpenAPI via @nestjs/swagger), so they cannot drift from it:
 *
 * - `/api/docs` (+ `/api/docs-json`): EVERY endpoint, for the team. ADMIN login required (the page is served by the API
 *   itself, so the session cookie of ses.uficon.com is what gets you in); read-only (no "Try it out").
 * - `/api/pos-docs` (+ `/api/pos-docs-json`): only the U POS integration (D60), public like any contract: the endpoints
 *   are useless without the bearer key. "Try it out" works there once the key is entered.
 */
export function setupApiDocs(app: INestApplication) {
  const accounts = app.get(AccountsService);

  const adminOnly = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await accounts.authenticate(req);
      if (!user.roles.includes('ADMIN')) {
        res.status(403).json({ message: 'Access restricted to ADMIN' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      next();
    } catch {
      res.status(401).json({ message: 'กรุณาเข้าสู่ระบบด้วยบัญชี ADMIN แล้วเปิดหน้านี้ใหม่' });
    }
  };
  app.use(['/api/docs', '/api/docs-json'], (req: Request, res: Response, next: NextFunction) => {
    void adminOnly(req, res, next);
  });

  const all = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Service Efficiency System API')
      .setVersion('1')
      .setDescription(
        [
          'ทุก endpoint ของ SES (สร้างจากโค้ด) — เฉพาะ ADMIN ที่เห็นหน้านี้',
          '',
          '- ยืนยันตัวตนด้วย cookie `se_session` (ได้จาก `POST /api/auth/login`)',
          '- คำขอที่เปลี่ยนข้อมูล (POST/PUT/PATCH/DELETE) ต้องส่ง `Origin` ที่อยู่ใน `CORS_ORIGINS` และ header `X-Requested-With: ServiceEfficiency`',
          '- `/api/integrations/pos/*` ใช้ `Authorization: Bearer <POS_API_KEY>` แทน cookie (ดู `/api/pos-docs`)',
          '- สิทธิ์ตาม role (ADMIN / MANAGER / STAFF / STOCK / CASHIER) อยู่ในคำอธิบายของแต่ละ endpoint และใน docs/agents/permissions',
        ].join('\n'),
      )
      .addCookieAuth('se_session')
      .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'pos-key')
      .build(),
  );
  tagByPath(all);
  SwaggerModule.setup('docs', app, all, {
    useGlobalPrefix: true,
    customSiteTitle: 'SES API',
    swaggerOptions: {
      supportedSubmitMethods: [],
      docExpansion: 'none',
      tagsSorter: 'alpha',
      filter: true,
    },
  });

  const pos = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('SES ↔ U POS integration API')
      .setVersion('1')
      .setDescription(
        [
          'สัญญา API ระหว่าง SES กับ U POS (D60): ดึงออเดอร์ที่รอเปิดบิล และแจ้งกลับเมื่อเปิดบิลจริง',
          '',
          '- Base URL: `https://ses.uficon.com/api` · server ต่อ server · JSON',
          '- `Authorization: Bearer <POS_API_KEY>` (ขอคีย์จากเจ้าของระบบ ห้ามวางในแชต/issue)',
          '- ยังไม่ตั้งคีย์ที่ SES (หรือสั้นกว่า 32 ตัวอักษร) → **404** ทุก endpoint · คีย์ผิด → **401**',
          '- ไม่มีราคาในข้อมูลใด ๆ: SES ไม่เก็บราคา',
          '- เอกสารเต็ม: docs/agents/pos-integration.md',
        ].join('\n'),
      )
      .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'pos-key')
      .build(),
    { include: [PosModule] },
  );
  tagByPath(pos);
  SwaggerModule.setup('pos-docs', app, pos, {
    useGlobalPrefix: true,
    customSiteTitle: 'SES ↔ U POS API',
    swaggerOptions: { docExpansion: 'list' },
  });
}

/**
 * Swagger already tags each operation with its controller ("Categories", "PaymentMethods" …); an operation without a tag is
 * filed under the first segment of its path. The document's tag list is rebuilt so the UI shows the groups in order.
 */
function tagByPath(document: OpenAPIObject) {
  const tags = new Set<string>();
  for (const [path, item] of Object.entries(document.paths)) {
    const fallback = path.split('/').filter(Boolean)[1] ?? 'root';
    for (const operation of Object.values(item as Record<string, { tags?: string[] }>)) {
      if (!operation || typeof operation !== 'object') continue;
      if (!operation.tags?.length) operation.tags = [fallback];
      for (const tag of operation.tags) tags.add(tag);
    }
  }
  document.tags = [...tags].sort().map((name) => ({ name }));
}
