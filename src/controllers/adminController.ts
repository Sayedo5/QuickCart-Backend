import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/db';
import { getQuery } from '../middleware/validate';
import { broadcast } from '../services/notificationService';
import { getSettings } from '../services/pricingService';
import { emitToAdmins } from '../sockets/orderSocket';
import { AppError, notFound } from '../utils/errors';
import { created, ok, pageQuery, paginated } from '../utils/response';
import { bannerOut, couponOut, menuCategoryOut, orderOut, OrderWithRelations, productOut, settingsOut, storeCategoryIn, storeOut, userOut } from '../utils/serialize';
import { ORDER_INCLUDE } from './orderController';

const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// ───────────────────────── Dashboard ─────────────────────────

export const stats = async (_req: Request, res: Response) => {
  const today = startOfDay();
  const weekAgo = new Date(today.getTime() - 6 * 86_400_000);
  const monthAgo = new Date(today.getTime() - 29 * 86_400_000);
  const [ordersToday, revenueToday, ordersMonth, revenueMonth, activeRiders, pendingRiders, pendingStores, customers, activeOrders, lowStock, recent, last7] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: today }, status: { not: 'CANCELLED' } } }),
    prisma.order.aggregate({ where: { createdAt: { gte: today }, status: { not: 'CANCELLED' } }, _sum: { total: true } }),
    prisma.order.count({ where: { createdAt: { gte: monthAgo }, status: { not: 'CANCELLED' } } }),
    prisma.order.aggregate({ where: { createdAt: { gte: monthAgo }, status: { not: 'CANCELLED' } }, _sum: { total: true } }),
    prisma.rider.count({ where: { status: 'APPROVED', isAvailable: true } }),
    prisma.rider.count({ where: { status: 'PENDING' } }),
    prisma.store.count({ where: { status: 'PENDING' } }),
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.order.count({ where: { status: { in: ['PLACED', 'CONFIRMED', 'PREPARING', 'PICKED_UP'] } } }),
    prisma.product.count({ where: { inStock: false } }),
    prisma.order.findMany({ include: ORDER_INCLUDE, orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.order.findMany({ where: { createdAt: { gte: weekAgo }, status: { not: 'CANCELLED' } }, select: { createdAt: true, total: true } }),
  ]);

  const series = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(weekAgo.getTime() + i * 86_400_000);
    const key = day.toISOString().slice(0, 10);
    return { date: key, orders: 0, revenue: 0 };
  });
  last7.forEach((o) => {
    const key = startOfDay(o.createdAt).toISOString().slice(0, 10);
    const bucket = series.find((s) => s.date === key);
    if (bucket) {
      bucket.orders += 1;
      bucket.revenue += o.total;
    }
  });

  const topProducts = await prisma.orderItem.groupBy({ by: ['name'], _sum: { quantity: true }, orderBy: { _sum: { quantity: 'desc' } }, take: 5, where: { order: { createdAt: { gte: monthAgo }, status: { not: 'CANCELLED' } } } });

  ok(res, {
    ordersToday,
    revenueToday: revenueToday._sum.total ?? 0,
    ordersMonth,
    revenueMonth: revenueMonth._sum.total ?? 0,
    activeRiders,
    pendingRiders,
    pendingStores,
    pendingApprovals: pendingRiders + pendingStores,
    customers,
    activeOrders,
    lowStock,
    series,
    topProducts: topProducts.map((p) => ({ name: p.name, quantity: p._sum.quantity ?? 0 })),
    recentOrders: recent.map((o) => orderOut(o as OrderWithRelations)),
  });
};

// ───────────────────────── Users ─────────────────────────

export const listUsers = async (req: Request, res: Response) => {
  const q = getQuery<{ page?: number; perPage?: number; q?: string; role?: string }>(req);
  const page = pageQuery(q as Record<string, unknown>, 25);
  const where: Prisma.UserWhereInput = {};
  if (q.role && q.role !== 'all') where.role = q.role.toUpperCase() as Prisma.UserWhereInput['role'];
  if (q.q) where.OR = [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }];
  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.perPage, include: { _count: { select: { orders: true } } } }),
    prisma.user.count({ where }),
  ]);
  ok(res, paginated(rows.map((u) => ({ ...userOut(u), orderCount: u._count.orders })), total, page));
};

export const getUser = async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id as string }, include: { addresses: true, orders: { include: ORDER_INCLUDE, orderBy: { createdAt: 'desc' }, take: 20 } } });
  if (!user) throw notFound('User');
  ok(res, { ...userOut(user), addresses: user.addresses, orders: user.orders.map((o) => orderOut(o as OrderWithRelations)) });
};

