/** Application error with a stable machine-readable code and HTTP status. */
export class AppError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found.`, 404);
export const unauthorized = (message = 'Please sign in to continue.') => new AppError('UNAUTHORIZED', message, 401);
export const forbidden = (message = 'You do not have permission to do that.') => new AppError('FORBIDDEN', message, 403);
export const badRequest = (message: string, code = 'BAD_REQUEST', details?: unknown) => new AppError(code, message, 400, details);
