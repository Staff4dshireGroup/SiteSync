import crypto from 'crypto';

const IV_LEN = 12;
const TAG_LEN = 16;
const ALGO = 'aes-256-gcm';

function deriveKey(): Buffer {
  const raw = process.env.XERO_TOKEN_ENCRYPTION_KEY?.trim();
  if (raw && raw.length >= 32) {
    return crypto.createHash('sha256').update(raw, 'utf8').digest();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('XERO_TOKEN_ENCRYPTION_KEY is required in production');
  }
  const fallback = process.env.JWT_SECRET || 'dev-xero-key-change-me';
  return crypto.scryptSync(fallback, 'xero-token-salt', 32);
}

/** Encrypt UTF-8 plaintext for at-rest storage. Output is url-safe base64. */
export function encryptAtRest(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}

export function decryptAtRest(payload: string): string {
  const key = deriveKey();
  const buf = Buffer.from(payload, 'base64url');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
