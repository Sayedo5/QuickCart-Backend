/**
 * End-to-end smoke test against a running server.
 *   npm run dev          (terminal 1)
 *   npm run smoke        (terminal 2)
 * Exercises the full customer journey plus the admin controls.
 */
import { prisma } from '../src/config/db';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:4000/api/v1';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@quickcart.pk';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345';
const CUSTOMER_EMAIL = `smoke.${Date.now()}@quickcart.test`;

let passed = 0;
let failed = 0;

const check = (name: string, condition: boolean, extra?: unknown) => {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : '');
  }
};

interface Envelope<T> {
  success: boolean;
  data: T;
  message?: string | null;
  error?: { code: string; message: string } | null;
}

const call = async <T>(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: Envelope<T> }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({ success: false, data: null }))) as Envelope<T>;
  return { status: res.status, json };
};

async function main() {
  console.log(`\n🔍 Smoke testing ${BASE}\n`);

  // ── Public ──
  const health = await fetch(`${BASE.replace('/api/v1', '')}/health`).then((r) => r.json() as Promise<Envelope<{ status: string }>>);
  check('health endpoint responds', health.data?.status === 'ok');

  const settings = await call<{ taxLabel: string; platformFee: number }>('GET', '/settings/public');
  check('public settings load', settings.json.success && settings.json.data.platformFee >= 0);

  const stores = await call<{ items: Array<{ id: string; name: string; minOrder: number }>; total: number }>('GET', '/stores?perPage=50');
  check('store list returns approved stores', stores.json.data.items.length > 0, stores.json.error);
  check('store list paginates', typeof stores.json.data.total === 'number');

  const openStore = stores.json.data.items.find((s) => s.name === 'Biryani Express') ?? stores.json.data.items[0];
  const menu = await call<{ categories: unknown[]; products: Array<{ id: string; name: string; price: number }> }>('GET', `/stores/${openStore.id}/menu`);
  check('store menu returns products', menu.json.data.products.length > 0);

  const search = await call<{ stores: unknown[]; products: unknown[] }>('GET', '/search?q=biryani');
  check('search finds biryani', search.json.data.products.length > 0 || search.json.data.stores.length > 0);

  const banners = await call<unknown[]>('GET', '/banners');
  check('banners load', Array.isArray(banners.json.data));

  const badStore = await call('GET', '/stores/does-not-exist');
  check('unknown store returns 404 envelope', badStore.status === 404 && badStore.json.success === false);

  // ── Auth: email OTP signup ──
  const otp = await call<{ devCode?: string; destination: string; isNewUser: boolean }>('POST', '/auth/send-otp', { email: CUSTOMER_EMAIL, purpose: 'signup' });
  check('OTP requested for new email', otp.json.success && otp.json.data.isNewUser === true, otp.json.error);
  const devCode = otp.json.data?.devCode ?? (await prisma.otp.findFirst({ where: { email: CUSTOMER_EMAIL }, orderBy: { createdAt: 'desc' } }))?.code;
  check('OTP code available for test', !!devCode);

  const wrongCode = await call('POST', '/auth/verify-otp', { email: CUSTOMER_EMAIL, code: '000000' });
  check('wrong OTP rejected', wrongCode.status === 400 && wrongCode.json.error?.code === 'INVALID_OTP', wrongCode.json.error);

  const verify = await call<{ isNewUser: boolean; signupToken?: string }>('POST', '/auth/verify-otp', { email: CUSTOMER_EMAIL, code: devCode! });
  check('correct OTP verifies', verify.json.success && !!verify.json.data.signupToken, verify.json.error);

  const signup = await call<{ user: { id: string; email: string }; tokens: { accessToken: string; refreshToken: string } }>('POST', '/auth/signup', {
    signupToken: verify.json.data.signupToken,
    name: 'Smoke Tester',
    phone: '03009998877',
    dialCode: '+92',
  });
  check('signup completes and issues tokens', signup.json.success && !!signup.json.data.tokens.accessToken, signup.json.error);
  const customerToken = signup.json.data?.tokens?.accessToken;
  const refreshToken = signup.json.data?.tokens?.refreshToken;

  const me = await call<{ email: string }>('GET', '/auth/me', undefined, customerToken);
  check('/auth/me returns the customer', me.json.data?.email === CUSTOMER_EMAIL);

  const noAuth = await call('GET', '/auth/me');
  check('protected route rejects missing token', noAuth.status === 401);

  const refreshed = await call<{ accessToken: string }>('POST', '/auth/refresh', { refreshToken });
  check('refresh token rotates', refreshed.json.success && !!refreshed.json.data.accessToken, refreshed.json.error);

  // ── Account ──
  const address = await call<{ id: string }>('POST', '/addresses', {
    label: 'Home',
    street: 'House 7, Street 12, Phase 5',
    apartment: 'DHA',
    city: 'Lahore, Punjab',
    location: { latitude: 31.4697, longitude: 74.41 },
  }, customerToken);
  check('address created', address.json.success && !!address.json.data.id, address.json.error);

  const badAddress = await call('POST', '/addresses', { label: 'Home', street: 'ab', city: 'L' }, customerToken);
  check('invalid address rejected with 422', badAddress.status === 422, badAddress.json.error);

  const methods = await call<Array<{ id: string; type: string }>>('GET', '/payment-methods', undefined, customerToken);
  check('default payment methods seeded', methods.json.data.length >= 2, methods.json.error);
  const cashMethod = methods.json.data.find((m) => m.type === 'cash')!;

  const badCard = await call('POST', '/payment-methods', { type: 'card', holder: 'Smoke Tester', number: '4242424242424241', expiry: '08/30' }, customerToken);
  check('card failing Luhn is rejected', badCard.status === 422 && badCard.json.error?.code === 'INVALID_CARD', badCard.json.error);

  const goodCard = await call<{ id: string; brand?: string }>('POST', '/payment-methods', { type: 'card', holder: 'Smoke Tester', number: '4242 4242 4242 4242', expiry: '08/30' }, customerToken);
  check('valid Visa accepted and brand detected', goodCard.json.success && goodCard.json.data.brand === 'visa', goodCard.json.error);

  const badWallet = await call('POST', '/payment-methods', { type: 'jazzcash', mobileNumber: '042111000' }, customerToken);
  check('non-mobile number rejected for JazzCash', badWallet.status === 422, badWallet.json.error);

  const wallet = await call<{ id: string }>('POST', '/payment-methods', { type: 'easypaisa', mobileNumber: '0345 1234567' }, customerToken);
  check('Easypaisa number linked', wallet.json.success, wallet.json.error);

  // ── Cart quote & order ──
  const items = menu.json.data.products.slice(0, 3).map((p) => ({ productId: p.id, quantity: 2 }));
  const quote = await call<{ subtotal: number; total: number; tax: number; issues: unknown[] }>('POST', '/orders/quote', { storeId: openStore.id, items }, customerToken);
  check('cart quote computes totals server-side', quote.json.success && quote.json.data.total > quote.json.data.subtotal, quote.json.error);

  const badPromo = await call('POST', '/orders/quote', { storeId: openStore.id, items, promoCode: 'NOPE123' }, customerToken);
  check('invalid promo rejected', badPromo.status === 404, badPromo.json.error);

  const promoQuote = await call<{ discount: number }>('POST', '/orders/quote', { storeId: openStore.id, items, promoCode: 'WELCOME20' }, customerToken);
  check('WELCOME20 applies a discount', promoQuote.json.data?.discount > 0, promoQuote.json.error);

  const emptyOrder = await call('POST', '/orders', { storeId: openStore.id, items: [], addressId: address.json.data.id, paymentMethodId: cashMethod.id }, customerToken);
  check('empty cart cannot be ordered', emptyOrder.status === 422, emptyOrder.json.error);

  const order = await call<{ id: string; orderNumber: string; total: number; status: string }>('POST', '/orders', {
    storeId: openStore.id,
    items,
    promoCode: 'WELCOME20',
    addressId: address.json.data.id,
    paymentMethodId: cashMethod.id,
    note: 'Smoke test order',
  }, customerToken);
  check('order placed with server-generated id', order.json.success && /^QC-/.test(order.json.data.orderNumber), order.json.error);
  check('order starts in placed status', order.json.data?.status === 'placed');
  const orderId = order.json.data?.id;

  const myOrders = await call<Array<{ id: string }>>('GET', '/orders/my', undefined, customerToken);
  check('order appears in history', myOrders.json.data.some((o) => o.id === orderId));

  // ── Admin ──
  const adminLogin = await call<{ user: { role: string }; tokens: { accessToken: string } }>('POST', '/auth/admin/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check('admin logs in with password', adminLogin.json.success && adminLogin.json.data.user.role === 'admin', adminLogin.json.error);
  const adminToken = adminLogin.json.data?.tokens?.accessToken;

  const wrongPassword = await call('POST', '/auth/admin/login', { email: ADMIN_EMAIL, password: 'wrong-password' });
  check('wrong admin password rejected', wrongPassword.status === 401);

  const customerOnAdmin = await call('GET', '/admin/stats', undefined, customerToken);
  check('customer cannot reach admin routes', customerOnAdmin.status === 403, customerOnAdmin.json.error);

  const stats = await call<{ ordersToday: number; pendingRiders: number; series: unknown[] }>('GET', '/admin/stats', undefined, adminToken);
  check('admin stats load', stats.json.success && Array.isArray(stats.json.data.series), stats.json.error);
  check('stats count today\'s order', stats.json.data?.ordersToday >= 1);

  const allOrders = await call<{ items: Array<{ id: string }> }>('GET', '/orders/all?perPage=5', undefined, adminToken);
  check('admin lists all orders', allOrders.json.success && allOrders.json.data.items.length > 0, allOrders.json.error);

  const riders = await call<{ items: Array<{ id: string; status: string; name: string }> }>('GET', '/riders?perPage=20', undefined, adminToken);
  check('admin lists riders', riders.json.data.items.length > 0, riders.json.error);
  const approvedRider = riders.json.data.items.find((r) => r.status === 'approved')!;
  const pendingRider = riders.json.data.items.find((r) => r.status === 'pending');

  const assign = await call<{ rider: { id: string } }>('PUT', `/orders/${orderId}/assign-rider`, { riderId: approvedRider.id }, adminToken);
  check('admin assigns a rider', assign.json.success, assign.json.error);

  const confirm = await call<{ status: string }>('PUT', `/orders/${orderId}/status`, { status: 'confirmed' }, adminToken);
  check('order moves to confirmed', confirm.json.data?.status === 'confirmed', confirm.json.error);

  const backwards = await call('PUT', `/orders/${orderId}/status`, { status: 'placed' }, adminToken);
  check('backwards status transition blocked', backwards.status === 409, backwards.json.error);

  await call('PUT', `/orders/${orderId}/status`, { status: 'preparing' }, adminToken);
  const pickedUp = await call<{ status: string }>('PUT', `/orders/${orderId}/status`, { status: 'picked_up' }, adminToken);
  check('order moves to picked_up', pickedUp.json.data?.status === 'picked_up', pickedUp.json.error);

  const location = await call<{ orders: string[] }>('PUT', `/riders/${approvedRider.id}/location`, { latitude: 31.5, longitude: 74.35, heading: 90 }, adminToken);
  check('rider location update reaches the active order', location.json.data?.orders.includes(orderId!), location.json.error);

  const delivered = await call<{ status: string }>('PUT', `/orders/${orderId}/status`, { status: 'delivered' }, adminToken);
  check('order delivered', delivered.json.data?.status === 'delivered', delivered.json.error);

  const review = await call<{ rating: { stars: number } }>('POST', `/orders/${orderId}/review`, { stars: 5, comment: 'Smoke test review', tags: ['On time'], tip: 100 }, customerToken);
  check('delivered order can be reviewed', review.json.data?.rating?.stars === 5, review.json.error);

  const lateCancel = await call('POST', `/orders/${orderId}/cancel`, {}, customerToken);
  check('delivered order cannot be cancelled', lateCancel.status === 409, lateCancel.json.error);

  // Rider approval flow
  if (pendingRider) {
    const approve = await call<{ status: string }>('PUT', `/riders/${pendingRider.id}/approve`, { status: 'approved' }, adminToken);
    check('admin approves a pending rider', approve.json.data?.status === 'approved', approve.json.error);
    await call('PUT', `/riders/${pendingRider.id}/approve`, { status: 'pending' }, adminToken); // reset for the demo
  }

  const rejectNoReason = await call('PUT', `/riders/${approvedRider.id}/approve`, { status: 'rejected' }, adminToken);
  check('rejection requires a reason', rejectNoReason.status === 422, rejectNoReason.json.error);

  // Admin catalog control reflected in the customer API
  const product = menu.json.data.products[0];
  const newPrice = Math.round(product.price + 37);
  const priceUpdate = await call<{ price: number }>('PUT', `/admin/products/${product.id}`, { price: newPrice }, adminToken);
  check('admin updates a product price', priceUpdate.json.data?.price === newPrice, priceUpdate.json.error);
  const menuAfter = await call<{ products: Array<{ id: string; price: number }> }>('GET', `/stores/${openStore.id}/menu`);
  check('price change is live in the customer API', menuAfter.json.data.products.find((p) => p.id === product.id)?.price === newPrice);
  await call('PUT', `/admin/products/${product.id}`, { price: product.price }, adminToken); // restore

  const stockOff = await call<{ inStock: boolean }>('PUT', `/admin/products/${product.id}`, { inStock: false }, adminToken);
  check('admin can toggle stock off', stockOff.json.data?.inStock === false);
  const oosOrder = await call('POST', '/orders', { storeId: openStore.id, items: [{ productId: product.id, quantity: 1 }], addressId: address.json.data.id, paymentMethodId: cashMethod.id }, customerToken);
  check('out-of-stock item blocks checkout', oosOrder.status === 409 && oosOrder.json.error?.code === 'OUT_OF_STOCK', oosOrder.json.error);
  await call('PUT', `/admin/products/${product.id}`, { inStock: true }, adminToken); // restore

  const settingsUpdate = await call<{ platformFee: number }>('PUT', '/admin/settings', { platformFee: 39 }, adminToken);
  check('admin updates global settings', settingsUpdate.json.data?.platformFee === 39, settingsUpdate.json.error);
  const publicAfter = await call<{ platformFee: number }>('GET', '/settings/public');
  check('settings change is live for the app', publicAfter.json.data?.platformFee === 39);
  await call('PUT', '/admin/settings', { platformFee: 29 }, adminToken); // restore

  const pendingStores = await call<{ items: Array<{ id: string; name: string; status: string }> }>('GET', '/admin/stores?status=pending', undefined, adminToken);
  check('pending store applications are listed', pendingStores.json.data.items.length > 0, pendingStores.json.error);

  const users = await call<{ items: unknown[] }>('GET', '/admin/users?perPage=5', undefined, adminToken);
  check('admin lists users', users.json.data.items.length > 0, users.json.error);

  const coupon = await call<{ id: string; code: string }>('POST', '/admin/coupons', {
    code: `SMOKE${Date.now().toString().slice(-5)}`,
    description: 'Smoke test coupon',
    type: 'fixed',
    value: 50,
    minOrder: 100,
    expiryDate: new Date(Date.now() + 86_400_000).toISOString(),
  }, adminToken);
  check('admin creates a coupon', coupon.json.success, coupon.json.error);
  if (coupon.json.data?.id) await call('DELETE', `/admin/coupons/${coupon.json.data.id}`, undefined, adminToken);

  // ── Cleanup ──
  await prisma.order.deleteMany({ where: { user: { email: CUSTOMER_EMAIL } } });
  await prisma.user.deleteMany({ where: { email: CUSTOMER_EMAIL } });
  await prisma.otp.deleteMany({ where: { email: CUSTOMER_EMAIL } });

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('Smoke run crashed:', e);
  await prisma.$disconnect();
  process.exit(1);
});
