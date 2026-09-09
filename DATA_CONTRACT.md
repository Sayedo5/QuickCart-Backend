# QuickCart — Data Contract

Every field the mobile app renders, the endpoint that produces it, and the shape it
arrives in. The authoritative TypeScript lives in `src/services/api.types.ts` (app)
and `src/utils/serialize.ts` (backend); this document is the map between them.

Every response is wrapped:

```json
{ "success": true, "data": <payload>, "message": "…", "error": null }
```

The app unwraps `data` in `src/services/http.ts`, so the tables below describe the payload.

---

## Screen → endpoint map

| Screen | Endpoint(s) |
| --- | --- |
| Login | `POST /auth/send-otp` |
| OTP | `POST /auth/verify-otp` |
| Complete profile | `POST /auth/signup` |
| Home | `GET /stores`, `GET /banners`, `GET /settings/public` |
| Search | `GET /search?q=` |
| Store detail | `GET /stores/:id`, `GET /stores/:id/menu` |
| Cart | `POST /orders/quote`, `POST /coupons/validate` |
| Checkout | `POST /orders/quote`, `POST /orders`, `GET /addresses`, `GET /payment-methods` |
| Order tracking | `GET /orders/:id` + sockets `order:status`, `rider:location` |
| Order history | `GET /orders/my` |
| Rate & review | `POST /orders/:id/review` |
| Profile | `GET /auth/me`, `GET /wallet`, `GET /favourites` |
| Addresses | `GET/POST/PATCH/DELETE /addresses` |
| Payment methods | `GET/POST/DELETE /payment-methods` |
| Wallet | `GET /wallet`, `POST /wallet/top-up` |
| Favourites | `GET /favourites`, `POST|DELETE /favourites/:storeId` |
| Offers | `GET /coupons`, `POST /coupons/validate` |
| Help | `GET /content/faqs`, `GET /settings/public` |
| Edit profile | `PATCH /users/me` |
| Notifications (inbox) | `GET /notifications`, `POST /notifications/read-all` |

---

## Shapes

### User — `GET /auth/me`, and inside auth results

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `name` | string | |
| `email` | string | login identifier |
| `phone` | string | local digits without the leading 0, e.g. `3001234567` |
| `dialCode` | string | `+92` |
| `avatar` | string | URL; falls back to a generated avatar |
| `role` | `customer \| rider \| admin` | |
| `isVerified`, `isBlocked` | boolean | |
| `walletBalance` | number | PKR |
| `memberSince` | ISO string | |

### Auth

`POST /auth/send-otp` `{ email, purpose }` →
`{ sessionId, destination, channel: "email", expiresIn, isNewUser, devCode? }`
`devCode` appears only in backend development mode without SMTP.

`POST /auth/verify-otp` `{ email, code }` →
`{ isNewUser: false, user, tokens }` or `{ isNewUser: true, signupToken }`

`POST /auth/signup` `{ signupToken, name, phone, dialCode }` → `{ user, tokens }`

`tokens` = `{ accessToken, refreshToken }`. Access tokens last 15 minutes and are
refreshed silently at `POST /auth/refresh`.

### Store — `GET /stores` (paginated), `GET /stores/:id`

| Field | Type |
| --- | --- |
| `id`, `name`, `area`, `address` | string |
| `category` | `restaurants \| grocery \| pharmacy` |
| `image`, `coverImage` | string URL |
| `description?` | string |
| `rating`, `ratingCount` | number |
| `deliveryTimeMin`, `deliveryTimeMax` | number (minutes) |
| `deliveryFee`, `minOrder`, `distanceKm` | number |
| `tags` | string[] |
| `isOpen` | boolean |
| `status` | `pending \| approved \| rejected \| suspended` (only approved reach the app) |
| `promoLabel?` | string |
| `location` | `{ latitude, longitude }` |
| `createdAt` | ISO string |

Paginated list responses are `{ items, page, perPage, total, totalPages }`.

### MenuCategory / Product — `GET /stores/:id/menu`

`{ categories: MenuCategory[], products: Product[] }`

MenuCategory: `{ id, storeId, name, sortOrder }`

| Product field | Type | Notes |
| --- | --- | --- |
| `id`, `storeId`, `categoryId` | string | `categoryId` is the menu section |
| `name`, `description` | string | |
| `price` | number | PKR |
| `compareAtPrice?` | number | struck-through original |
| `discountPercent` | number | applied server-side at quote time |
| `image` | string URL | |
| `unit?` | string | e.g. `1 kg`, `10 tablets` |
| `isVeg?` | boolean | absent when not applicable |
| `isPopular`, `inStock` | boolean | |
| `sortOrder` | number | |

### Banner — `GET /banners`

`{ id, title, subtitle?, label?, image?, target: { type, value? }, colors: [from, to], sortOrder }`
`target.type` is `offers | store | category | external`.

### AppSettings — `GET /settings/public`

`{ currencySymbol, taxRate, taxPercent, taxLabel, platformFee, baseDeliveryFee,
minOrderDefault, serviceCity, supportEmail, supportPhone, supportWhatsApp?,
termsUrl?, privacyUrl?, announcement: { title, body } | null }`

The app caches this and uses `taxLabel`, `currencySymbol`, support contacts and the
announcement banner from it. Editing it in the admin panel changes the app with no release.

