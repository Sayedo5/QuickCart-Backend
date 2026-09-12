import {
  Address,
  Banner,
  Coupon,
  MenuCategory,
  Order,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  PaymentMethodType,
  Product,
  Review,
  Rider,
  Settings,
  StatusLog,
  Store,
  StoreCategory,
  User,
} from '@prisma/client';

/**
 * Maps database rows to the JSON shapes the mobile app and admin panel consume.
 * Keeping this in one place means a schema change never leaks into clients.
 */

export const storeCategoryOut = (c: StoreCategory) => c.toLowerCase() as 'restaurants' | 'grocery' | 'pharmacy';
export const storeCategoryIn = (c: string) => c.toUpperCase() as StoreCategory;

export const orderStatusOut = (s: OrderStatus) => s.toLowerCase() as 'placed' | 'confirmed' | 'preparing' | 'picked_up' | 'delivered' | 'cancelled';
export const orderStatusIn = (s: string) => s.toUpperCase() as OrderStatus;

export const paymentTypeOut = (t: PaymentMethodType) => t.toLowerCase() as 'cash' | 'card' | 'wallet' | 'jazzcash' | 'easypaisa';
export const paymentTypeIn = (t: string) => t.toUpperCase() as PaymentMethodType;

export const userOut = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone ?? '',
  dialCode: u.dialCode,
  avatar: u.avatarUrl ?? `https://i.pravatar.cc/200?u=${encodeURIComponent(u.email)}`,
  role: u.role.toLowerCase(),
  isVerified: u.isVerified,
  isBlocked: u.isBlocked,
  walletBalance: u.walletBalance,
  memberSince: u.createdAt.toISOString(),
});

export const addressOut = (a: Address) => ({
  id: a.id,
  label: a.label as 'Home' | 'Work' | 'Other',
  street: a.street,
  apartment: a.apartment ?? undefined,
  city: a.city,
  instructions: a.instructions ?? undefined,
  isDefault: a.isDefault,
  location: { latitude: a.lat, longitude: a.lng },
});

export const storeOut = (s: Store) => ({
  id: s.id,
  name: s.name,
  category: storeCategoryOut(s.category),
  city: s.city,
  image: s.imageUrl ?? '',
  coverImage: s.coverImageUrl ?? s.imageUrl ?? '',
  description: s.description ?? undefined,
  rating: s.rating,
  ratingCount: s.ratingCount,
  deliveryTimeMin: s.deliveryTimeMin,
  deliveryTimeMax: s.deliveryTimeMax,
  deliveryFee: s.deliveryFee,
  minOrder: s.minOrderAmount,
  distanceKm: s.distanceKm ?? 0,
  tags: s.tags,
  isOpen: s.isOpen,
  status: s.status.toLowerCase(),
  promoLabel: s.promoLabel ?? undefined,
  area: s.area,
  address: s.address,
  ownerName: s.ownerName ?? undefined,
  ownerContact: s.ownerContact ?? undefined,
  location: { latitude: s.lat, longitude: s.lng },
  createdAt: s.createdAt.toISOString(),
});

export const menuCategoryOut = (c: MenuCategory) => ({ id: c.id, storeId: c.storeId, name: c.name, sortOrder: c.sortOrder });

export const productOut = (p: Product) => ({
  id: p.id,
  storeId: p.storeId,
  categoryId: p.menuCategoryId ?? '',
  name: p.name,
  description: p.description ?? '',
  price: p.price,
  compareAtPrice: p.compareAtPrice ?? undefined,
  discountPercent: p.discountPercent,
  image: p.imageUrl ?? '',
  unit: p.unit ?? undefined,
  isVeg: p.isVeg ?? undefined,
  isPopular: p.isPopular,
  inStock: p.inStock,
  sortOrder: p.sortOrder,
});

export const bannerOut = (b: Banner) => ({
  id: b.id,
  title: b.title,
  subtitle: b.subtitle ?? undefined,
  label: b.label ?? undefined,
  image: b.imageUrl ?? undefined,
  target: { type: b.targetType.toLowerCase() as 'offers' | 'store' | 'category' | 'external', value: b.targetValue ?? undefined },
  colors: [b.colorFrom, b.colorTo] as [string, string],
  sortOrder: b.sortOrder,
  isActive: b.isActive,
  startsAt: b.startsAt?.toISOString(),
  endsAt: b.endsAt?.toISOString(),
});

export const couponOut = (c: Coupon) => ({
  id: c.id,
  code: c.code,
  description: c.description,
  type: c.discountType === 'PERCENT' ? ('percent' as const) : c.discountType === 'FLAT' ? ('fixed' as const) : ('free_delivery' as const),
  value: c.discountValue,
  maxDiscount: c.maxDiscount ?? undefined,
  minOrder: c.minOrderAmount || undefined,
  expiryDate: c.expiryDate.toISOString(),
  isActive: c.isActive,
  usageLimit: c.usageLimit ?? undefined,
  usedCount: c.usedCount,
});

