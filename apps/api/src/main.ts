import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createApplication } from './bootstrap';
async function bootstrap(): Promise<void> {
  const app = await createApplication();
  const config = app.get(ConfigService);
  await app.listen(
    config.getOrThrow<number>('PORT'),
    config.getOrThrow<string>('HOST'),
  );
}

void bootstrap().catch(() => {
  Logger.error(
    'API startup failed. Check environment configuration and port availability.',
    'Bootstrap',
  );
  process.exitCode = 1;
});
