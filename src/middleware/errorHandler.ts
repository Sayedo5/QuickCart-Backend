import { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { AppError } from '../utils/errors';

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({ success: false, data: null, message: null, error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.originalUrl} does not exist.` } });
};

/** Central error handler: consistent envelope, no stack traces leaked to clients. */
export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  let status = 500;
  let code = 'INTERNAL';
  let message = 'Something went wrong on our side. Please try again.';
  let details: unknown;

  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      status = 409;
      code = 'DUPLICATE';
      message = 'A record with the same unique value already exists.';
      details = err.meta;
    } else if (err.code === 'P2025') {
      status = 404;
      code = 'NOT_FOUND';
      message = 'The requested record was not found.';
    } else {
      status = 400;
      code = `DB_${err.code}`;
      message = 'Database request failed.';
    }
  } else if (err instanceof Prisma.PrismaClientValidationError) {
    status = 400;
    code = 'DB_VALIDATION';
    message = 'Invalid data sent to the database.';
  } else if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
    status = 400;
    code = 'BAD_JSON';
    message = 'Request body is not valid JSON.';
  } else if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'LIMIT_FILE_SIZE') {
    status = 413;
    code = 'FILE_TOO_LARGE';
    message = 'Image must be smaller than 5 MB.';
  }

  if (status >= 500 || !env.isProd) {
    // eslint-disable-next-line no-console
    console.error('[error]', err);
  }

  res.status(status).json({ success: false, data: null, message: null, error: { code, message, details: details ?? undefined } });
};
