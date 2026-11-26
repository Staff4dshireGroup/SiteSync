import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { AuthedRequest } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

/**
 * Storage: Cloudflare R2 when R2_* env vars are set (persistent), otherwise local disk
 * (development only; Railway/Render disks are wiped on deploy).
 *
 * Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL
 * (R2_PUBLIC_URL = the bucket's public r2.dev or custom-domain URL, no trailing slash)
 */
const r2Configured = Boolean(
  process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET &&
    process.env.R2_PUBLIC_URL
);

const s3 = r2Configured
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
      },
    })
  : null;

function publicFileBase(req: AuthedRequest): string {
  const fromEnv = process.env.PUBLIC_API_BASE_URL?.replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const host = req.get('host') || 'localhost';
  const forwarded = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const isLocal = /^(localhost|127\.|10\.|192\.168\.)/.test(host);
  const proto = isLocal ? 'http' : forwarded || 'https';
  return `${proto}://${host}`;
}

type UploadedFile = { originalname: string; mimetype: string; buffer: Buffer };

/** Store the file and return its public URL + stored filename. */
async function saveFile(
  req: AuthedRequest,
  folder: 'chat' | 'profile',
  file: UploadedFile
): Promise<{ url: string; filename: string }> {
  const ext = path.extname(file.originalname) || '.bin';
  const filename = `${randomUUID()}${ext}`;

  if (s3) {
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: `${folder}/${filename}`,
        Body: file.buffer,
        ContentType: file.mimetype,
      })
    );
    const base = (process.env.R2_PUBLIC_URL as string).replace(/\/$/, '');
    return { url: `${base}/${folder}/${filename}`, filename };
  }

  const dir = path.join(process.cwd(), 'uploads', folder);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, filename), file.buffer);
  return { url: `${publicFileBase(req)}/files/${folder}/${filename}`, filename };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const profileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

function handler(folder: 'chat' | 'profile') {
  return async (req: AuthedRequest, res: import('express').Response) => {
    const file = (req as AuthedRequest & { file?: UploadedFile }).file;
    if (!file) {
      return res.status(400).json({ error: 'file required (field name: file)' });
    }
    try {
      const { url, filename } = await saveFile(req, folder, file);
      return res.status(201).json({ url, filename, mime_type: file.mimetype });
    } catch (e) {
      console.error('Upload failed', e);
      return res.status(500).json({ error: 'Upload failed' });
    }
  };
}

router.post('/chat', upload.single('file'), handler('chat'));
router.post('/profile', profileUpload.single('file'), handler('profile'));

export default router;
