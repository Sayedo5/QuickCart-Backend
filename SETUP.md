# QuickCart Backend — Setup

Node.js + Express + TypeScript API on **Neon (serverless PostgreSQL)** via **Prisma**, with
Socket.io realtime, email OTP auth (Nodemailer) and Cloudinary image uploads.
This is the only project that talks to the database. The mobile app and the admin
panel both go through this API.

---

## 1. Requirements

| Tool | Version |
| --- | --- |
| Node.js | 20 or newer |
| npm | 10 or newer |
| Neon account | free tier is enough |

## 2. Install

```bash
cd quickcart-backend
npm install
```

## 3. Environment

```bash
cp .env.example .env
```

Then fill it in:

| Variable | What it is | Where to get it |
| --- | --- | --- |
| `DATABASE_URL` | Neon **pooled** connection string, used at runtime | Neon console → your project → Connection string (the one containing `-pooler`) |
| `DIRECT_URL` | Neon **direct** connection string, used by migrations | Same string with `-pooler` removed from the host |
| `JWT_ACCESS_SECRET` | Signs 15-minute access tokens | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_REFRESH_SECRET` | Signs refresh tokens | Generate a second, different value the same way |
| `PORT` | API port | Defaults to `4000` |
| `CLIENT_ORIGINS` | Comma-separated CORS allowlist | e.g. `http://localhost:3000,http://192.168.1.10:8081` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Sends OTP emails | Gmail app password, or a Resend / Brevo free tier |
| `MAIL_FROM` | From header on OTP emails | e.g. `QuickCart <no-reply@quickcart.pk>` |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Image uploads | Cloudinary dashboard (free tier) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | Seeded admin login for the panel | Choose your own |
| `EXPO_ACCESS_TOKEN` | Optional, raises Expo push rate limits | Expo dashboard → Access tokens |

**Leaving SMTP empty is fine in development** — the OTP is printed to the server console
and also returned in the API response as `devCode`, so the whole login flow still works.
In production the server refuses to start an OTP flow without SMTP configured.

**Leaving Cloudinary empty is fine too** — upload endpoints return `503 UPLOADS_DISABLED`
and the admin panel automatically offers a "paste image URL" field instead.

## 4. Create the tables in Neon

```bash
npx prisma migrate dev --name init
```

This reads `prisma/schema.prisma` and creates all 22 tables inside your Neon database.
After any schema edit, run it again with a new name, e.g.
`npx prisma migrate dev --name add_loyalty_points`.

For a deployed environment use the non-interactive form:

```bash
npx prisma migrate deploy
```

## 5. Seed sample data

```bash
npm run seed
```

Creates the admin account, a demo customer, 17 Lahore stores with 244 products,
5 riders (3 approved, 2 pending), 5 coupons, banners, categories, FAQs and a
pending store application so the admin panel has something to approve.

## 6. Run

```bash
npm run dev      # tsx watch, restarts on save
npm start        # after `npm run build`
```

You should see:

```
🚀 QuickCart API listening on http://localhost:4000  (development)
   email OTP: console (dev) · uploads: disabled
```

Check it: <http://localhost:4000/health>

## 7. Inspect the database

```bash
npx prisma studio
```

Opens a browser UI over your Neon tables where you can view and edit rows directly.

## 8. Verify everything works

```bash
npm run dev      # terminal 1
npm run smoke    # terminal 2
```

`npm run smoke` runs 56 end-to-end assertions against the live API: the full email-OTP
signup, address and payment validation (including Luhn), cart quoting, order placement,
the complete status machine, rider assignment and approval, admin catalog edits
reflecting in the customer API, and role enforcement.

---

## API shape

- Base URL: `/api/v1` (also served unversioned at `/api`)
- Every response uses the same envelope:

```json
{ "success": true, "data": { }, "message": "Order placed.", "error": null }
```

```json
{ "success": false, "data": null, "message": null,
  "error": { "code": "MIN_ORDER", "message": "Minimum order for Biryani Express is Rs 400." } }
```

- Auth: `Authorization: Bearer <accessToken>`. Access tokens last 15 minutes;
  clients silently exchange the refresh token at `POST /auth/refresh`.
- All list endpoints paginate (`?page=&perPage=`, max 100) and return
  `{ items, page, perPage, total, totalPages }`.
- Rate limits: 600 requests / 15 min per IP overall, 10 OTP requests / hour,
  40 auth attempts / 15 min, plus a 45-second per-email OTP cooldown.

Import `postman_collection.json` into Postman or Thunder Client for every endpoint
with example bodies.

---

## Realtime (Socket.io)

Connect to the server origin with `auth: { token: accessToken }`.

| Room | Who is in it |
| --- | --- |
| `user:{userId}` | every socket belonging to that customer |
| `order:{orderId}` | clients watching one order (join with `order:join`) |
| `admins` | every admin dashboard session |

| Event | Direction | Payload |
| --- | --- | --- |
| `order:status` | server → customer | `{ orderId, status, at, estimatedDeliveryAt }` |
| `rider:location` | server → customer + admins | `{ orderId, latitude, longitude, heading, at }` |
| `order:new` | server → admins | full order |
| `order:updated` | server → admins | full order |

## Deploying

1. Push to GitHub (`.env` is gitignored).
2. Create a Render or Railway web service from the repo.
3. Build command `npm install && npm run build`, start command `npm start`.
4. Add every variable from `.env.example` in the host's dashboard, using the same
   Neon `DATABASE_URL` and `DIRECT_URL`.
5. Run `npx prisma migrate deploy` once against the production database.
6. Put the deployed origin in `CLIENT_ORIGINS` for the admin panel domain, and in
   the mobile app's `EXPO_PUBLIC_API_URL`.
