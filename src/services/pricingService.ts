import { Coupon, Product, Settings, Store } from '@prisma/client';
import { prisma } from '../config/db';
import { AppError } from '../utils/errors';

/**
 * Server-side cart pricing. The mobile app never computes money on its own —
 * every quote and every order total comes from here, using live product prices,
 * store delivery fees and the admin-managed Settings row.
 */

export interface QuoteInputItem {
  productId: string;
  quantity: number;
}

export interface QuoteIssue {
  productId: string;
  type: 'out_of_stock' | 'price_changed' | 'unavailable';
  newPrice?: number;
}

export interface QuoteLine {
  product: Product;
  quantity: number;
  unitPrice: number;
}

export interface Quote {
  store: Store;
  settings: Settings;
  lines: QuoteLine[];
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  tax: number;
  discount: number;
  total: number;
  itemCount: number;
  coupon: Coupon | null;
  issues: QuoteIssue[];
}

const round = (n: number) => Math.round(n * 100) / 100;

export const getSettings = async (): Promise<Settings> => {
  const existing = await prisma.settings.findUnique({ where: { id: 'global' } });
  return existing ?? prisma.settings.create({ data: { id: 'global' } });
};

/** Effective unit price after any percentage discount set by the admin. */
export const effectivePrice = (p: Product) => round(p.discountPercent > 0 ? p.price * (1 - p.discountPercent / 100) : p.price);

export const findValidCoupon = async (code: string, subtotal: number): Promise<Coupon> => {
  const coupon = await prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!coupon || !coupon.isActive) throw new AppError('PROMO_INVALID', 'This promo code is not valid.', 404);
  if (coupon.expiryDate < new Date()) throw new AppError('PROMO_EXPIRED', 'This promo code has expired.', 410);
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) throw new AppError('PROMO_EXHAUSTED', 'This promo code has reached its usage limit.', 410);
  if (subtotal < coupon.minOrderAmount) {
    throw new AppError('PROMO_MIN_ORDER', `Add Rs ${Math.ceil(coupon.minOrderAmount - subtotal)} more to use this code.`, 422);
  }
  return coupon;
};

export const quoteCart = async (input: { storeId: string; items: QuoteInputItem[]; couponCode?: string | null; clientPrices?: Record<string, number> }): Promise<Quote> => {
  const [store, settings] = await Promise.all([prisma.store.findUnique({ where: { id: input.storeId } }), getSettings()]);
  if (!store || store.status !== 'APPROVED') throw new AppError('STORE_NOT_FOUND', 'Store not found.', 404);

  const ids = input.items.map((i) => i.productId);
  const products = await prisma.product.findMany({ where: { id: { in: ids }, storeId: store.id } });
  const byId = new Map(products.map((p) => [p.id, p]));

  const issues: QuoteIssue[] = [];
  const lines: QuoteLine[] = [];
  for (const item of input.items) {
    const product = byId.get(item.productId);
    if (!product) {
      issues.push({ productId: item.productId, type: 'unavailable' });
      continue;
    }
    if (!product.inStock) {
      issues.push({ productId: item.productId, type: 'out_of_stock' });
      continue;
    }
    const unitPrice = effectivePrice(product);
    const seen = input.clientPrices?.[item.productId];
    if (seen != null && Math.abs(seen - unitPrice) > 0.5) issues.push({ productId: item.productId, type: 'price_changed', newPrice: unitPrice });
    lines.push({ product, quantity: Math.max(1, Math.min(50, Math.floor(item.quantity))), unitPrice });
  }

  const subtotal = round(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0));
  const itemCount = lines.reduce((s, l) => s + l.quantity, 0);

  let coupon: Coupon | null = null;
  let discount = 0;
  let deliveryFee = store.deliveryFee;
  if (input.couponCode && subtotal > 0) {
    coupon = await findValidCoupon(input.couponCode, subtotal);
    if (coupon.discountType === 'PERCENT') discount = round(Math.min(subtotal * (coupon.discountValue / 100), coupon.maxDiscount ?? Infinity));
    else if (coupon.discountType === 'FLAT') discount = round(Math.min(coupon.discountValue, subtotal));
    else deliveryFee = 0;
  }

  const serviceFee = itemCount > 0 ? settings.platformFee : 0;
  const tax = round((subtotal - discount) * (settings.taxPercent / 100));
  const total = itemCount > 0 ? round(subtotal - discount + deliveryFee + serviceFee + tax) : 0;

  return { store, settings, lines, subtotal, deliveryFee: itemCount > 0 ? deliveryFee : 0, serviceFee, tax, discount, total, itemCount, coupon, issues };
};

export const quoteOut = (q: Quote) => ({
  subtotal: q.subtotal,
  deliveryFee: q.deliveryFee,
  serviceFee: q.serviceFee,
  tax: q.tax,
  discount: q.discount,
  total: q.total,
  itemCount: q.itemCount,
  taxLabel: q.settings.taxLabel,
  minOrder: q.store.minOrderAmount,
  issues: q.issues,
  promo: q.coupon
    ? {
        code: q.coupon.code,
        description: q.coupon.description,
        type: q.coupon.discountType === 'PERCENT' ? 'percent' : q.coupon.discountType === 'FLAT' ? 'fixed' : 'free_delivery',
        value: q.coupon.discountValue,
        maxDiscount: q.coupon.maxDiscount ?? undefined,
        minOrder: q.coupon.minOrderAmount || undefined,
      }
    : null,
});