### Address — `GET /addresses`

`{ id, label: "Home"|"Work"|"Other", street, apartment?, city, instructions?, isDefault,
location: { latitude, longitude } }`

### PaymentMethod — `GET /payment-methods`

`{ id, type: "cash"|"card"|"wallet"|"jazzcash"|"easypaisa", label, subtitle,
brand?, last4?, expiry?, mobileNumber?, isDefault }`

Adding a card posts `{ type: "card", holder, number, expiry }`. The server validates the
number with Luhn, detects the brand, then stores **only** brand and last4.
Adding a wallet posts `{ type: "jazzcash"|"easypaisa", mobileNumber }`.

### Coupon / Promo — `GET /coupons`, `POST /coupons/validate`

`{ code, description, type: "percent"|"fixed"|"free_delivery", value, maxDiscount?, minOrder? }`

### CartQuote — `POST /orders/quote`

Request: `{ storeId, items: [{ productId, quantity, unitPrice? }], promoCode? }`

| Field | Type | Notes |
| --- | --- | --- |
| `subtotal`, `deliveryFee`, `serviceFee`, `tax`, `discount`, `total` | number | server-calculated |
| `itemCount` | number | |
| `taxLabel` | string | from Settings |
| `minOrder` | number | this store's minimum |
| `promo` | Promo \| null | validated coupon |
| `issues` | `{ productId, type, newPrice? }[]` | `out_of_stock`, `price_changed`, `unavailable` |

`unitPrice` is what the app displayed; the server compares it and reports `price_changed`.

### Order — `POST /orders`, `GET /orders/my`, `GET /orders/:id`

Request: `{ storeId, items, promoCode?, addressId, paymentMethodId, note? }`

| Field | Type | Notes |
| --- | --- | --- |
| `id`, `orderNumber` | string | generated by the server (`QC-48213`) |
| `storeId`, `storeName`, `storeImage`, `storeLocation` | | |
| `items` | `{ product: {...}, quantity }[]` | names and prices are snapshots |
| `subtotal`…`total` | number | |
| `promoCode?` | string | |
| `paymentMethod` | `{ id, type, label }` | |
| `paymentStatus` | `pending \| paid \| failed \| refunded` | |
| `address` | snapshot with `location` | |
| `status` | `placed \| confirmed \| preparing \| picked_up \| delivered \| cancelled` | |
| `timeline` | `{ placedAt, confirmedAt?, preparingAt?, pickedUpAt?, deliveredAt?, cancelledAt? }` | |
| `statusHistory` | `{ status, note?, at }[]` | |
| `estimatedDeliveryAt` | ISO string | drives the ETA countdown |
| `rider` | Rider or an "Assigning rider…" placeholder | |
| `rating?` | `{ stars, comment?, tip }` | |
| `cancelledReason?` | string | |

### Rider (inside an order)

`{ id, name, avatar, phone, rating, vehicle, plate }`, plus for admins
`{ status, isAvailable, completedOrders, documentUrls, location }`.

### Wallet — `GET /wallet`

`{ balance, transactions: [{ id, type: "topup"|"payment"|"refund"|"cashback",
amount, title, subtitle?, createdAt }] }` — `amount` is negative for payments.

### Notification — `GET /notifications`

`{ id, title, body, type: "order"|"promo"|"wallet"|"system", orderId?, read, createdAt }`

### Faq — `GET /content/faqs`

`{ id, question, answer }`

---

## Realtime

Connect to `EXPO_PUBLIC_SOCKET_URL` with `auth: { token: accessToken }`,
then `emit("order:join", { orderId })`.

| Event | Payload | Effect in the app |
| --- | --- | --- |
| `order:status` | `{ orderId, status, at, estimatedDeliveryAt }` | stepper advances, ETA updates, local notification fires |
| `rider:location` | `{ orderId, latitude, longitude, heading?, at }` | the rider pin moves on the tracking map |

---

## Errors

Failures share one shape, surfaced to the app as `ApiError { code, message, status }`:

```json
{ "success": false, "data": null, "message": null,
  "error": { "code": "MIN_ORDER", "message": "Minimum order for Biryani Express is Rs 400." } }
```

| Code | Meaning | How the app reacts |
| --- | --- | --- |
| `NETWORK` / `TIMEOUT` | request never reached the server | offline banner, retry button, cached data stays |
| `UNAUTHORIZED` | access token expired | one silent refresh; a second failure signs the user out |
| `VALIDATION` | 422 with field details | inline field error |
| `INVALID_OTP` / `OTP_EXPIRED` / `OTP_COOLDOWN` | OTP problems | red shake, inline message, resend timer |
| `INVALID_CARD` | Luhn failed | inline error on the card field |
| `PROMO_INVALID` / `PROMO_MIN_ORDER` / `PROMO_EXPIRED` | coupon rejected | red text under the promo input |
| `OUT_OF_STOCK` / `PRICE_CHANGED` | cart drifted from the catalog | banner on the cart, checkout blocked until resolved |
| `MIN_ORDER` | below the store minimum | "Add Rs X more" hint, checkout disabled |
| `STORE_CLOSED` | store went offline mid-order | alert, order not placed |
| `INSUFFICIENT_WALLET` | balance too low | alert with a top-up shortcut |
| `SERVER` / `INTERNAL` | 5xx | generic retry message, reported to Sentry |
