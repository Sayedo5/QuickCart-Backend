import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { socketCorsOptions } from '../config/cors';
import { env } from '../config/env';
import { prisma } from '../config/db';
import { verifyAccessToken } from '../utils/jwt';

/**
 * Real-time layer.
 *  Rooms:  user:{userId}   — every socket of that customer
 *          order:{orderId} — customer app screens watching one order
 *          admins          — every admin dashboard session
 *          riders          — rider clients (future rider app)
 *  Events (server → client):
 *          order:status   { orderId, status, at, estimatedDeliveryAt }
 *          rider:location { orderId, latitude, longitude, heading, at }
 *          order:new      full order (admins)
 *          order:updated  full order (admins)
 */

let io: Server | null = null;

interface SocketUser {
  id: string;
  role: 'CUSTOMER' | 'RIDER' | 'ADMIN';
}

export const initSockets = (server: HttpServer) => {
  io = new Server(server, {
    cors: socketCorsOptions,
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth?.token as string | undefined) ?? (socket.handshake.headers.authorization?.toString().replace('Bearer ', '') ?? '');
      if (!token) return next(); // anonymous sockets may still join public rooms (none today)
      const payload = verifyAccessToken(token);
      const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, role: true, isBlocked: true } });
      if (!user || user.isBlocked) return next(new Error('unauthorized'));
      (socket.data as { user?: SocketUser }).user = { id: user.id, role: user.role };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket.data as { user?: SocketUser }).user;
    if (user) {
      socket.join(`user:${user.id}`);
      if (user.role === 'ADMIN') socket.join('admins');
      if (user.role === 'RIDER') socket.join('riders');
    }

    socket.on('order:join', async ({ orderId }: { orderId: string }) => {
      if (!orderId) return;
      // Customers may only watch their own orders; admins can watch any.
      if (user?.role === 'ADMIN') return void socket.join(`order:${orderId}`);
      if (!user) return;
      const order = await prisma.order.findFirst({ where: { id: orderId, userId: user.id }, select: { id: true } });
      if (order) socket.join(`order:${orderId}`);
    });

    socket.on('order:leave', ({ orderId }: { orderId: string }) => {
      if (orderId) socket.leave(`order:${orderId}`);
    });
  });

  return io;
};

export const getIo = () => io;

export const emitOrderStatus = (order: { id: string; userId: string; status: string; estimatedDeliveryAt?: Date | null }, at = new Date()) => {
  const payload = { orderId: order.id, status: order.status.toLowerCase(), at: at.toISOString(), estimatedDeliveryAt: order.estimatedDeliveryAt?.toISOString() };
  io?.to(`order:${order.id}`).to(`user:${order.userId}`).emit('order:status', payload);
};

export const emitRiderLocation = (orderId: string, userId: string, location: { latitude: number; longitude: number; heading?: number | null }) => {
  const payload = { orderId, latitude: location.latitude, longitude: location.longitude, heading: location.heading ?? undefined, at: new Date().toISOString() };
  io?.to(`order:${orderId}`).to(`user:${userId}`).emit('rider:location', payload);
  io?.to('admins').emit('rider:location', payload);
};

export const emitToAdmins = (event: 'order:new' | 'order:updated' | 'rider:updated' | 'store:updated', payload: unknown) => {
  io?.to('admins').emit(event, payload);
};
