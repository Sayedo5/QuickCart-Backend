import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/db';
import { getQuery } from '../middleware/validate';
import { findValidCoupon, getSettings } from '../services/pricingService';
import { notFound } from '../utils/errors';
import { ok, pageQuery, paginated } from '../utils/response';
import { bannerOut, couponOut, menuCategoryOut, productOut, settingsOut, storeCategoryIn, storeOut } from '../utils/serialize';

/** Public, read-only endpoints used by the customer app. Only approved stores are visible. */

export const listStores = async (req: Request, res: Response) => {
  const q = getQuery<{ page?: number; perPage?: number; q?: string; category?: string }>(req);
  const page = pageQuery(q as Record<string, unknown>, 50);
  const where: Prisma.StoreWhereInput = { status: 'APPROVED' };
  if (q.category && q.category !== 'all') where.category = storeCategoryIn(q.category);
  if (q.q) where.OR = [{ name: { contains: q.q, mode: 'insensitive' } }, { tags: { hasSome: [q.q] } }, { area: { contains: q.q, mode: 'insensitive' } }];
  const [rows, total] = await Promise.all([
    prisma.store.findMany({ where, orderBy: [{ isOpen: 'desc' }, { rating: 'desc' }], skip: page.skip, take: page.perPage }),
    prisma.store.count({ where }),
  ]);
  ok(res, paginated(rows.map(storeOut), total, page));
};

export const getStore = async (req: Request, res: Response) => {
  const store = await prisma.store.findFirst({ where: { id: req.params.id as string, status: 'APPROVED' } });
  if (!store) throw notFound('Store');
  ok(res, storeOut(store));
};

export const getMenu = async (req: Request, res: Response) => {
  const storeId = req.params.id as string;
  const store = await prisma.store.findFirst({ where: { id: storeId, status: 'APPROVED' }, select: { id: true } });
  if (!store) throw notFound('Store');
  const [categories, products] = await Promise.all([
    prisma.menuCategory.findMany({ where: { storeId }, orderBy: { sortOrder: 'asc' } }),
    prisma.product.findMany({ where: { storeId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
  ]);
  ok(res, { categories: categories.map(menuCategoryOut), products: products.map(productOut) });
};

export const search = async (req: Request, res: Response) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return ok(res, { stores: [], products: [] });
  const [stores, products] = await Promise.all([
    prisma.store.findMany({ where: { status: 'APPROVED', OR: [{ name: { contains: q, mode: 'insensitive' } }, { tags: { hasSome: [q] } }, { area: { contains: q, mode: 'insensitive' } }] }, take: 20 }),
    prisma.product.findMany({
      where: { inStock: true, store: { status: 'APPROVED' }, OR: [{ name: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] },
      include: { store: true },
      take: 30,
    }),
  ]);
  ok(res, { stores: stores.map(storeOut), products: products.map((p) => ({ ...productOut(p), store: storeOut(p.store) })) });
};

export const listCategories = async (_req: Request, res: Response) => {
  const rows = await prisma.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  ok(res, rows);
};

export const listBanners = async (_req: Request, res: Response) => {
  const now = new Date();
  const rows = await prisma.banner.findMany({
    where: { isActive: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] },
    orderBy: { sortOrder: 'asc' },
  });
  ok(res, rows.map(bannerOut));
};

export const listCoupons = async (_req: Request, res: Response) => {
  const rows = await prisma.coupon.findMany({ where: { isActive: true, expiryDate: { gte: new Date() } }, orderBy: { createdAt: 'asc' } });
  ok(res, rows.map(couponOut));
};

export const validateCoupon = async (req: Request, res: Response) => {
  const { code, subtotal } = req.body as { code: string; subtotal: number };
  const coupon = await findValidCoupon(code, subtotal);
  ok(res, couponOut(coupon));
};

export const publicSettings = async (_req: Request, res: Response) => {
  ok(res, settingsOut(await getSettings()));
};

export const listFaqs = async (_req: Request, res: Response) => {
  const rows = await prisma.faq.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  ok(res, rows.map((f) => ({ id: f.id, question: f.question, answer: f.answer })));
};

export const listStoreReviews = async (req: Request, res: Response) => {
  const page = pageQuery(req.query as Record<string, unknown>, 20);
  const where: Prisma.ReviewWhereInput = { storeId: req.params.id as string, isApproved: true };
  const [rows, total] = await Promise.all([
    prisma.review.findMany({ where, include: { user: { select: { name: true, avatarUrl: true } } }, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.perPage }),
    prisma.review.count({ where }),
  ]);
  ok(res, paginated(rows.map((r) => ({ id: r.id, stars: r.rating, comment: r.comment ?? undefined, tags: r.tags, userName: r.user.name, userAvatar: r.user.avatarUrl ?? undefined, createdAt: r.createdAt.toISOString() })), total, page));
};
