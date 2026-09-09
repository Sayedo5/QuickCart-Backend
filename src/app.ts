import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { applyStore } from './controllers/adminController';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiLimiter, authLimiter } from './middleware/rateLimit';
import { validate } from './middleware/validate';
import { accountRoutes } from './routes/accountRoutes';
import { adminRoutes } from './routes/adminRoutes';
import { authRoutes } from './routes/authRoutes';
import { catalogRoutes } from './routes/catalogRoutes';
import { orderRoutes } from './routes/orderRoutes';
import { riderRoutes } from './routes/riderRoutes';
import { uploadRoutes } from './routes/uploadRoutes';
import { wrap } from './utils/asyncHandler';
import { ok } from './utils/response';
import { storeApplicationSchema } from './validators/schemas';

/**
 * Builds the versioned API router. A factory (not a shared instance) because an
 * Express 5 router mounted at two paths only matches routes on the first mount.
 */
const createApiRouter = () => {
  const api = express.Router();
  api.use(apiLimiter);
  api.use('/auth', authRoutes);
  // Public catalog: /stores, /search, /banners, /coupons, /categories, /settings/public, /content/faqs
  api.use('/', catalogRoutes);
  api.post('/stores/apply', authLimiter, validate(storeApplicationSchema), wrap(applyStore));
  api.use('/orders', orderRoutes);
  api.use('/riders', riderRoutes);
  api.use('/admin', adminRoutes);
  api.use('/uploads', uploadRoutes);
  // Authenticated account data mounted last: /users/me, /addresses, /payment-methods,
  // /favourites, /wallet, /notifications. Its routes carry requireAuth individually.
  api.use('/', accountRoutes);
  return api;
};

export const createApp = () => {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: env.clientOrigins.includes('*') ? true : env.clientOrigins,
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(env.isProd ? 'combined' : 'dev'));

  app.get('/', (_req, res) => ok(res, { name: env.APP_NAME, version: '1.0.0', api: '/api/v1' }));
  app.get('/health', (_req, res) => ok(res, { status: 'ok', uptime: process.uptime(), env: env.NODE_ENV }));

  app.use('/api/v1', createApiRouter());
  app.use('/api', createApiRouter()); // unversioned alias

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
