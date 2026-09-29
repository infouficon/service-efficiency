import { PrismaClient, RoleCode } from '@prisma/client';
import { hashPassword } from '../dist/accounts/password.js';
import { config } from 'dotenv';
config({
  path:
    process.env.NODE_ENV === 'production'
      ? '.env'
      : ['.env.development', '.env'],
});
async function main() {
  const password = process.env.BOOTSTRAP_PASSWORD;
  const staffId = process.env.BOOTSTRAP_STAFF_ID;
  const firstName = process.env.BOOTSTRAP_FIRST_NAME || '';
  const lastName = process.env.BOOTSTRAP_LAST_NAME || '';
  if (!staffId || !password || password.length < 8)
    throw new Error(
      'Set BOOTSTRAP_STAFF_ID and BOOTSTRAP_PASSWORD (at least 8 characters) in the process environment.',
    );
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM AccountLock WHERE id = 1 FOR UPDATE`;
      if (await tx.staff.count())
        throw new Error(
          'Bootstrap only works on an empty Staff table. Existing accounts are never overwritten.',
        );
      for (const code of Object.values(RoleCode))
        await tx.role.upsert({ where: { code }, create: { code }, update: {} });
      await tx.staff.create({
        data: {
          staffId,
          firstName,
          lastName,
          passwordHash: await hashPassword(password),
          roles: { create: { roleCode: 'ADMIN' } },
          mustChangePassword: true,
        },
      });
    });
    console.log(
      'Initial ADMIN created; password change required on first login.',
    );
  } finally {
    await prisma.$disconnect();
  }
}
main().catch(() => {
  console.error(
    'Bootstrap failed: check configuration, migrations and whether Staff already exists.',
  );
  process.exitCode = 1;
});
