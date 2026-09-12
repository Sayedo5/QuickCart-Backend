import { Request, Response } from 'express';
import { OrderStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/db';
import { getQuery } from '../middleware/validate';
import { isWithinCity } from '../services/cityService';
import { notifyUser } from '../services/notificationService';
import { minOrderFor, quoteCart, quoteOut } from '../services/pricingService';
import { emitOrderStatus, emitToAdmins } from '../sockets/orderSocket';
import { AppError, forbidden, notFound } from '../utils/errors';
import { created, ok, pageQuery, paginated } from '../utils/response';
import { orderOut, orderStatusIn, OrderWithRelations } from '../utils/serialize';

export const ORDER_INCLUDE = { items: true, statusHistory: { orderBy: { timestamp: 'asc' as const } }, store: true, rider: true, user: true, review: true } satisfies Prisma.OrderInclude;

const STATUS_FLOW: OrderStatus[] = ['PLACED', 'CONFIRMED', 'PREPARING', 'PICKED_UP', 'DELIVERED'];

const STATUS_COPY: Record<OrderStatus, { title: string; body: (store: string) => string }> = {
  PLACED: { title: 'Order placed', body: (s) => `We have sent your order to ${s}.` },
  CONFIRMED: { title: 'Order confirmed', body: (s) => `${s} has accepted your order.` },
  PREPARING: { title: 'Preparing your order', body: (s) => `${s} is preparing your items now.` },
  PICKED_UP: { title: 'Rider on the way', body: () => 'Your rider has picked up the order and is heading to you.' },
  DELIVERED: { title: 'Delivered — enjoy!', body: (s) => `Your order from ${s} has arrived.` },
  CANCELLED: { title: 'Order cancelled', body: (s) => `Your order from ${s} was cancelled.` },
};

const nextOrderNumber = async () => {
  for (let i = 0; i < 5; i++) {
    const candidate = `QC-${Math.floor(10000 + Math.random() * 89999)}`;
    const exists = await prisma.order.findUnique({ where: { orderNumber: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  return `QC-${Date.now().toString().slice(-6)}`;
};

// ───────────────────────── Customer ─────────────────────────

export const quote = async (req: Request, res: Response) => {
  const b = req.body as { storeId: string; items: Array<{ productId: string; quantity: number; unitPrice?: number }>; promoCode?: string | null; addressId?: string | null };
  const clientPrices = Object.fromEntries(b.items.filter((i) => i.unitPrice != null).map((i) => [i.productId, i.unitPrice as number]));
  // Quote against the real drop-off when the app already knows it, so the fee
  // shown in the cart is the same one checkout charges.
  const address = b.addressId && req.user ? await prisma.address.findFirst({ where: { id: b.addressId, userId: req.user.id } }) : null;
  const dropOff = address ? { latitude: address.lat, longitude: address.lng } : null;
  const q = await quoteCart({ storeId: b.storeId, items: b.items, couponCode: b.promoCode, clientPrices, dropOff });
  ok(res, quoteOut(q));
};

export const placeOrder = async (req: Request, res: Response) => {
  const b = req.body as { storeId: string; items: Array<{ productId: string; quantity: number; unitPrice?: number }>; promoCode?: string | null; addressId: string; paymentMethodId: string; note?: string | null };
  const user = req.user!;

  const address = await prisma.address.findFirst({ where: { id: b.addressId, userId: user.id } });
  if (!address) throw new AppError('ADDRESS_REQUIRED', 'Select a valid delivery address.', 422);

  const q = await quoteCart({ storeId: b.storeId, items: b.items, couponCode: b.promoCode, dropOff: { latitude: address.lat, longitude: address.lng } });
  if (!q.store.isOpen) throw new AppError('STORE_CLOSED', `${q.store.name} is closed right now.`, 409);
  if (q.issues.some((i) => i.type === 'out_of_stock' || i.type === 'unavailable')) {
    throw new AppError('OUT_OF_STOCK', 'Some items in your cart are no longer available.', 409, q.issues);
  }
  if (q.lines.length === 0) throw new AppError('EMPTY_CART', 'Your cart is empty.', 422);
  const minOrder = minOrderFor(q);
  if (q.subtotal < minOrder) throw new AppError('MIN_ORDER', `Minimum order for ${q.store.name} is Rs ${minOrder}.`, 422);

  // The store and the drop-off must be in the same city — a Lahore store cannot
  // deliver to a Karachi address, and silently accepting that order is worse
  // than refusing it.
  if (q.city && !isWithinCity(q.city, { latitude: address.lat, longitude: address.lng })) {
    throw new AppError('OUT_OF_RANGE', `${q.store.name} does not deliver to this address. It is outside the ${q.city.name} service area.`, 422);
  }

  const method = await prisma.paymentMethod.findFirst({ where: { id: b.paymentMethodId, userId: user.id } });
  if (!method) throw new AppError('PAYMENT_REQUIRED', 'Select a valid payment method.', 422);
  if (method.type === 'WALLET' && user.walletBalance < q.total) {
    throw new AppError('INSUFFICIENT_WALLET', `Your wallet has Rs ${Math.floor(user.walletBalance)} but this order is Rs ${Math.ceil(q.total)}.`, 402);
  }

  const orderNumber = await nextOrderNumber();
  // ETA comes from the city's own calibration (base prep + per-km travel).
  const eta = new Date(Date.now() + (q.etaMax + 5) * 60_000);

  // Neon is a remote database, so every statement costs a round trip. Keep the
  // transaction to the writes that must be atomic and raise the default 5s cap.
  const createdId = await prisma.$transaction(async (tx) => {
    const createdOrder = await tx.order.create({
      data: {
        orderNumber,
        userId: user.id,
        storeId: q.store.id,
        subtotal: q.subtotal,
        deliveryFee: q.deliveryFee,
        serviceFee: q.serviceFee,
        tax: q.tax,
        discount: q.discount,
        total: q.total,
        couponCode: q.coupon?.code ?? null,
        paymentMethodType: method.type,
        paymentMethodLabel: method.label,
        paymentStatus: method.type === 'WALLET' ? 'PAID' : 'PENDING',
        status: 'PLACED',
        addressLabel: address.label,
        addressLine: [address.street, address.apartment].filter(Boolean).join(', '),
        addressCity: address.city,
        addressLat: address.lat,
        addressLng: address.lng,
        note: b.note ?? null,
        estimatedDeliveryAt: eta,
        items: { create: q.lines.map((l) => ({ productId: l.product.id, name: l.product.name, imageUrl: l.product.imageUrl, unit: l.product.unit, price: l.unitPrice, quantity: l.quantity })) },
        statusHistory: { create: { status: 'PLACED' } },
      },
      select: { id: true },
    });
    if (method.type === 'WALLET') {
      await tx.user.update({ where: { id: user.id }, data: { walletBalance: { decrement: q.total } } });
      await tx.walletTransaction.create({ data: { userId: user.id, type: 'PAYMENT', amount: -q.total, title: q.store.name, subtitle: `Order ${orderNumber}`, orderId: createdOrder.id } });
    }
    if (q.coupon) await tx.coupon.update({ where: { id: q.coupon.id }, data: { usedCount: { increment: 1 } } });
    return createdOrder.id;
  }, { maxWait: 15_000, timeout: 30_000 });

  const order = await prisma.order.findUniqueOrThrow({ where: { id: createdId }, include: ORDER_INCLUDE });
  const payload = orderOut(order as OrderWithRelations);
  emitToAdmins('order:new', payload);
  notifyUser(user.id, { title: STATUS_COPY.PLACED.title, body: STATUS_COPY.PLACED.body(q.store.name), type: 'ORDER', orderId: order.id }).catch(() => undefined);
  created(res, payload, 'Order placed.');
};

export const myOrders = async (req: Request, res: Response) => {
  const rows = await prisma.order.findMany({ where: { userId: req.user!.id }, include: ORDER_INCLUDE, orderBy: { createdAt: 'desc' }, take: 100 });
  ok(res, rows.map((o) => orderOut(o as OrderWithRelations)));
};

export const getOrder = async (req: Request, res: Response) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id as string }, include: ORDER_INCLUDE });
  if (!order) throw notFound('Order');
  if (order.userId !== req.user!.id && req.user!.role !== 'ADMIN') throw forbidden();
  ok(res, orderOut(order as OrderWithRelations));
};

export const cancelOrder = async (req: Request, res: Response) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id as string }, include: ORDER_INCLUDE });
  if (!order) throw notFound('Order');
  if (order.userId !== req.user!.id && req.user!.role !== 'ADMIN') throw forbidden();
  if (order.status !== 'PLACED' && order.status !== 'CONFIRMED' && req.user!.role !== 'ADMIN') {
    throw new AppError('CANNOT_CANCEL', 'This order is already being prepared and can no longer be cancelled.', 409);
  }
  const updated = await transition(order as OrderWithRelations, 'CANCELLED', (req.body as { reason?: string })?.reason ?? 'Cancelled by customer');
  ok(res, updated, 'Order cancelled.');
};

