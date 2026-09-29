import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({
  path:
    process.env.NODE_ENV === 'production'
      ? 'apps/api/.env'
      : ['apps/api/.env.development', 'apps/api/.env'],
});

export default defineConfig({ schema: 'apps/api/prisma/schema.prisma' });
