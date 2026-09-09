import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/db';
import { getQuery } from '../middleware/validate';
import { sendPlainEmail } from '../services/emailService';
import { emitRiderLocation, emitToAdmins } from '../sockets/orderSocket';
import { AppError, forbidden, notFound } from '../utils/errors';
import { created, ok, pageQuery, paginated } from '../utils/response';
import { riderOut } from '../utils/serialize';

/** POST /api/riders/apply — public application; admin approves from the panel. */
export const apply = async (req: Request, res: Response) => {
  const b = req.body as { name: string; email: string; phone: string; vehicleType?: string | null; plateNumber?: string | null; imageUrl?: string | null; documentUrls: string[] };
  const existing = await prisma.rider.findUnique({ where: { email: b.email } });
  if (existing) throw new AppError('ALREADY_APPLIED', `An application for ${b.email} already exists (${existing.status.toLowerCase()}).`, 409);
  const linked = await prisma.user.findUnique({ where: { email: b.email }, select: { id: true } });
  const rider = await prisma.rider.create({
    data: { name: b.name, email: b.email, phone: `0${b.phone}`, vehicleType: b.vehicleType ?? null, plateNumber: b.plateNumber ?? null, imageUrl: b.imageUrl ?? null, documentUrls: b.documentUrls, userId: linked?.id ?? null },
  });
  emitToAdmins('rider:updated', riderOut(rider));
  created(res, riderOut(rider), 'Application received. We will email you once it is reviewed.');
};

export const list = async (req: Request, res: Response) => {
  const q = getQuery<{ page?: number; perPage?: number; q?: string; status?: string }>(req);
  const page = pageQuery(q as Record<string, unknown>, 25);
  const where: Prisma.RiderWhereInput = {};
  if (q.status && q.status !== 'all') where.status = q.status.toUpperCase() as Prisma.RiderWhereInput['status'];
  if (q.q) where.OR = [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }];
  const [rows, total] = await Promise.all([
    prisma.rider.findMany({ where, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], skip: page.skip, take: page.perPage }),
    prisma.rider.count({ where }),
  ]);
  ok(res, paginated(rows.map(riderOut), total, page));
};

export const pending = async (_req: Request, res: Response) => {
  const rows = await prisma.rider.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' } });
  ok(res, rows.map(riderOut));
};

export const getOne = async (req: Request, res: Response) => {
  const rider = await prisma.rider.findUnique({ where: { id: req.params.id as string } });
  if (!rider) throw notFound('Rider');
  ok(res, riderOut(rider));
};

/** PUT /api/riders/:id/approve — status: approved | rejected | suspended | pending (+ reason). */
export const setApproval = async (req: Request, res: Response) => {
  const rider = await prisma.rider.findUnique({ where: { id: req.params.id as string } });
  if (!rider) throw notFound('Rider');
  const { status, reason } = req.body as { status: 'approved' | 'rejected' | 'suspended' | 'pending'; reason?: string };
  if (status === 'rejected' && !reason) throw new AppError('REASON_REQUIRED', 'Give the rider a reason for the rejection.', 422);
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.rider.update({
      where: { id: rider.id },
      data: { status: status.toUpperCase() as Prisma.RiderUpdateInput['status'], rejectionReason: status === 'rejected' || status === 'suspended' ? (reason ?? null) : null, isAvailable: status === 'approved' ? rider.isAvailable : false },
    });
    // Approved riders get a login account (role RIDER) so the future rider app can sign in with email OTP.
    if (status === 'approved') {
      const user = await tx.user.upsert({
        where: { email: rider.email },
        update: { role: 'RIDER' },
        create: { email: rider.email, name: rider.name, phone: rider.phone.replace(/^0/, ''), role: 'RIDER', isVerified: true },
      });
      await tx.rider.update({ where: { id: rider.id }, data: { userId: user.id } });
    }
    return r;
  });
  const subject = status === 'approved' ? 'Your QuickCart rider application is approved' : `Your QuickCart rider application: ${status}`;
  sendPlainEmail(rider.email, subject, status === 'approved' ? `Welcome aboard, ${rider.name}! You can now sign in to the rider app with this email.` : `Hello ${rider.name}, your application status is now "${status}".${reason ? ` Reason: ${reason}` : ''}`).catch(() => undefined);
  emitToAdmins('rider:updated', riderOut(updated));
  ok(res, riderOut(updated), `Rider ${status}.`);
};

export const update = async (req: Request, res: Response) => {
  const rider = await prisma.rider.findUnique({ where: { id: req.params.id as string } });
  if (!rider) throw notFound('Rider');
  const b = req.body as Partial<{ name: string; phone: string; vehicleType: string | null; plateNumber: string | null; imageUrl: string | null; documentUrls: string[]; isAvailable: boolean }>;
  const updated = await prisma.rider.update({
    where: { id: rider.id },
    data: { name: b.name, phone: b.phone ? `0${b.phone}` : undefined, vehicleType: b.vehicleType, plateNumber: b.plateNumber, imageUrl: b.imageUrl, documentUrls: b.documentUrls, isAvailable: b.isAvailable },
  });
  emitToAdmins('rider:updated', riderOut(updated));
  ok(res, riderOut(updated), 'Rider updated.');
};

/**
 * PUT /api/riders/:id/location — called by the rider app (or the admin panel's
 * simulator). Persists the fix and pushes it to every active order of this rider.
 */
export const updateLocation = async (req: Request, res: Response) => {
  const rider = await prisma.rider.findUnique({ where: { id: req.params.id as string } });
  if (!rider) throw notFound('Rider');
  if (req.user!.role !== 'ADMIN' && rider.userId !== req.user!.id) throw forbidden();
  const { latitude, longitude, heading } = req.body as { latitude: number; longitude: number; heading?: number };
  await prisma.rider.update({ where: { id: rider.id }, data: { currentLat: latitude, currentLng: longitude, heading: heading ?? null, lastLocationAt: new Date() } });
  const active = await prisma.order.findMany({ where: { riderId: rider.id, status: { in: ['CONFIRMED', 'PREPARING', 'PICKED_UP'] } }, select: { id: true, userId: true } });
  active.forEach((o) => emitRiderLocation(o.id, o.userId, { latitude, longitude, heading }));
  ok(res, { orders: active.map((o) => o.id) });
};

export const remove = async (req: Request, res: Response) => {
  const rider = await prisma.rider.findUnique({ where: { id: req.params.id as string } });
  if (!rider) throw notFound('Rider');
  const activeOrders = await prisma.order.count({ where: { riderId: rider.id, status: { in: ['CONFIRMED', 'PREPARING', 'PICKED_UP'] } } });
  if (activeOrders > 0) throw new AppError('RIDER_BUSY', 'This rider has active orders. Reassign them first.', 409);
  await prisma.rider.delete({ where: { id: rider.id } });
  ok(res, null, 'Rider removed.');
};