export const reviewOrder = async (req: Request, res: Response) => {
  const order = await prisma.order.findFirst({ where: { id: req.params.id as string, userId: req.user!.id }, include: { review: true } });
  if (!order) throw notFound('Order');
  if (order.status !== 'DELIVERED') throw new AppError('NOT_DELIVERED', 'You can rate an order once it has been delivered.', 409);
  const b = req.body as { stars: number; comment?: string | null; tags?: string[]; tip?: number };
  const review = await prisma.$transaction(async (tx) => {
    const r = await tx.review.upsert({
      where: { orderId: order.id },
      update: { rating: b.stars, comment: b.comment ?? null, tags: b.tags ?? [], tip: b.tip ?? 0 },
      create: { userId: req.user!.id, storeId: order.storeId, orderId: order.id, rating: b.stars, comment: b.comment ?? null, tags: b.tags ?? [], tip: b.tip ?? 0 },
    });
    // Recompute store rating from approved reviews.
    const agg = await tx.review.aggregate({ where: { storeId: order.storeId, isApproved: true }, _avg: { rating: true }, _count: { rating: true } });
    await tx.store.update({ where: { id: order.storeId }, data: { rating: Math.round((agg._avg.rating ?? 0) * 10) / 10, ratingCount: agg._count.rating } });
    if (order.riderId) {
      const riderAgg = await tx.review.aggregate({ where: { order: { riderId: order.riderId } }, _avg: { rating: true }, _count: { rating: true } });
      await tx.rider.update({ where: { id: order.riderId }, data: { rating: Math.round((riderAgg._avg.rating ?? 0) * 10) / 10, ratingCount: riderAgg._count.rating } });
    }
    return r;
  });
  const full = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_INCLUDE });
  ok(res, orderOut(full as OrderWithRelations), review ? 'Thanks for your feedback!' : undefined);
};

