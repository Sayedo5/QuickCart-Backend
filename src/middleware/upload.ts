import multer from 'multer';
import { AppError } from '../utils/errors';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Memory storage: files are streamed straight to Cloudinary, never written to disk. */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) return cb(new AppError('UNSUPPORTED_FILE', 'Only JPEG, PNG, WebP or GIF images are allowed.', 415));
    cb(null, true);
  },
});
