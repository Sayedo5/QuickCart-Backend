import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { env } from '../src/config/env';
import { BANNERS, CATEGORIES, COUPONS, FAQS, RIDERS, STORES } from './seed-data';

const prisma = new PrismaClient();

const img = (id: string, w: number) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=75`;

async function main() {
  console.log('🌱 Seeding QuickCart…');

  // ── Settings ──
  await prisma.settings.upsert({
    where: { id: 'global' },
    update: {},
    create: {
      id: 'global',
      currencySymbol: 'Rs',
      taxPercent: 16,
      taxLabel: 'GST (16%)',
      platformFee: 29,
      baseDeliveryFee: 99,
      minOrderDefault: 300,
      serviceCity: 'Lahore',
      supportEmail: 'support@quickcart.pk',
      supportPhone: '042 111 000 123',
      supportWhatsApp: '+923001112233',
    },
  });

  // ── Admin ──
  const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 12);
  const admin = await prisma.user.upsert({
    where: { email: env.ADMIN_EMAIL },
    update: { role: 'ADMIN', passwordHash, name: env.ADMIN_NAME, isVerified: true },
    create: { email: env.ADMIN_EMAIL, name: env.ADMIN_NAME, role: 'ADMIN', passwordHash, isVerified: true },
  });
  console.log(`   admin: ${admin.email}`);

  // ── Demo customer ──
  const customer = await prisma.user.upsert({
    where: { email: 'ahmed.raza@example.com' },
    update: {},
    create: { email: 'ahmed.raza@example.com', name: 'Ahmed Raza', phone: '3001234567', dialCode: '+92', isVerified: true, walletBalance: 1250 },
  });
  const addressCount = await prisma.address.count({ where: { userId: customer.id } });
  if (addressCount === 0) {
    await prisma.address.createMany({
      data: [
        { userId: customer.id, label: 'Home', street: 'House 12, Street 5, Sector A', apartment: 'DHA Phase 6', city: 'Lahore, Punjab', instructions: 'Ring the bell twice. Gate is on the left side.', isDefault: true, lat: 31.479, lng: 74.438 },
        { userId: customer.id, label: 'Work', street: 'Arfa Software Technology Park, Ferozepur Road', apartment: '9th Floor, Reception', city: 'Lahore, Punjab', lat: 31.475, lng: 74.318 },
      ],
    });
  }
  const pmCount = await prisma.paymentMethod.count({ where: { userId: customer.id } });
  if (pmCount === 0) {
    await prisma.paymentMethod.createMany({
      data: [
        { userId: customer.id, type: 'CASH', label: 'Cash on Delivery', isDefault: true },
        { userId: customer.id, type: 'WALLET', label: 'QuickCart Wallet' },
        { userId: customer.id, type: 'JAZZCASH', label: 'JazzCash', mobileNumber: '03001234567' },
      ],
    });
  }

  // ── Categories, banners, coupons, FAQs ──
  for (const c of CATEGORIES) {
    await prisma.category.upsert({ where: { slug: c.slug }, update: c, create: c });
  }
  if ((await prisma.banner.count()) === 0) await prisma.banner.createMany({ data: BANNERS });
  for (const c of COUPONS) {
    const expiryDate = new Date(Date.now() + 120 * 86_400_000);
    await prisma.coupon.upsert({ where: { code: c.code }, update: { ...c, expiryDate }, create: { ...c, expiryDate } });
  }
  if ((await prisma.faq.count()) === 0) await prisma.faq.createMany({ data: FAQS });

  // ── Stores, menu sections, products ──
  let productTotal = 0;
  for (const s of STORES) {
    const existing = await prisma.store.findFirst({ where: { name: s.name } });
    const data = {
      name: s.name,
      category: s.category,
      area: s.area,
      address: s.address,
      imageUrl: img(s.photo, 600),
      coverImageUrl: img(s.photo, 1200),
      lat: s.lat,
      lng: s.lng,
      rating: s.rating,
      ratingCount: s.ratingCount,
      deliveryTimeMin: s.deliveryTimeMin,
      deliveryTimeMax: s.deliveryTimeMax,
      deliveryFee: s.deliveryFee,
      minOrderAmount: s.minOrder,
      distanceKm: s.distanceKm,
      tags: s.tags,
      promoLabel: s.promoLabel ?? null,
      isOpen: s.isOpen,
      status: 'APPROVED' as const,
      ownerName: s.ownerName,
      ownerContact: s.ownerContact,
    };
    const store = existing ? await prisma.store.update({ where: { id: existing.id }, data }) : await prisma.store.create({ data });

    for (const [index, section] of s.menu.entries()) {
      const existingCat = await prisma.menuCategory.findFirst({ where: { storeId: store.id, name: section.name } });
      const cat = existingCat ?? (await prisma.menuCategory.create({ data: { storeId: store.id, name: section.name, sortOrder: index } }));
      for (const [pIndex, item] of section.items.entries()) {
        const existingProduct = await prisma.product.findFirst({ where: { storeId: store.id, name: item.name } });
        const pData = {
          storeId: store.id,
          menuCategoryId: cat.id,
          name: item.name,
          description: item.description,
          price: item.price,
          compareAtPrice: item.compareAtPrice ?? null,
          imageUrl: item.image,
          unit: item.unit ?? null,
          isVeg: item.isVeg ?? null,
          isPopular: item.isPopular ?? false,
          inStock: true,
          sortOrder: pIndex,
        };
        if (existingProduct) await prisma.product.update({ where: { id: existingProduct.id }, data: pData });
        else await prisma.product.create({ data: pData });
        productTotal++;
      }
    }
  }

  // ── Riders ──
  for (const r of RIDERS) {
    await prisma.rider.upsert({
      where: { email: r.email },
      update: {},
      create: {
        name: r.name,
        email: r.email,
        phone: r.phone,
        vehicleType: r.vehicleType,
        plateNumber: r.plateNumber,
        status: r.status,
        isAvailable: r.status === 'APPROVED',
        currentLat: r.lat,
        currentLng: r.lng,
        lastLocationAt: r.lat ? new Date() : null,
        rating: r.status === 'APPROVED' ? 4.8 : 0,
        ratingCount: r.status === 'APPROVED' ? 120 : 0,
        completedOrders: r.status === 'APPROVED' ? 340 : 0,
        imageUrl: `https://i.pravatar.cc/200?u=${encodeURIComponent(r.email)}`,
        documentUrls: r.status === 'PENDING' ? ['https://res.cloudinary.com/demo/image/upload/sample.jpg'] : [],
      },
    });
  }

  // ── A pending store application so the admin panel has something to approve ──
  const pendingStore = await prisma.store.findFirst({ where: { name: 'Lahore Tandoor House' } });
  if (!pendingStore) {
    await prisma.store.create({
      data: {
        name: 'Lahore Tandoor House',
        category: 'RESTAURANTS',
        area: 'Garden Town',
        address: 'Main Boulevard, Garden Town, Lahore',
        description: 'Family-run tandoor serving fresh rotis, naan and daily desi handi.',
        imageUrl: img('photo-1601050690597-df0568f70950', 600),
        lat: 31.4934,
        lng: 74.3005,
        status: 'PENDING',
        isOpen: false,
        deliveryFee: 79,
        minOrderAmount: 300,
        ownerName: 'Rizwan Haider',
        ownerContact: '03005556677',
      },
    });
  }

  const counts = {
    stores: await prisma.store.count(),
    products: await prisma.product.count(),
    riders: await prisma.rider.count(),
    coupons: await prisma.coupon.count(),
    users: await prisma.user.count(),
  };
  console.log(`✅ Seed complete: ${counts.stores} stores, ${counts.products} products (${productTotal} upserted), ${counts.riders} riders, ${counts.coupons} coupons, ${counts.users} users.`);
  console.log(`   Admin login → ${env.ADMIN_EMAIL} / ${env.ADMIN_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
