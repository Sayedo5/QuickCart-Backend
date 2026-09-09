import { Request, Response } from 'express';
import { uploadImage, UploadFolder } from '../config/cloudinary';
import { AppError } from '../utils/errors';
import { ok } from '../utils/response';

const FOLDERS: UploadFolder[] = ['products', 'stores', 'riders', 'banners', 'avatars', 'documents'];

/** POST /api/uploads?folder=products  (multipart field "file", or "files" for multiple) */
export const upload = async (req: Request, res: Response) => {
  const folder = String(req.query.folder ?? 'products') as UploadFolder;
  if (!FOLDERS.includes(folder)) throw new AppError('BAD_FOLDER', `folder must be one of ${FOLDERS.join(', ')}.`, 400);
  const files = (req.files as Express.Multer.File[] | undefined) ?? (req.file ? [req.file] : []);
  if (files.length === 0) throw new AppError('NO_FILE', 'Attach an image in the "file" field.', 400);
  // Customers may only upload avatars; admins and riders can use every folder.
  if (req.user!.role === 'CUSTOMER' && folder !== 'avatars') throw new AppError('FORBIDDEN', 'You can only upload a profile photo.', 403);
  const results = await Promise.all(files.map((f) => uploadImage(f.buffer, folder)));
  ok(res, results.length === 1 ? results[0] : results, 'Uploaded.');
};
