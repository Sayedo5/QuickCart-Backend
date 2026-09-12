/**
 * End-to-end integration check across all three QuickCart projects.
 *
 * Proves the loop the mobile app and admin panel actually depend on:
 *   1. A product edited in the admin panel is visible to the customer app.
 *   2. An order placed by the app reaches the admin dashboard live (order:new).
 *   3. A status change made by the admin reaches the app live (order:status).
 *   4. A rider location pushed by the admin reaches the app live (rider:location).
 *
 * Run against a server that is already up:  npm run dev  (in another terminal)
 * then:                                     npm run integration
 */
import { io, Socket } from 'socket.io-client';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:4000';
const API = `${BASE}/api/v1`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@quickcart.pk';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345';

let passed = 0;
let failed = 0;

const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
  }
};

interface Envelope<T> {
  success: boolean;
  data: T;
  message: string | null;
  error: { code: string; message: string } | null;
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<Envelope<T>> {
  const { token, ...rest } = init;
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
  });
  return (await res.json()) as Envelope<T>;
}

/**
 * Buffers every event of interest as it arrives. The database is a serverless
 * Postgres in another region, so a write can easily outlast a naive timeout
 * started before the request — buffering lets us wait for the event *after* the
 * triggering call has returned, without ever missing one that arrived early.
 */
type Recorder = {
  events: Array<{ event: string; payload: unknown }>;
  await<T>(event: string, predicate: (payload: T) => boolean, ms?: number): Promise<T | null>;
};

function record(socket: Socket, events: string[]): Recorder {
  const seen: Array<{ event: string; payload: unknown }> = [];
  events.forEach((e) => socket.on(e, (payload: unknown) => seen.push({ event: e, payload })));
  return {
    events: seen,
    async await<T>(event: string, predicate: (payload: T) => boolean, ms = 15000): Promise<T | null> {
      const deadline = Date.now() + ms;
      for (;;) {
        const hit = seen.find((s) => s.event === event && predicate(s.payload as T));
        if (hit) return hit.payload as T;
        if (Date.now() > deadline) return null;
        await new Promise((r) => setTimeout(r, 100));
      }
    },
  };
}

const connect = (token: string): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const socket = io(BASE, { transports: ['websocket'], auth: { token }, reconnection: false });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timeout')), 8000);
  });

