import { NextFunction, Request, Response } from 'express';
import { ZodError, ZodType } from 'zod';
import { AppError } from '../utils/errors';

type Source = 'body' | 'query' | 'params';

/** Validates one part of the request with a Zod schema and replaces it with the parsed value. */
export const validate = (schema: ZodType, source: Source = 'body') => (req: Request, _res: Response, next: NextFunction) => {
  try {
    const parsed = schema.parse(req[source]);
    if (source === 'query') {
      // Express 5 exposes req.query as a getter; store parsed values alongside it.
      (req as Request & { validatedQuery: unknown }).validatedQuery = parsed;
    } else {
      (req as unknown as Record<Source, unknown>)[source] = parsed;
    }
    next();
  } catch (e) {
    if (e instanceof ZodError) {
      const details = e.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
      return next(new AppError('VALIDATION', details[0]?.message ?? 'Invalid request.', 422, details));
    }
    next(e);
  }
};

export const getQuery = <T>(req: Request): T => ((req as Request & { validatedQuery?: T }).validatedQuery ?? (req.query as unknown as T));
