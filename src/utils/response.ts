import { Response } from 'express';

/** Every endpoint answers with the same envelope: { success, data, message, error }. */
export const ok = <T>(res: Response, data: T, message?: string, status = 200) =>
  res.status(status).json({ success: true, data, message: message ?? null, error: null });

export const created = <T>(res: Response, data: T, message?: string) => ok(res, data, message, 201);

export interface PageQuery {
  page: number;
  perPage: number;
  skip: number;
}

/** Parses ?page=&perPage= with sane bounds so no endpoint can return unbounded data. */
export const pageQuery = (query: Record<string, unknown>, defaultPerPage = 20, max = 100): PageQuery => {
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(max, Math.max(1, Number(query.perPage) || defaultPerPage));
  return { page, perPage, skip: (page - 1) * perPage };
};

export const paginated = <T>(items: T[], total: number, { page, perPage }: PageQuery) => ({ items, page, perPage, total, totalPages: Math.ceil(total / perPage) });
