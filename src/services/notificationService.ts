import { NotificationType } from '@prisma/client';
import { prisma } from '../config/db';
import { env } from '../config/env';

/**
 * In-app notification log + Expo push delivery. Push failures never fail the
 * calling request — they are logged and the in-app record is still written.
 */

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound: 'default';
  channelId: string;
}

const sendExpoPush = async (messages: PushMessage[]) => {
  if (messages.length === 0) return;
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(messages),
    });
    const json = (await res.json()) as { data?: Array<{ status: string; details?: { error?: string } }> };
    // Remove tokens Expo reports as no longer registered.
    const dead = (json.data ?? [])
      .map((r, i) => (r.status === 'error' && r.details?.error === 'DeviceNotRegistered' ? messages[i].to : null))
      .filter((t): t is string => !!t);
    if (dead.length) await prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[push] delivery failed', (e as Error).message);
  }
};

export const notifyUser = async (
  userId: string,
  input: { title: string; body: string; type?: NotificationType; orderId?: string; data?: Record<string, unknown>; channel?: 'orders' | 'promos' },
) => {
  await prisma.notification.create({
    data: { userId, title: input.title, body: input.body, type: input.type ?? 'SYSTEM', orderId: input.orderId },
  });
  const tokens = await prisma.pushToken.findMany({ where: { userId }, select: { token: true } });
  await sendExpoPush(
    tokens.map((t) => ({
      to: t.token,
      title: input.title,
      body: input.body,
      data: { type: (input.type ?? 'SYSTEM').toLowerCase(), orderId: input.orderId, ...input.data },
      sound: 'default',
      channelId: input.channel ?? 'orders',
    })),
  );
};

/** Admin broadcast to every customer (or a role segment). */
export const broadcast = async (input: { title: string; body: string; type?: NotificationType; role?: 'CUSTOMER' | 'RIDER' }) => {
  const users = await prisma.user.findMany({ where: { role: input.role ?? 'CUSTOMER', isBlocked: false }, select: { id: true } });
  if (users.length === 0) return 0;
  await prisma.notification.createMany({
    data: users.map((u) => ({ userId: u.id, title: input.title, body: input.body, type: input.type ?? 'PROMO' })),
  });
  const tokens = await prisma.pushToken.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { token: true } });
  // Expo accepts up to 100 messages per request.
  for (let i = 0; i < tokens.length; i += 100) {
    await sendExpoPush(
      tokens.slice(i, i + 100).map((t) => ({ to: t.token, title: input.title, body: input.body, data: { type: 'promo' }, sound: 'default', channelId: 'promos' })),
    );
  }
  return users.length;
};
