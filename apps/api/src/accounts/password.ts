import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
export const IDLE_MS = 8 * 60 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;
const derive = (password: string, salt: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  const [algorithm, salt, key] = hash.split(':');
  if (algorithm !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'hex');
  const actual = await derive(password, salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
