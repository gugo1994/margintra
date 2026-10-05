import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(nodeScrypt);
export const createApiKey = () => {
  const keyId = randomBytes(9).toString('base64url');
  const secretPart = randomBytes(32).toString('base64url');
  return { keyId, secret: `mtr_live_${keyId}_${secretPart}` };
};
export const hashApiKey = async (secret: string): Promise<string> => {
  const salt = randomBytes(16);
  const hash = (await scrypt(secret, salt, 32)) as Buffer;
  return `${salt.toString('base64url')}.${hash.toString('base64url')}`;
};
export const verifyApiKey = async (secret: string, stored: string): Promise<boolean> => {
  const [saltText, hashText] = stored.split('.');
  if (!saltText || !hashText) return false;
  const expected = Buffer.from(hashText, 'base64url');
  const actual = (await scrypt(
    secret,
    Buffer.from(saltText, 'base64url'),
    expected.length,
  )) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};
export const parseKeyId = (secret: string): string | null => {
  const match = /^mtr_live_([A-Za-z0-9_-]{12})_[A-Za-z0-9_-]{43}$/.exec(secret);
  return match?.[1] ?? null;
};
