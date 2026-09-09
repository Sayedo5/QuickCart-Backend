import { Router } from 'express';
import { upload } from '../controllers/uploadController';
import { requireAuth } from '../middleware/auth';
import { imageUpload } from '../middleware/upload';
import { wrap } from '../utils/asyncHandler';

export const uploadRoutes = Router();

uploadRoutes.post('/', requireAuth, imageUpload.fields([{ name: 'file', maxCount: 1 }, { name: 'files', maxCount: 5 }]), (req, _res, next) => {
  // Flatten multer's field map into req.files for the controller.
  const map = req.files as Record<string, Express.Multer.File[]> | undefined;
  if (map) req.files = [...(map.file ?? []), ...(map.files ?? [])];
  next();
}, wrap(upload));