export const setBlocked = async (req: Request, res: Response) => {
  const { blocked } = req.body as { blocked: boolean };
  const user = await prisma.user.findUnique({ where: { id: req.params.id as string } });
  if (!user) throw notFound('User');
  if (user.role === 'ADMIN') throw new AppError('CANNOT_BLOCK_ADMIN', 'Admin accounts cannot be blocked from here.', 400);
  const updated = await prisma.user.update({ where: { id: user.id }, data: { isBlocked: blocked } });
  if (blocked) await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  ok(res, userOut(updated), blocked ? 'User blocked.' : 'User unblocked.');
};

export const createAdmin = async (req: Request, res: Response) => {
  const { name, email, password } = req.body as { name: string; email: string; password: string };
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({ where: { email }, update: { role: 'ADMIN', passwordHash, name }, create: { email, name, role: 'ADMIN', passwordHash, isVerified: true } });
  created(res, userOut(user), 'Admin account ready.');
};

// ───────────────────────── Stores ─────────────────────────

type StoreBody = { name: string; category: string; area: string; address: string; description?: string | null; image?: string | null; coverImage?: string | null; location: { latitude: number; longitude: number }; deliveryTimeMin: number; deliveryTimeMax: number; deliveryFee: number; minOrder: number; distanceKm?: number | null; tags: string[]; promoLabel?: string | null; isOpen: boolean; ownerName?: string | null; ownerContact?: string | null };

const storeData = (b: Partial<StoreBody>): Prisma.StoreUpdateInput => ({
  name: b.name,
  category: b.category ? storeCategoryIn(b.category) : undefined,
  area: b.area,
  address: b.address,
  description: b.description,
  imageUrl: b.image,
  coverImageUrl: b.coverImage,
  lat: b.location?.latitude,
  lng: b.location?.longitude,
  deliveryTimeMin: b.deliveryTimeMin,
  deliveryTimeMax: b.deliveryTimeMax,
  deliveryFee: b.deliveryFee,
  minOrderAmount: b.minOrder,
  distanceKm: b.distanceKm,
  tags: b.tags,
  promoLabel: b.promoLabel,
  isOpen: b.isOpen,
  ownerName: b.ownerName,
  ownerContact: b.ownerContact,
});

export const listStores = async (req: Request, res: Response) => {
  const q = getQuery<{ page?: number; perPage?: number; q?: string; status?: string; category?: string }>(req);
  const page = pageQuery(q as Record<string, unknown>, 25);
  const where: Prisma.StoreWhereInput = {};
  if (q.status && q.status !== 'all') where.status = q.status.toUpperCase() as Prisma.StoreWhereInput['status'];
  if (q.category && q.category !== 'all') where.category = storeCategoryIn(q.category);
  if (q.q) where.OR = [{ name: { contains: q.q, mode: 'insensitive' } }, { area: { contains: q.q, mode: 'insensitive' } }];
  const [rows, total] = await Promise.all([
    prisma.store.findMany({ where, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], skip: page.skip, take: page.perPage, include: { _count: { select: { products: true, orders: true } } } }),
    prisma.store.count({ where }),
  ]);
  ok(res, paginated(rows.map((s) => ({ ...storeOut(s), productCount: s._count.products, orderCount: s._count.orders })), total, page));
};

export const getStore = async (req: Request, res: Response) => {
  const store = await prisma.store.findUnique({ where: { id: req.params.id as string }, include: { menuCategories: { orderBy: { sortOrder: 'asc' } }, products: { orderBy: { sortOrder: 'asc' } } } });
  if (!store) throw notFound('Store');
  ok(res, { ...storeOut(store), menuCategories: store.menuCategories.map(menuCategoryOut), products: store.products.map(productOut) });
};

export const createStore = async (req: Request, res: Response) => {
  const b = req.body as StoreBody;
  const store = await prisma.store.create({ data: { ...(storeData(b) as Prisma.StoreCreateInput), name: b.name, category: storeCategoryIn(b.category), area: b.area, address: b.address, lat: b.location.latitude, lng: b.location.longitude, status: 'APPROVED' } });
  emitToAdmins('store:updated', storeOut(store));
  created(res, storeOut(store), 'Store created.');
};

