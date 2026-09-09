import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { env } from './env';
import { AppError } from '../utils/errors';

if (env.cloudinaryEnabled) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

export type UploadFolder = 'products' | 'stores' | 'riders' | 'banners' | 'avatars' | 'documents';

/** Streams a buffer to Cloudinary and returns the secure URL + public id. */
export const uploadImage = (buffer: Buffer, folder: UploadFolder): Promise<{ url: string; publicId: string }> => {
  if (!env.cloudinaryEnabled) {
    throw new AppError('UPLOADS_DISABLED', 'Image uploads are not configured. Set the CLOUDINARY_* environment variables.', 503);
  }
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `quickcart/${folder}`,
        resource_type: 'image',
        transformation: [{ width: 1600, height: 1600, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
      },
      (error, result?: UploadApiResponse) => {
        if (error || !result) return reject(new AppError('UPLOAD_FAILED', error?.message ?? 'Upload failed', 502));
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    stream.end(buffer);
  });
};

export const deleteImage = async (publicId: string) => {
  if (!env.cloudinaryEnabled) return;
  await cloudinary.uploader.destroy(publicId).catch(() => undefined);
};
