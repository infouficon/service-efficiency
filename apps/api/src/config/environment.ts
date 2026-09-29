export function validateEnvironment(config: Record<string, unknown>) {
  const port = Number(config.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  const databaseUrl = config.DATABASE_URL;
  try {
    if (typeof databaseUrl !== 'string') throw new Error();
    const url = new URL(databaseUrl);
    if (
      url.protocol !== 'mysql:' ||
      !url.hostname ||
      !url.pathname ||
      url.pathname === '/'
    )
      throw new Error();
  } catch {
    throw new Error('DATABASE_URL must be a valid MySQL connection URL');
  }
  const origins = String(config.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
        throw new Error();
    } catch {
      throw new Error(
        'CORS_ORIGINS must contain comma-separated HTTP(S) origins',
      );
    }
  }
  return {
    ...config,
    PORT: port,
    HOST: config.HOST ?? '0.0.0.0',
    CORS_ORIGINS: origins,
  };
}