/** Public store application (pending until approved). */
export const applyStore = async (req: Request, res: Response) => {
  const b = req.body as Pick<StoreBody, 'name' | 'category' | 'area' | 'address' | 'description' | 'location' | 'ownerName' | 'ownerContact' | 'image'>;
  const store = await prisma.store.create({ data: { name: b.name, category: storeCategoryIn(b.category), area: b.area, address: b.address, description: b.description ?? null, imageUrl: b.image ?? null, lat: b.location.latitude, lng: b.location.longitude, ownerName: b.ownerName ?? null, ownerContact: b.ownerContact ?? null, status: 'PENDING', isOpen: false } });
  emitToAdmins('store:updated', storeOut(store));
  created(res, storeOut(store), 'Application received. Our team will review it shortly.');
};

export const updateStore = async (req: Request, res: Response) => {
  const existing = await prisma.store.findUnique({ where: { id: req.params.id as string } });
  if (!existing) throw notFound('Store');
  const store = await prisma.store.update({ where: { id: existing.id }, data: storeData(req.body as Partial<StoreBody>) });
  emitToAdmins('store:updated', storeOut(store));
  ok(res, storeOut(store), 'Store updated.');
};

export const setStoreApproval = async (req: Request, res: Response) => {
  const existing = await prisma.store.findUnique({ where: { id: req.params.id as string } });
  if (!existing) throw notFound('Store');
  const { status, reason } = req.body as { status: 'approved' | 'rejected' | 'suspended' | 'pending'; reason?: string };
  const store = await prisma.store.update({
    where: { id: existing.id },
    data: { status: status.toUpperCase() as Prisma.StoreUpdateInput['status'], rejectionReason: status === 'rejected' || status === 'suspended' ? (reason ?? null) : null, isOpen: status === 'approved' ? existing.isOpen : false },
  });
  emitToAdmins('store:updated', storeOut(store));
  ok(res, storeOut(store), `Store ${status}.`);
};

export const deleteStore = async (req: Request, res: Response) => {
  const existing = await prisma.store.findUnique({ where: { id: req.params.id as string } });
  if (!existing) throw notFound('Store');
  const active = await prisma.order.count({ where: { storeId: existing.id, status: { in: ['PLACED', 'CONFIRMED', 'PREPARING', 'PICKED_UP'] } } });
  if (active > 0) throw new AppError('STORE_HAS_ORDERS', 'This store has active orders. Complete or cancel them first.', 409);
  const orders = await prisma.order.count({ where: { storeId: existing.id } });
  if (orders > 0) {
    // Keep order history intact: suspend instead of hard delete.
    const store = await prisma.store.update({ where: { id: existing.id }, data: { status: 'SUSPENDED', isOpen: false } });
    return ok(res, storeOut(store), 'Store has past orders, so it was suspended instead of deleted.');
  }
  await prisma.store.delete({ where: { id: existing.id } });
  ok(res, null, 'Store deleted.');
};

// ───────────────────────── Menu categories & products ─────────────────────────

export const createMenuCategory = async (req: Request, res: Response) => {
  const storeId = req.params.id as string;
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true } });
  if (!store) throw notFound('Store');
  const { name, sortOrder } = req.body as { name: string; sortOrder: number };
  created(res, menuCategoryOut(await prisma.menuCategory.create({ data: { storeId, name, sortOrder } })));
};

export const updateMenuCategory = async (req: Request, res: Response) => {
  const { name, sortOrder } = req.body as { name?: string; sortOrder?: number };
  ok(res, menuCategoryOut(await prisma.menuCategory.update({ where: { id: req.params.id as string }, data: { name, sortOrder } })));
};

export const deleteMenuCategory = async (req: Request, res: Response) => {
  await prisma.menuCategory.delete({ where: { id: req.params.id as string } });
  ok(res, null, 'Menu section deleted. Its products are now uncategorised.');
};

type ProductBody = { storeId: string; menuCategoryId?: string | null; name: string; description?: string | null; price: number; compareAtPrice?: number | null; discountPercent: number; image?: string | null; unit?: string | null; isVeg?: boolean | null; isPopular: boolean; inStock: boolean; sortOrder: number };

