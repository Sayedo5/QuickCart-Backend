import { z } from 'zod';

// ───────────────────────── Shared ─────────────────────────

export const idParam = z.object({ id: z.string().min(1) });

export const email = z.string().trim().toLowerCase().email('Enter a valid email address.');

/** Pakistani mobile: 03XXXXXXXXX, 3XXXXXXXXX or +923XXXXXXXXX → stored as 3XXXXXXXXX. */
export const pkMobile = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .transform((d) => (d.startsWith('0092') ? d.slice(4) : d.startsWith('92') && d.length === 12 ? d.slice(2) : d.startsWith('0') && d.length === 11 ? d.slice(1) : d))
  .refine((d) => /^3\d{9}$/.test(d), 'Enter a valid Pakistani mobile number, e.g. 0300 1234567.');

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().optional(),
});

export const latLng = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });

// ───────────────────────── Auth ─────────────────────────

export const sendOtpSchema = z.object({
  email,
  purpose: z.enum(['login', 'signup']).default('login'),
});

export const verifyOtpSchema = z.object({
  email,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

/**
 * Only the verified-email token is required. Name and phone are collected later
 * (at checkout, where a rider actually needs them) so nothing stands between a
 * new customer and the home screen.
 */
export const signupSchema = z.object({
  signupToken: z.string().min(10),
  name: z.string().trim().min(2, 'Enter your full name.').max(80).optional(),
  phone: pkMobile.optional(),
  dialCode: z.string().default('+92'),
});

export const adminLoginSchema = z.object({ email, password: z.string().min(8, 'Password must be at least 8 characters.') });

export const refreshSchema = z.object({ refreshToken: z.string().min(10) });

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: email.optional(),
  avatar: z.string().url().optional(),
  phone: pkMobile.optional(),
});

export const pushTokenSchema = z.object({ token: z.string().min(10), platform: z.enum(['ios', 'android']) });

// ───────────────────────── Account ─────────────────────────

export const addressSchema = z.object({
  label: z.enum(['Home', 'Work', 'Other']),
  street: z.string().trim().min(4, 'Enter a valid street address.').max(200),
  apartment: z.string().trim().max(120).optional().nullable(),
  city: z.string().trim().min(2).max(80),
  instructions: z.string().trim().max(300).optional().nullable(),
  isDefault: z.boolean().optional(),
  location: latLng.optional(),
});

export const paymentMethodSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('card'),
    holder: z.string().trim().min(3).max(80),
    /** Only brand + last4 are persisted; the PAN is validated (Luhn) and discarded. */
    number: z.string().transform((v) => v.replace(/\D/g, '')).refine((d) => d.length >= 12 && d.length <= 19, 'Invalid card number.'),
    expiry: z.string().regex(/^(0[1-9]|1[0-2])\/\d{2}$/, 'Use MM/YY format.'),
  }),
  z.object({ type: z.enum(['jazzcash', 'easypaisa']), mobileNumber: pkMobile }),
]);

export const topUpSchema = z.object({ amount: z.number().min(100, 'Minimum top-up is Rs 100.').max(50_000), source: z.string().trim().min(2).max(40) });

// ───────────────────────── Orders ─────────────────────────

export const quoteSchema = z.object({
  storeId: z.string().min(1),
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(50), unitPrice: z.number().optional() })).min(1, 'Your cart is empty.').max(60),
  promoCode: z.string().trim().toUpperCase().optional().nullable(),
  addressId: z.string().optional().nullable(),
});

export const placeOrderSchema = quoteSchema.extend({
  addressId: z.string().min(1, 'Select a delivery address.'),
  paymentMethodId: z.string().min(1, 'Select a payment method.'),
  note: z.string().trim().max(300).optional().nullable(),
});

export const orderStatusSchema = z.object({
  status: z.enum(['placed', 'confirmed', 'preparing', 'picked_up', 'delivered', 'cancelled']),
  note: z.string().trim().max(300).optional(),
  riderId: z.string().optional(),
});

export const reviewSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional().nullable(),
  tags: z.array(z.string().max(40)).max(10).optional(),
  tip: z.number().min(0).max(5000).optional(),
});

export const validateCouponSchema = z.object({ code: z.string().trim().min(2).toUpperCase(), subtotal: z.number().min(0) });

// ───────────────────────── Admin: catalog ─────────────────────────

export const storeSchema = z.object({
  name: z.string().trim().min(2).max(80),
  category: z.enum(['restaurants', 'grocery', 'pharmacy']),
  /** Must match a ServiceCity name; the admin panel offers the live list. */
  city: z.string().trim().min(2).max(60).default('Lahore'),
  area: z.string().trim().min(2).max(80),
  address: z.string().trim().min(4).max(200),
  description: z.string().trim().max(600).optional().nullable(),
  image: z.string().url().optional().nullable(),
  coverImage: z.string().url().optional().nullable(),
  location: latLng,
  deliveryTimeMin: z.number().int().min(5).max(180).default(20),
  deliveryTimeMax: z.number().int().min(5).max(240).default(30),
  deliveryFee: z.number().min(0).max(2000).default(0),
  minOrder: z.number().min(0).max(50_000).default(0),
  distanceKm: z.number().min(0).max(100).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  promoLabel: z.string().trim().max(60).optional().nullable(),
  isOpen: z.boolean().default(true),
  ownerName: z.string().trim().max(80).optional().nullable(),
  ownerContact: z.string().trim().max(80).optional().nullable(),
});

