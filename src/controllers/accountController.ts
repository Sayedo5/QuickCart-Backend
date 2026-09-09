import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { AppError, notFound } from '../utils/errors';
import { created, ok } from '../utils/response';
import { addressOut, paymentMethodOut, paymentTypeIn, storeOut, userOut } from '../utils/serialize';
import { luhnCheck, detectCardBrand } from '../utils/cards';

// ───────────────────────── Profile ─────────────────────────

export const updateProfile = async (req: Request, res: Response) => {
  const { name, email, avatar, phone } = req.body as { name?: string; email?: string; avatar?: string; phone?: string };
  if (email && email !== req.user!.email) {
    const taken = await prisma.user.findUnique({ where: { email } });
    if (taken) throw new AppError('EMAIL_TAKEN', 'That email is already in use.', 409);
  }
  const user = await prisma.user.update({ where: { id: req.user!.id }, data: { name, email, avatarUrl: avatar, phone } });
  ok(res, userOut(user), 'Profile updated.');
};

export const registerPushToken = async (req: Request, res: Response) => {
  const { token, platform } = req.body as { token: string; platform: string };
  await prisma.pushToken.upsert({ where: { token }, update: { userId: req.user!.id, platform }, create: { token, platform, userId: req.user!.id } });
  ok(res, null);
};

// ───────────────────────── Addresses ─────────────────────────

const DEFAULT_LOCATION = { latitude: 31.479, longitude: 74.438 }; // DHA Phase 6, Lahore