export const listProducts = async (req: Request, res: Response) => {
  const q = getQuery<{ page?: number; perPage?: number; q?: string; storeId?: string; inStock?: string }>(req);
  const page = pageQuery(q as Record<string, unknown>, 50);
  const where: Prisma.ProductWhereInput = {};
  if (q.storeId) where.storeId = q.storeId;
  if (q.inStock === 'true') where.inStock = true;
  if (q.inStock === 'false') where.inStock = false;
  if (q.q) where.name = { contains: q.q, mode: 'insensitive' };
  const [rows, total] = await Promise.all([
    prisma.product.findMany({ where, include: { store: { select: { name: true } }, menuCategory: { select: { name: true } } }, orderBy: [{ storeId: 'asc' }, { sortOrder: 'asc' }], skip: page.skip, take: page.perPage }),
    prisma.product.count({ where }),
  ]);
  ok(res, paginated(rows.map((p) => ({ ...productOut(p), storeName: p.store.name, categoryName: p.menuCategory?.name })), total, page));
};

export const createProduct = async (req: Request, res: Response) => {
  const b = req.body as ProductBody;
  const store = await prisma.store.findUnique({ where: { id: b.storeId }, select: { id: true } });
  if (!store) throw notFound('Store');
  const product = await prisma.product.create({
    data: { storeId: b.storeId, menuCategoryId: b.menuCategoryId ?? null, name: b.name, description: b.description ?? null, price: b.price, compareAtPrice: b.compareAtPrice ?? null, discountPercent: b.discountPercent, imageUrl: b.image ?? null, unit: b.unit ?? null, isVeg: b.isVeg ?? null, isPopular: b.isPopular, inStock: b.inStock, sortOrder: b.sortOrder },
  });
  created(res, productOut(product), 'Product created.');
};

export const updateProduct = async (req: Request, res: Response) => {
  const b = req.body as Partial<ProductBody>;
  const product = await prisma.product.update({
    where: { id: req.params.id as string },
    data: { menuCategoryId: b.menuCategoryId, name: b.name, description: b.description, price: b.price, compareAtPrice: b.compareAtPrice, discountPercent: b.discountPercent, imageUrl: b.image, unit: b.unit, isVeg: b.isVeg, isPopular: b.isPopular, inStock: b.inStock, sortOrder: b.sortOrder },
  });
  ok(res, productOut(product), 'Product updated.');
};

export const deleteProduct = async (req: Request, res: Response) => {
  await prisma.product.delete({ where: { id: req.params.id as string } });
  ok(res, null, 'Product deleted.');
};

// ───────────────────────── Categories, banners, coupons, FAQs ─────────────────────────

export const listCategoriesAdmin = async (_req: Request, res: Response) => ok(res, await prisma.category.findMany({ orderBy: { sortOrder: 'asc' } }));
export const createCategory = async (req: Request, res: Response) => created(res, await prisma.category.create({ data: req.body }));
export const updateCategory = async (req: Request, res: Response) => ok(res, await prisma.category.update({ where: { id: req.params.id as string }, data: req.body }));
export const deleteCategory = async (req: Request, res: Response) => {
  await prisma.category.delete({ where: { id: req.params.id as string } });
  ok(res, null, 'Category deleted.');
};

type BannerBody = { title: string; subtitle?: string | null; label?: string | null; image?: string | null; targetType: string; targetValue?: string | null; colorFrom: string; colorTo: string; sortOrder: number; isActive: boolean; startsAt?: string | null; endsAt?: string | null };
const bannerData = (b: Partial<BannerBody>): Prisma.BannerUpdateInput => ({
  title: b.title,
  subtitle: b.subtitle,
  label: b.label,
  imageUrl: b.image,
  targetType: b.targetType ? (b.targetType.toUpperCase() as Prisma.BannerUpdateInput['targetType']) : undefined,
  targetValue: b.targetValue,
  colorFrom: b.colorFrom,
  colorTo: b.colorTo,
  sortOrder: b.sortOrder,
  isActive: b.isActive,
  startsAt: b.startsAt === undefined ? undefined : b.startsAt ? new Date(b.startsAt) : null,
  endsAt: b.endsAt === undefined ? undefined : b.endsAt ? new Date(b.endsAt) : null,
});

export const listBannersAdmin = async (_req: Request, res: Response) => ok(res, (await prisma.banner.findMany({ orderBy: { sortOrder: 'asc' } })).map(bannerOut));
export const createBanner = async (req: Request, res: Response) => {
  const b = req.body as BannerBody;
  created(res, bannerOut(await prisma.banner.create({ data: { ...(bannerData(b) as Prisma.BannerCreateInput), title: b.title } })), 'Banner created.');
};
export const updateBanner = async (req: Request, res: Response) => ok(res, bannerOut(await prisma.banner.update({ where: { id: req.params.id as string }, data: bannerData(req.body as Partial<BannerBody>) })), 'Banner updated.');
export const deleteBanner = async (req: Request, res: Response) => {
  await prisma.banner.delete({ where: { id: req.params.id as string } });
  ok(res, null, 'Banner deleted.');
};