// ───────────────────────── Shared status machine ─────────────────────────

/**
 * Moves an order to `status`, logs it, pays out wallet refunds on cancellation,
 * notifies the customer (push + in-app) and emits socket events. Used by admin,
 * rider and customer-cancel flows so the rules live in one place.
 */
export const transition = async (order: OrderWithRelations, status: OrderStatus, note?: string, riderId?: string) => {
  if (order.status === status) return orderOut(order);
  if (order.status === 'DELIVERED' || order.status === 'CANCELLED') {
    throw new AppError('ORDER_FINAL', `This order is already ${order.status.toLowerCase()}.`, 409);
  }
  if (status !== 'CANCELLED' && STATUS_FLOW.indexOf(status) < STATUS_FLOW.indexOf(order.status)) {
    throw new AppError('INVALID_TRANSITION', `Cannot move an order from ${order.status.toLowerCase()} back to ${status.toLowerCase()}.`, 409);
  }
  if (status === 'PICKED_UP' && !order.riderId && !riderId) {
    throw new AppError('RIDER_REQUIRED', 'Assign a rider before marking the order as picked up.', 422);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const data: Prisma.OrderUpdateInput = { status, statusHistory: { create: { status, note } } };
    if (riderId) data.rider = { connect: { id: riderId } };
    if (status === 'CANCELLED') {
      data.cancelledReason = note ?? null;
      if (order.paymentStatus === 'PAID') {
        data.paymentStatus = 'REFUNDED';
        await tx.user.update({ where: { id: order.userId }, data: { walletBalance: { increment: order.total } } });
        await tx.walletTransaction.create({ data: { userId: order.userId, type: 'REFUND', amount: order.total, title: 'Refund', subtitle: `Order ${order.orderNumber}`, orderId: order.id } });
      }
    }
    if (status === 'DELIVERED') {
      if (order.paymentStatus === 'PENDING') data.paymentStatus = 'PAID';
      if (order.riderId ?? riderId) await tx.rider.update({ where: { id: (order.riderId ?? riderId)! }, data: { completedOrders: { increment: 1 }, isAvailable: true } });
    }
    if (status === 'PICKED_UP' && (order.riderId ?? riderId)) {
      await tx.rider.update({ where: { id: (order.riderId ?? riderId)! }, data: { isAvailable: false } });
    }
    await tx.order.update({ where: { id: order.id }, data, select: { id: true } });
    return order.id;
  }, { maxWait: 15_000, timeout: 30_000 });

  const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: updated }, include: ORDER_INCLUDE });
  const payload = orderOut(updatedOrder as OrderWithRelations);
  emitOrderStatus({ id: updatedOrder.id, userId: updatedOrder.userId, status: updatedOrder.status, estimatedDeliveryAt: updatedOrder.estimatedDeliveryAt });
  emitToAdmins('order:updated', payload);
  const copy = STATUS_COPY[status];
  notifyUser(updatedOrder.userId, { title: copy.title, body: copy.body(updatedOrder.store.name), type: 'ORDER', orderId: updatedOrder.id }).catch(() => undefined);
  return payload;
};

