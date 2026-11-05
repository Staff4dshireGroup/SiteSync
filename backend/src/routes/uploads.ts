import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import type { AuthedRequest } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

const uploadRoot = path.join(process.cwd(), 'uploads', 'chat');
const profileUploadRoot = path.join(process.cwd(), 'uploads', 'profile');
const vehicleUploadRoot = path.join(process.cwd(), 'uploads', 'vehicle');

async function ensureUploadDir(): Promise<void> {
  await fs.promises.mkdir(uploadRoot, { recursive: true });
}

async function ensureProfileDir(): Promise<void> {
  await fs.promises.mkdir(profileUploadRoot, { recursive: true });
}

async function ensureVehicleDir(): Promise<void> {
  await fs.promises.mkdir(vehicleUploadRoot, { recursive: true });
}

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await ensureUploadDir();
      cb(null, uploadRoot);
    } catch (e) {
      cb(e as Error, uploadRoot);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
});

const profileStorage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await ensureProfileDir();
      cb(null, profileUploadRoot);
    } catch (e) {
      cb(e as Error, profileUploadRoot);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    cb(null, `${randomUUID()}${ext}`);
  },
});

const profileUpload = multer({
  storage: profileStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
});

const vehicleStorage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try {
      await ensureVehicleDir();
      cb(null, vehicleUploadRoot);
    } catch (e) {
      cb(e as Error, vehicleUploadRoot);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    cb(null, `${randomUUID()}${ext}`);
  },
});

const vehicleUpload = multer({
  storage: vehicleStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
});

function publicFileBase(req: AuthedRequest): string {
  const fromEnv = process.env.PUBLIC_API_BASE_URL?.replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const host = req.get('host') || 'localhost';
  const proto = req.protocol === 'http' && host.includes('localhost') ? 'http' : req.protocol;
  return `${proto}://${host}`;
}

router.post('/chat', upload.single('file'), (req: AuthedRequest, res) => {
  const file = (req as AuthedRequest & { file?: { filename: string; mimetype: string } }).file;
  if (!file) {
    return res.status(400).json({ error: 'file required (field name: file)' });
  }
  const base = publicFileBase(req);
  const url = `${base}/files/chat/${file.filename}`;
  res.status(201).json({
    url,
    filename: file.filename,
    mime_type: file.mimetype,
  });
});

router.post('/vehicle', vehicleUpload.single('file'), (req: AuthedRequest, res) => {
  const file = (req as AuthedRequest & { file?: { filename: string; mimetype: string } }).file;
  if (!file) {
    return res.status(400).json({ error: 'file required (field name: file)' });
  }
  const base = publicFileBase(req);
  const url = `${base}/files/vehicle/${file.filename}`;
  res.status(201).json({
    url,
    filename: file.filename,
    mime_type: file.mimetype,
  });
});

router.post('/profile', profileUpload.single('file'), (req: AuthedRequest, res) => {
  const file = (req as AuthedRequest & { file?: { filename: string; mimetype: string } }).file;
  if (!file) {
    return res.status(400).json({ error: 'file required (field name: file)' });
  }
  const base = publicFileBase(req);
  const url = `${base}/files/profile/${file.filename}`;
  res.status(201).json({
    url,
    filename: file.filename,
    mime_type: file.mimetype,
  });
});

export default router;