export const listAddresses = async (req: Request, res: Response) => {
  const rows = await prisma.address.findMany({ where: { userId: req.user!.id }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
  ok(res, rows.map(addressOut));
};

export const createAddress = async (req: Request, res: Response) => {
  const b = req.body as { label: string; street: string; apartment?: string | null; city: string; instructions?: string | null; isDefault?: boolean; location?: { latitude: number; longitude: number } };
  const count = await prisma.address.count({ where: { userId: req.user!.id } });
  const isDefault = b.isDefault || count === 0;
  const row = await prisma.$transaction(async (tx) => {
    if (isDefault) await tx.address.updateMany({ where: { userId: req.user!.id }, data: { isDefault: false } });
    return tx.address.create({
      data: {
        userId: req.user!.id,
        label: b.label,
        street: b.street,
        apartment: b.apartment ?? null,
        city: b.city,
        instructions: b.instructions ?? null,
        isDefault,
        lat: b.location?.latitude ?? DEFAULT_LOCATION.latitude + (Math.random() - 0.5) * 0.02,
        lng: b.location?.longitude ?? DEFAULT_LOCATION.longitude + (Math.random() - 0.5) * 0.02,
      },
    });
  });
  created(res, addressOut(row), 'Address saved.');
};

export const updateAddress = async (req: Request, res: Response) => {
  const existing = await prisma.address.findFirst({ where: { id: req.params.id as string, userId: req.user!.id } });
  if (!existing) throw notFound('Address');
  const b = req.body as Partial<{ label: string; street: string; apartment: string | null; city: string; instructions: string | null; isDefault: boolean; location: { latitude: number; longitude: number } }>;
  const row = await prisma.$transaction(async (tx) => {
    if (b.isDefault) await tx.address.updateMany({ where: { userId: req.user!.id }, data: { isDefault: false } });
    return tx.address.update({
      where: { id: existing.id },
      data: { label: b.label, street: b.street, apartment: b.apartment, city: b.city, instructions: b.instructions, isDefault: b.isDefault, lat: b.location?.latitude, lng: b.location?.longitude },
    });
  });
  ok(res, addressOut(row), 'Address updated.');
};

export const deleteAddress = async (req: Request, res: Response) => {
  const deleted = await prisma.address.deleteMany({ where: { id: req.params.id as string, userId: req.user!.id } });
  if (deleted.count === 0) throw notFound('Address');
  ok(res, null, 'Address removed.');
};

// ───────────────────────── Payment methods ─────────────────────────

export const listPaymentMethods = async (req: Request, res: Response) => {
  let rows = await prisma.paymentMethod.findMany({ where: { userId: req.user!.id }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
  if (rows.length === 0) {
    await prisma.paymentMethod.createMany({
      data: [
        { userId: req.user!.id, type: 'CASH', label: 'Cash on Delivery', isDefault: true },
        { userId: req.user!.id, type: 'WALLET', label: 'QuickCart Wallet' },
      ],
    });
    rows = await prisma.paymentMethod.findMany({ where: { userId: req.user!.id }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
  }
  ok(res, rows.map(paymentMethodOut));
};

export const createPaymentMethod = async (req: Request, res: Response) => {
  const body = req.body as { type: 'card'; holder: string; number: string; expiry: string } | { type: 'jazzcash' | 'easypaisa'; mobileNumber: string };
  if (body.type === 'card') {
    if (!luhnCheck(body.number)) throw new AppError('INVALID_CARD', 'This card number is not valid.', 422);
    const brand = detectCardBrand(body.number);
    const row = await prisma.paymentMethod.create({
      data: { userId: req.user!.id, type: 'CARD', label: brand.label, brand: brand.key, last4: body.number.slice(-4), expiry: body.expiry },
    });
    return created(res, paymentMethodOut(row), 'Card added.');
  }
  const local = `0${body.mobileNumber}`;
  const duplicate = await prisma.paymentMethod.findFirst({ where: { userId: req.user!.id, type: paymentTypeIn(body.type), mobileNumber: local } });
  if (duplicate) return ok(res, paymentMethodOut(duplicate));
  const row = await prisma.paymentMethod.create({
    data: { userId: req.user!.id, type: paymentTypeIn(body.type), label: body.type === 'jazzcash' ? 'JazzCash' : 'Easypaisa', mobileNumber: local },
  });
  created(res, paymentMethodOut(row), `${row.label} linked.`);
};

export const deletePaymentMethod = async (req: Request, res: Response) => {
  const row = await prisma.paymentMethod.findFirst({ where: { id: req.params.id as string, userId: req.user!.id } });
  if (!row) throw notFound('Payment method');
  if (row.type === 'CASH' || row.type === 'WALLET') throw new AppError('NOT_REMOVABLE', 'Cash and wallet options cannot be removed.', 400);
  await prisma.paymentMethod.delete({ where: { id: row.id } });
  ok(res, null, 'Payment method removed.');
};

// ───────────────────────── Favourites ─────────────────────────

export const listFavourites = async (req: Request, res: Response) => {
  const rows = await prisma.favourite.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' } });
  ok(res, rows.map((r) => r.storeId));
};

export const listFavouriteStores = async (req: Request, res: Response) => {
  const rows = await prisma.favourite.findMany({ where: { userId: req.user!.id }, include: { store: true }, orderBy: { createdAt: 'desc' } });
  ok(res, rows.filter((r) => r.store.status === 'APPROVED').map((r) => storeOut(r.store)));
};

export const addFavourite = async (req: Request, res: Response) => {
  const storeId = req.params.storeId as string;
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) throw notFound('Store');
  await prisma.favourite.upsert({ where: { userId_storeId: { userId: req.user!.id, storeId } }, update: {}, create: { userId: req.user!.id, storeId } });
  ok(res, null);
};

export const removeFavourite = async (req: Request, res: Response) => {
  await prisma.favourite.deleteMany({ where: { userId: req.user!.id, storeId: req.params.storeId as string } });
  ok(res, null);
};

// ───────────────────────── Wallet ─────────────────────────

const walletTxOut = (t: { id: string; type: string; amount: number; title: string; subtitle: string | null; createdAt: Date }) => ({
  id: t.id,
  type: t.type.toLowerCase(),
  amount: t.amount,
  title: t.title,
  subtitle: t.subtitle ?? undefined,
  createdAt: t.createdAt.toISOString(),
});

export const getWallet = async (req: Request, res: Response) => {
  const [user, transactions] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.user!.id }, select: { walletBalance: true } }),
    prisma.walletTransaction.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  ok(res, { balance: user?.walletBalance ?? 0, transactions: transactions.map(walletTxOut) });
};

/**
 * Wallet top-up. In production this must be called only after the payment gateway
 * (JazzCash / Easypaisa / card) confirms the charge; the gateway callback should hit
 * this same logic server-side. Until a gateway is connected it credits immediately.
 */
export const topUpWallet = async (req: Request, res: Response) => {
  const { amount, source } = req.body as { amount: number; source: string };
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: req.user!.id }, data: { walletBalance: { increment: amount } } });
    const transaction = await tx.walletTransaction.create({ data: { userId: user.id, type: 'TOPUP', amount, title: `Top-up via ${source}` } });
    return { balance: user.walletBalance, transaction };
  });
  ok(res, { balance: result.balance, transaction: walletTxOut(result.transaction) }, 'Wallet topped up.');
};

// ───────────────────────── Notifications ─────────────────────────

export const listNotifications = async (req: Request, res: Response) => {
  const rows = await prisma.notification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  ok(
    res,
    rows.map((n) => ({ id: n.id, title: n.title, body: n.body, type: n.type.toLowerCase(), orderId: n.orderId ?? undefined, read: n.isRead, createdAt: n.createdAt.toISOString() })),
  );
};

export const markNotificationsRead = async (req: Request, res: Response) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.id, isRead: false }, data: { isRead: true } });
  ok(res, null);
};