// ───────────────────────── Admin / rider ─────────────────────────

export const listAllOrders = async (req: Request, res: Response) => {
  const q = getQuery<{ page?: number; perPage?: number; q?: string; status?: string; storeId?: string; riderId?: string; from?: string; to?: string }>(req);
  const page = pageQuery(q as Record<string, unknown>, 25);
  const where: Prisma.OrderWhereInput = {};
  if (q.status && q.status !== 'all') where.status = orderStatusIn(q.status);
  if (q.storeId) where.storeId = q.storeId;
  if (q.riderId) where.riderId = q.riderId;
  if (q.from || q.to) where.createdAt = { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined };
  if (q.q) where.OR = [{ orderNumber: { contains: q.q, mode: 'insensitive' } }, { user: { name: { contains: q.q, mode: 'insensitive' } } }, { user: { email: { contains: q.q, mode: 'insensitive' } } }, { store: { name: { contains: q.q, mode: 'insensitive' } } }];
  const [rows, total] = await Promise.all([
    prisma.order.findMany({ where, include: ORDER_INCLUDE, orderBy: { createdAt: 'desc' }, skip: page.skip, take: page.perPage }),
    prisma.order.count({ where }),
  ]);
  ok(res, paginated(rows.map((o) => orderOut(o as OrderWithRelations)), total, page));
};

export const updateStatus = async (req: Request, res: Response) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id as string }, include: ORDER_INCLUDE });
  if (!order) throw notFound('Order');
  const { status, note, riderId } = req.body as { status: string; note?: string; riderId?: string };
  if (req.user!.role === 'RIDER') {
    const rider = await prisma.rider.findUnique({ where: { userId: req.user!.id } });
    if (!rider || order.riderId !== rider.id) throw forbidden('This order is not assigned to you.');
  }
  if (riderId) {
    const rider = await prisma.rider.findUnique({ where: { id: riderId } });
    if (!rider || rider.status !== 'APPROVED') throw new AppError('RIDER_INVALID', 'Choose an approved rider.', 422);
  }
  ok(res, await transition(order as OrderWithRelations, orderStatusIn(status), note, riderId), 'Order updated.');
};

export const assignRider = async (req: Request, res: Response) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id as string }, include: ORDER_INCLUDE });
  if (!order) throw notFound('Order');
  const { riderId } = req.body as { riderId: string };
  const rider = await prisma.rider.findUnique({ where: { id: riderId } });
  if (!rider || rider.status !== 'APPROVED') throw new AppError('RIDER_INVALID', 'Choose an approved rider.', 422);
  const updated = await prisma.order.update({ where: { id: order.id }, data: { riderId, statusHistory: { create: { status: order.status, note: `Rider ${rider.name} assigned` } } }, include: ORDER_INCLUDE });
  const payload = orderOut(updated as OrderWithRelations);
  emitToAdmins('order:updated', payload);
  emitOrderStatus({ id: updated.id, userId: updated.userId, status: updated.status, estimatedDeliveryAt: updated.estimatedDeliveryAt });
  ok(res, payload, `${rider.name} assigned.`);
};
