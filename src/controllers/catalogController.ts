import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/db';
import { getQuery } from '../middleware/validate';
import { cityOut, deliveryFeeFor, etaFor, findCity, listActiveCities, nearestCity } from '../services/cityService';
import { findValidCoupon, getSettings } from '../services/pricingService';
import { notFound } from '../utils/errors';
import { ok, pageQuery, paginated } from '../utils/response';
import { bannerOut, couponOut, menuCategoryOut, productOut, settingsOut, storeCategoryIn, storeOut } from '../utils/serialize';

/** Public, read-only endpoints used by the customer app. Only approved stores are visible. */

export const listStores = async (req: Request, res: Response) => {
  const q = getQuery<{ page?: number; perPage?: number; q?: string; category?: string; city?: string }>(req);
  const page = pageQuery(q as Record<string, unknown>, 50);
  const where: Prisma.StoreWhereInput = { status: 'APPROVED' };
  // A customer only ever sees stores in the city they picked. "all" is accepted
  // so the admin preview and older builds that never send a city keep working.
  if (q.city && q.city !== 'all') {
    const city = await findCity(q.city);
    where.city = city ? city.name : q.city;
  }
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
  const requestedCity = String(req.query.city ?? '').trim();
  const city = requestedCity && requestedCity !== 'all' ? await findCity(requestedCity) : null;
  // Searching must not surface a Karachi restaurant to someone browsing Lahore.
  const cityFilter = city ? { city: city.name } : requestedCity && requestedCity !== 'all' ? { city: requestedCity } : {};
  const [stores, products] = await Promise.all([
    prisma.store.findMany({ where: { status: 'APPROVED', ...cityFilter, OR: [{ name: { contains: q, mode: 'insensitive' } }, { tags: { hasSome: [q] } }, { area: { contains: q, mode: 'insensitive' } }] }, take: 20 }),
    prisma.product.findMany({
      where: { inStock: true, store: { status: 'APPROVED', ...cityFilter }, OR: [{ name: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] },
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
  const [settings, cities] = await Promise.all([getSettings(), listActiveCities()]);
  // `serviceCity` stays in the payload so already-installed builds keep working;
  // `serviceCities` is what the multi-city app reads.
  ok(res, { ...settingsOut(settings), serviceCities: cities.map(cityOut) });
};

/** GET /cities — the live service cities, for the app's city picker. */
export const listCities = async (_req: Request, res: Response) => {
  ok(res, (await listActiveCities()).map(cityOut));
};

/**
 * GET /cities/resolve?latitude=&longitude= — maps a GPS fix to a service city.
 * Returns `null` (not an error) when the customer is outside every city, so the
 * app can fall back to asking them to choose one.
 */
export const resolveCityFromLocation = async (req: Request, res: Response) => {
  const latitude = Number(req.query.latitude);
  const longitude = Number(req.query.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return ok(res, { city: null, distanceKm: null, supported: false });
  }
  const match = await nearestCity({ latitude, longitude });
  ok(res, match ? { city: cityOut(match.city), distanceKm: match.distanceKm, supported: true } : { city: null, distanceKm: null, supported: false });
};

/**
 * GET /stores/:id/estimate?latitude=&longitude= — the per-city delivery fee and
 * ETA for one store/drop-off pair, so checkout can show the real number before
 * an order exists.
 */
export const storeEstimate = async (req: Request, res: Response) => {
  const store = await prisma.store.findFirst({ where: { id: req.params.id as string, status: 'APPROVED' } });
  if (!store) throw notFound('Store');
  const latitude = Number(req.query.latitude);
  const longitude = Number(req.query.longitude);
  const dropOff = Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
  const settings = await getSettings();
  const city = (await findCity(store.city)) ?? (await findCity(settings.serviceCity));
  if (!city) return ok(res, { city: store.city, deliveryFee: store.deliveryFee, etaMin: store.deliveryTimeMin, etaMax: store.deliveryTimeMax });
  const eta = etaFor(city, store, dropOff);
  ok(res, { city: city.name, deliveryFee: deliveryFeeFor(city, store, dropOff), etaMin: eta.min, etaMax: eta.max, minOrder: Math.max(store.minOrderAmount, city.minOrderAmount) });
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
