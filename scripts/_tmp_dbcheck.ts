import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const s = await p.store.findUnique({ where: { id: '0a7e558f-70f0-4946-80c8-d68441ebc390' }, select: { id: true, name: true, area: true } });
  console.log('store lookup:', s);
  console.log('counts:', { stores: await p.store.count(), products: await p.product.count(), users: await p.user.count(), orders: await p.order.count() });
  await p.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