async function main() {
  console.log(`\n🔗 QuickCart end-to-end integration — ${BASE}\n`);

  // ── Admin signs in (the admin panel's login flow) ──
  const adminLogin = await call<{ user: { role: string }; tokens: { accessToken: string } }>('/auth/admin/login', {
    method: 'POST',
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  check('admin panel signs in', adminLogin.success && adminLogin.data.user.role === 'admin', adminLogin.error);
  if (!adminLogin.success) throw new Error('cannot continue without an admin session');
  const adminToken = adminLogin.data.tokens.accessToken;

  // ── Customer signs in with email OTP (the app's login flow) ──
  const email = `integration+${Date.now()}@quickcart.test`;
  const otpRes = await call<{ devCode?: string }>('/auth/send-otp', {
    method: 'POST',
    body: JSON.stringify({ email, purpose: 'signup' }),
  });
  check('app requests an email OTP', otpRes.success, otpRes.error);
  const code = otpRes.data?.devCode;
  check('OTP code is available for the test run', !!code, 'set SMTP_HOST="" in dev so the code is returned');
  if (!code) throw new Error('no OTP code');

  const verify = await call<{ isNewUser: boolean; signupToken?: string }>('/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  });
  check('app verifies the OTP', verify.success, verify.error);
  check('new account receives a signup token', !!verify.data?.signupToken, verify.data);

  const signup = await call<{ user: { id: string }; tokens: { accessToken: string } }>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      signupToken: verify.data.signupToken,
      name: 'Integration Customer',
      phone: '3001234567',
      dialCode: '+92',
    }),
  });
  check('app completes signup and receives JWTs', signup.success && !!signup.data.tokens.accessToken, signup.error);
  if (!signup.success) throw new Error('signup failed');
  const customerToken = signup.data.tokens.accessToken;

  // ── 1. Admin edits a product → the app sees the new price ──
  const productsRes = await call<{ items: Array<{ id: string; name: string; price: number; storeId: string }> }>(
    '/admin/products?page=1&limit=1',
    { token: adminToken },
  );
  check('admin panel lists products', productsRes.success && productsRes.data.items.length > 0, productsRes.error);
  const product = productsRes.data.items[0];
  const newPrice = Math.round(product.price) + 7;

  const updated = await call<{ price: number }>(`/admin/products/${product.id}`, {
    method: 'PUT',
    token: adminToken,
    body: JSON.stringify({ price: newPrice }),
  });
  check('admin changes a product price', updated.success && updated.data.price === newPrice, updated.error);

  const menu = await call<{ products: Array<{ id: string; price: number }> }>(`/stores/${product.storeId}/menu`);
  const seenByApp = menu.data.products.find((p) => p.id === product.id);
  check('price change is live in the app with no code change', seenByApp?.price === newPrice, {
    expected: newPrice,
    got: seenByApp?.price,
  });

  // ── Sockets: customer app + admin dashboard ──
  const customerSocket = await connect(customerToken);
  const adminSocket = await connect(adminToken);
  check('app opens an authenticated socket', customerSocket.connected);
  check('admin dashboard opens an authenticated socket', adminSocket.connected);

  const appEvents = record(customerSocket, ['order:status', 'rider:location']);
  const adminEvents = record(adminSocket, ['order:new', 'order:updated', 'rider:location']);

  // ── 2. App places an order → admin dashboard hears order:new ──
  const address = await call<{ id: string }>('/addresses', {
    method: 'POST',
    token: customerToken,
    body: JSON.stringify({
      label: 'Home',
      street: '12 Integration Street, DHA Phase 5',
      city: 'Lahore',
      location: { latitude: 31.479, longitude: 74.438 },
      isDefault: true,
    }),
  });
  check('app saves a delivery address', address.success, address.error);

  const methods = await call<Array<{ id: string; type: string }>>('/payment-methods', { token: customerToken });
  const cod = methods.data.find((m) => m.type === 'cod') ?? methods.data[0];
  check('app has a payment method', !!cod, methods.error);

  const quote = await call<{ total: number; subtotal: number; tax: number }>('/orders/quote', {
    method: 'POST',
    token: customerToken,
    body: JSON.stringify({
      storeId: product.storeId,
      items: [{ productId: product.id, quantity: 2 }],
      addressId: address.data.id,
    }),
  });
  check('server computes the cart totals', quote.success && quote.data.total > 0, quote.error);

  const placed = await call<{ id: string; orderNumber: string; total: number; status: string }>('/orders', {
    method: 'POST',
    token: customerToken,
    body: JSON.stringify({
      storeId: product.storeId,
      items: [{ productId: product.id, quantity: 2 }],
      addressId: address.data.id,
      paymentMethodId: cod.id,
    }),
  });
  check('app places an order and gets a real server id', placed.success && !!placed.data.id, placed.error);
  check('order total matches the server quote', placed.data?.total === quote.data?.total, {
    quoted: quote.data?.total,
    ordered: placed.data?.total,
  });
  const orderId = placed.data.id;

  const newOrderEvent = await adminEvents.await<{ id: string }>('order:new', (e) => e.id === orderId);
  check('admin dashboard receives order:new live', !!newOrderEvent, adminEvents.events.length);

  // The app joins the order room to follow it live.
  customerSocket.emit('order:join', { orderId });
  await new Promise((r) => setTimeout(r, 1000));

  // ── 3. Admin assigns a rider, then drives the status machine ──
  const riders = await call<{ items: Array<{ id: string; status: string }> }>('/riders?page=1&perPage=20&status=approved', {
    token: adminToken,
  });
  const rider = riders.data.items.find((r) => r.status === 'approved');
  check('admin lists approved riders', !!rider, riders.error ?? riders.data.items.map((r) => r.status));
  if (!rider) throw new Error('no approved rider to assign — run: npm run seed');

  const assigned = await call(`/orders/${orderId}/assign-rider`, {
    method: 'PUT',
    token: adminToken,
    body: JSON.stringify({ riderId: rider.id }),
  });
  check('admin assigns a rider to the order', assigned.success, assigned.error);

  for (const next of ['confirmed', 'preparing', 'picked_up'] as const) {
    const res = await call(`/orders/${orderId}/status`, {
      method: 'PUT',
      token: adminToken,
      body: JSON.stringify({ status: next }),
    });
    check(`admin moves the order to ${next}`, res.success, res.error);
    const event = await appEvents.await<{ orderId: string; status: string }>(
      'order:status',
      (e) => e.orderId === orderId && e.status === next,
    );
    check(`app receives order:status "${next}" live`, !!event, event);
  }

  // ── 4. Rider location reaches the app's tracking map ──
  const loc = await call(`/riders/${rider.id}/location`, {
    method: 'PUT',
    token: adminToken,
    body: JSON.stringify({ latitude: 31.4805, longitude: 74.4402, heading: 90 }),
  });
  check('rider location update accepted', loc.success, loc.error);
  const locationEvent = await appEvents.await<{ orderId: string }>('rider:location', (e) => e.orderId === orderId);
  check('app receives rider:location live for the tracked order', !!locationEvent, locationEvent);

  // ── Deliver, and confirm the app can read the finished order ──
  const delivered = await call(`/orders/${orderId}/status`, {
    method: 'PUT',
    token: adminToken,
    body: JSON.stringify({ status: 'delivered' }),
  });
  check('admin marks the order delivered', delivered.success, delivered.error);

  const history = await call<Array<{ id: string; status: string }>>('/orders/my', { token: customerToken });
  const inHistory = history.data.find((o) => o.id === orderId);
  check('order appears as delivered in the app history', inHistory?.status === 'delivered', inHistory);

  // ── Settings change flows to the app ──
  const settingsBefore = await call<{ platformFee: number }>('/admin/settings', { token: adminToken });
  const bumped = Math.round(settingsBefore.data.platformFee) + 1;
  await call('/admin/settings', {
    method: 'PUT',
    token: adminToken,
    body: JSON.stringify({ ...settingsBefore.data, platformFee: bumped }),
  });
  const publicSettings = await call<{ platformFee: number }>('/settings/public');
  check('settings change is live for the app', publicSettings.data.platformFee === bumped, publicSettings.data);
  // Put it back so repeated runs stay stable.
  await call('/admin/settings', {
    method: 'PUT',
    token: adminToken,
    body: JSON.stringify(settingsBefore.data),
  });

  // Restore the product price too.
  await call(`/admin/products/${product.id}`, {
    method: 'PUT',
    token: adminToken,
    body: JSON.stringify({ price: product.price }),
  });

  customerSocket.close();
  adminSocket.close();

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n💥 Integration run crashed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