type CouponBody = { code: string; description: string; type: 'percent' | 'fixed' | 'free_delivery'; value: number; maxDiscount?: number | null; minOrder: number; expiryDate: string; isActive: boolean; usageLimit?: number | null };
const couponData = (b: Partial<CouponBody>): Prisma.CouponUpdateInput => ({
  code: b.code,
  description: b.description,
  discountType: b.type ? (b.type === 'percent' ? 'PERCENT' : b.type === 'fixed' ? 'FLAT' : 'FREE_DELIVERY') : undefined,
  discountValue: b.value,
  maxDiscount: b.maxDiscount,
  minOrderAmount: b.minOrder,
  expiryDate: b.expiryDate ? new Date(b.expiryDate) : undefined,
  isActive: b.isActive,
  usageLimit: b.usageLimit,
});

export const listCouponsAdmin = async (_req: Request, res: Response) => ok(res, (await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } })).map(couponOut));
export const createCoupon = async (req: Request, res: Response) => {
  const b = req.body as CouponBody;
  created(res, couponOut(await prisma.coupon.create({ data: { ...(couponData(b) as Prisma.CouponCreateInput), code: b.code, description: b.description, expiryDate: new Date(b.expiryDate) } })), 'Coupon created.');
};
export const updateCoupon = async (req: Request, res: Response) => ok(res, couponOut(await prisma.coupon.update({ where: { id: req.params.id as string }, data: couponData(req.body as Partial<CouponBody>) })), 'Coupon updated.');
export const deleteCoupon = async (req: Request, res: Response) => {
  await prisma.coupon.delete({ where: { id: req.params.id as string } });
  ok(res, null, 'Coupon deleted.');
};

export const listFaqsAdmin = async (_req: Request, res: Response) => ok(res, await prisma.faq.findMany({ orderBy: { sortOrder: 'asc' } }));
export const createFaq = async (req: Request, res: Response) => created(res, await prisma.faq.create({ data: req.body }));
export const updateFaq = async (req: Request, res: Response) => ok(res, await prisma.faq.update({ where: { id: req.params.id as string }, data: req.body }));
export const deleteFaq = async (req: Request, res: Response) => {
  await prisma.faq.delete({ where: { id: req.params.id as string } });
  ok(res, null);
};

// ───────────────────────── Settings & broadcast ─────────────────────────

export const getSettingsAdmin = async (_req: Request, res: Response) => ok(res, settingsOut(await getSettings()));

export const updateSettings = async (req: Request, res: Response) => {
  await getSettings();
  const settings = await prisma.settings.update({ where: { id: 'global' }, data: req.body });
  ok(res, settingsOut(settings), 'Settings saved. The app picks them up on its next request.');
};

export const sendBroadcast = async (req: Request, res: Response) => {
  const { title, body, role } = req.body as { title: string; body: string; role: 'CUSTOMER' | 'RIDER' };
  const count = await broadcast({ title, body, role, type: 'PROMO' });
  ok(res, { recipients: count }, `Notification queued for ${count} user${count === 1 ? '' : 's'}.`);
};

export const listReviews = async (req: Request, res: Response) => {
  const page = pageQuery(req.query as Record<string, unknown>, 25);
  const [rows, total] = await Promise.all([
    prisma.review.findMany({ include: { user: { select: { name: true } }, store: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.perPage }),
    prisma.review.count(),
  ]);
  ok(res, paginated(rows.map((r) => ({ id: r.id, stars: r.rating, comment: r.comment, tags: r.tags, tip: r.tip, isApproved: r.isApproved, userName: r.user.name, storeName: r.store.name, storeId: r.storeId, orderId: r.orderId, createdAt: r.createdAt.toISOString() })), total, page));
};

export const setReviewApproval = async (req: Request, res: Response) => {
  const { approved } = req.body as { approved: boolean };
  const review = await prisma.review.update({ where: { id: req.params.id as string }, data: { isApproved: approved } });
  const agg = await prisma.review.aggregate({ where: { storeId: review.storeId, isApproved: true }, _avg: { rating: true }, _count: { rating: true } });
  await prisma.store.update({ where: { id: review.storeId }, data: { rating: Math.round((agg._avg.rating ?? 0) * 10) / 10, ratingCount: agg._count.rating } });
  ok(res, { id: review.id, isApproved: review.isApproved });
};