export const settingsOut = (s: Settings) => ({
  currencySymbol: s.currencySymbol,
  taxRate: s.taxPercent / 100,
  taxPercent: s.taxPercent,
  taxLabel: s.taxLabel,
  platformFee: s.platformFee,
  baseDeliveryFee: s.baseDeliveryFee,
  minOrderDefault: s.minOrderDefault,
  serviceCity: s.serviceCity,
  supportEmail: s.supportEmail ?? '',
  supportPhone: s.supportPhone ?? '',
  supportWhatsApp: s.supportWhatsApp ?? undefined,
  termsUrl: s.termsUrl ?? undefined,
  privacyUrl: s.privacyUrl ?? undefined,
  announcement: s.announcementTitle ? { title: s.announcementTitle, body: s.announcementBody ?? '' } : null,
  appBannerImages: s.appBannerImages,
  updatedAt: s.updatedAt.toISOString(),
});

export const paymentMethodOut = (m: PaymentMethod) => ({
  id: m.id,
  type: paymentTypeOut(m.type),
  label: m.label,
  subtitle:
    m.type === 'CARD'
      ? `•••• ${m.last4 ?? ''}`
      : m.type === 'CASH'
        ? 'Pay the rider when your order arrives'
        : m.type === 'WALLET'
          ? 'Pay instantly from your balance'
          : m.mobileNumber
            ? `${m.mobileNumber.slice(0, 4)} •••• ${m.mobileNumber.slice(-3)}`
            : '',
  brand: (m.brand as 'visa' | 'mastercard' | 'amex' | undefined) ?? undefined,
  last4: m.last4 ?? undefined,
  expiry: m.expiry ?? undefined,
  mobileNumber: m.mobileNumber ?? undefined,
  isDefault: m.isDefault,
});

export const riderOut = (r: Rider) => ({
  id: r.id,
  name: r.name,
  email: r.email,
  phone: r.phone,
  avatar: r.imageUrl ?? `https://i.pravatar.cc/200?u=${encodeURIComponent(r.email)}`,
  vehicle: r.vehicleType ?? 'Motorbike',
  plate: r.plateNumber ?? '',
  rating: r.rating,
  ratingCount: r.ratingCount,
  completedOrders: r.completedOrders,
  status: r.status.toLowerCase(),
  rejectionReason: r.rejectionReason ?? undefined,
  isAvailable: r.isAvailable,
  documentUrls: r.documentUrls,
  location: r.currentLat != null && r.currentLng != null ? { latitude: r.currentLat, longitude: r.currentLng, heading: r.heading ?? undefined, at: r.lastLocationAt?.toISOString() } : null,
  createdAt: r.createdAt.toISOString(),
});

/** A placeholder rider shown to customers before an admin assigns a real one. */
export const unassignedRider = () => ({
  id: 'unassigned',
  name: 'Assigning rider…',
  avatar: 'https://i.pravatar.cc/200?u=quickcart-rider',
  phone: '',
  rating: 0,
  vehicle: '',
  plate: '',
});

export type OrderWithRelations = Order & {
  items: OrderItem[];
  statusHistory: StatusLog[];
  store: Store;
  rider: Rider | null;
  user?: User;
  review?: Review | null;
};

export const orderOut = (o: OrderWithRelations) => {
  const at = (status: OrderStatus) => o.statusHistory.find((h) => h.status === status)?.timestamp.toISOString();
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    userId: o.userId,
    customer: o.user ? { id: o.user.id, name: o.user.name, email: o.user.email, phone: o.user.phone ?? '' } : undefined,
    storeId: o.storeId,
    storeName: o.store.name,
    storeImage: o.store.imageUrl ?? '',
    storeLocation: { latitude: o.store.lat, longitude: o.store.lng },
    items: o.items.map((i) => ({
      product: { id: i.productId ?? i.id, storeId: o.storeId, categoryId: '', name: i.name, description: '', price: i.price, image: i.imageUrl ?? '', unit: i.unit ?? undefined },
      quantity: i.quantity,
    })),
    subtotal: o.subtotal,
    deliveryFee: o.deliveryFee,
    serviceFee: o.serviceFee,
    tax: o.tax,
    discount: o.discount,
    total: o.total,
    promoCode: o.couponCode ?? undefined,
    paymentMethod: { id: o.paymentMethodType.toLowerCase(), type: paymentTypeOut(o.paymentMethodType), label: o.paymentMethodLabel, subtitle: '' },
    paymentStatus: o.paymentStatus.toLowerCase(),
    address: {
      id: 'snapshot',
      label: o.addressLabel as 'Home' | 'Work' | 'Other',
      street: o.addressLine,
      city: o.addressCity,
      location: { latitude: o.addressLat, longitude: o.addressLng },
    },
    note: o.note ?? undefined,
    status: orderStatusOut(o.status),
    createdAt: o.createdAt.toISOString(),
    timeline: {
      placedAt: at('PLACED') ?? o.createdAt.toISOString(),
      confirmedAt: at('CONFIRMED'),
      preparingAt: at('PREPARING'),
      pickedUpAt: at('PICKED_UP'),
      deliveredAt: at('DELIVERED'),
      cancelledAt: at('CANCELLED'),
    },
    statusHistory: o.statusHistory.map((h) => ({ status: orderStatusOut(h.status), note: h.note ?? undefined, at: h.timestamp.toISOString() })),
    estimatedDeliveryAt: (o.estimatedDeliveryAt ?? new Date(o.createdAt.getTime() + 40 * 60_000)).toISOString(),
    rider: o.rider ? riderOut(o.rider) : unassignedRider(),
    rating: o.review ? { stars: o.review.rating, comment: o.review.comment ?? undefined, tip: o.review.tip } : undefined,
    cancelledReason: o.cancelledReason ?? undefined,
  };
};