export const storeApplicationSchema = storeSchema.pick({ name: true, category: true, city: true, area: true, address: true, description: true, location: true, ownerName: true, ownerContact: true, image: true });

export const approvalSchema = z.object({ status: z.enum(['approved', 'rejected', 'suspended', 'pending']), reason: z.string().trim().max(300).optional() });

export const menuCategorySchema = z.object({ name: z.string().trim().min(1).max(60), sortOrder: z.number().int().min(0).default(0) });

export const productSchema = z.object({
  storeId: z.string().min(1),
  menuCategoryId: z.string().optional().nullable(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(600).optional().nullable(),
  price: z.number().min(0).max(1_000_000),
  compareAtPrice: z.number().min(0).max(1_000_000).optional().nullable(),
  discountPercent: z.number().min(0).max(90).default(0),
  image: z.string().url().optional().nullable(),
  unit: z.string().trim().max(40).optional().nullable(),
  isVeg: z.boolean().optional().nullable(),
  isPopular: z.boolean().default(false),
  inStock: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
});

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/, 'Slug may contain lowercase letters, numbers and dashes only.'),
  icon: z.string().trim().max(60).optional().nullable(),
  imageUrl: z.string().url().optional().nullable(),
  type: z.enum(['store', 'product']).default('store'),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export const bannerSchema = z.object({
  title: z.string().trim().min(1).max(80),
  subtitle: z.string().trim().max(120).optional().nullable(),
  label: z.string().trim().max(40).optional().nullable(),
  image: z.string().url().optional().nullable(),
  targetType: z.enum(['offers', 'store', 'category', 'external']).default('offers'),
  targetValue: z.string().trim().max(200).optional().nullable(),
  colorFrom: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#FF6B35'),
  colorTo: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#FF8F5E'),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  startsAt: z.string().datetime().optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
});

export const couponSchema = z.object({
  code: z.string().trim().toUpperCase().min(3).max(20).regex(/^[A-Z0-9]+$/, 'Use letters and numbers only.'),
  description: z.string().trim().min(3).max(120),
  type: z.enum(['percent', 'fixed', 'free_delivery']),
  value: z.number().min(0).max(100_000).default(0),
  maxDiscount: z.number().min(0).optional().nullable(),
  minOrder: z.number().min(0).default(0),
  expiryDate: z.string().datetime(),
  isActive: z.boolean().default(true),
  usageLimit: z.number().int().min(1).optional().nullable(),
});

export const settingsSchema = z.object({
  currencySymbol: z.string().trim().min(1).max(5).optional(),
  taxPercent: z.number().min(0).max(50).optional(),
  taxLabel: z.string().trim().max(30).optional(),
  platformFee: z.number().min(0).max(1000).optional(),
  baseDeliveryFee: z.number().min(0).max(2000).optional(),
  minOrderDefault: z.number().min(0).max(50_000).optional(),
  /** Fallback city only — the live list is managed through /admin/cities. */
  serviceCity: z.string().trim().max(60).optional(),
  supportEmail: z.string().email().optional().nullable(),
  supportPhone: z.string().trim().max(30).optional().nullable(),
  supportWhatsApp: z.string().trim().max(30).optional().nullable(),
  termsUrl: z.string().url().optional().nullable(),
  privacyUrl: z.string().url().optional().nullable(),
  announcementTitle: z.string().trim().max(80).optional().nullable(),
  announcementBody: z.string().trim().max(300).optional().nullable(),
  appBannerImages: z.array(z.string().url()).max(10).optional(),
});

export const serviceCitySchema = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z.string().trim().min(2).max(60).regex(/^[a-z0-9-]+$/, 'Slug may contain lowercase letters, numbers and dashes only.').optional(),
  province: z.string().trim().max(60).optional().nullable(),
  location: latLng,
  radiusKm: z.number().min(1).max(200).default(25),
  baseDeliveryFee: z.number().min(0).max(2000).default(99),
  perKmFee: z.number().min(0).max(500).default(12),
  minOrderAmount: z.number().min(0).max(50_000).default(300),
  etaBaseMin: z.number().int().min(5).max(180).default(20),
  etaPerKmMin: z.number().min(0).max(30).default(2.5),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
});

export const faqSchema = z.object({ question: z.string().trim().min(3).max(200), answer: z.string().trim().min(3).max(2000), sortOrder: z.number().int().min(0).default(0), isActive: z.boolean().default(true) });

// ───────────────────────── Riders ─────────────────────────

export const riderApplySchema = z.object({
  name: z.string().trim().min(2).max(80),
  email,
  phone: pkMobile,
  vehicleType: z.string().trim().max(40).optional().nullable(),
  plateNumber: z.string().trim().max(20).optional().nullable(),
  imageUrl: z.string().url().optional().nullable(),
  documentUrls: z.array(z.string().url()).max(5).default([]),
});

export const riderLocationSchema = latLng.extend({ heading: z.number().min(0).max(360).optional(), orderId: z.string().optional() });

export const riderUpdateSchema = riderApplySchema.partial().extend({ isAvailable: z.boolean().optional() });

export const broadcastSchema = z.object({ title: z.string().trim().min(2).max(80), body: z.string().trim().min(2).max(300), role: z.enum(['CUSTOMER', 'RIDER']).default('CUSTOMER') });

export const blockSchema = z.object({ blocked: z.boolean() });
