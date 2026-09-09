# Deploying QuickCart API to Vercel

The API runs as a **single serverless function**. `vercel.json` rewrites every
path to `api/index.ts`, which exports the Express app built by `src/app.ts`.
The original URL is preserved, so `/api/v1/...`, `/health` and `/` all behave
exactly as they do locally.

---

## 1. Environment variables

Vercel does **not** read your `.env` file — it is gitignored and never uploaded.
Add each variable under **Project → Settings → Environment Variables**
(select *Production*, *Preview* and *Development*).

### Required

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** URL (the one containing `-pooler`) |
| `DIRECT_URL` | Neon **direct** URL (no `-pooler`) — used by migrations |
| `JWT_ACCESS_SECRET` | fresh random string, min 16 chars |
| `JWT_REFRESH_SECRET` | fresh random string, min 16 chars, different from the access secret |
| `CLIENT_ORIGINS` | comma-separated real origins, e.g. `https://quickcart-admin.vercel.app,https://quickcart.pk` |

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Optional (safe to omit — the feature simply switches off)

`APP_NAME`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL_DAYS`,
`SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM`,
`CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`,
`ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME`, `EXPO_ACCESS_TOKEN`.

Leaving SMTP blank logs OTP codes to the function logs instead of emailing them —
fine for a demo, not for production. Leaving Cloudinary blank disables uploads.

### Do NOT set these on Vercel

- **`NODE_ENV`** — Vercel sets it to `production` itself. Forcing `development`
  skips production behaviour and can break the build.
- **`PORT`** — serverless functions are not given a port to listen on.

---

## 2. Database migrations

The build only runs `prisma generate`. Migrations are deliberately **not** run
automatically, so a bad migration can never take the deployment down. Apply them
yourself against the direct URL before or after deploying:

```bash
npx prisma migrate deploy      # uses DIRECT_URL from prisma/schema.prisma
```

To seed the demo catalogue once:

```bash
npm run seed
```

---

## 3. Deploy

```bash
npm i -g vercel
vercel link
vercel --prod
```

Then check:

```bash
curl https://<your-deployment>.vercel.app/health
curl https://<your-deployment>.vercel.app/api/v1/stores
```

---

## 4. Known limitation: real-time / Socket.io

**Socket.io does not work on Vercel.** Serverless functions are torn down between
requests and cannot hold a persistent WebSocket, so `api/index.ts` never calls
`initSockets`. Every emitter in `src/sockets/orderSocket.ts` is written as `io?.…`,
so this degrades safely: the REST API is fully functional, but clients receive no
`order:status`, `rider:location` or `order:new` pushes.

Pick one:

1. **Poll instead.** Have the apps re-fetch `GET /api/v1/orders/:id` every ~10s
   while an order screen is open. No backend change needed.
2. **Host the socket server elsewhere.** Deploy this same repo to Render, Railway
   or Fly.io (they run `npm run build && npm start`, which *does* call
   `initSockets`) and point the apps' socket client at that host while REST stays
   on Vercel.
3. **Use a managed realtime service** (Pusher, Ably) and emit from the Vercel
   function instead of Socket.io.

Option 2 is the least work if you want tracking back exactly as designed.

---

## 5. Other serverless caveats

- **Rate limiting is per-instance.** `express-rate-limit` uses an in-memory store,
  so limits are enforced per warm function instance rather than globally. For real
  enforcement, back it with Redis (`rate-limit-redis` + Upstash).
- **Cold starts.** The first request after idle pays Prisma connect time (~1–3s).
- **Uploads** already use `multer.memoryStorage()` and stream straight to
  Cloudinary, so nothing is written to the read-only filesystem. No change needed.
- **Connection pooling** is handled in `src/config/db.ts`: when `VERCEL` is set it
  appends `pgbouncer=true&connection_limit=1` to `DATABASE_URL`, which is what
  Neon's transaction-mode pooler requires. Long-running hosts keep the URL as-is.
