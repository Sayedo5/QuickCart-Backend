import { Router } from 'express';
import { z } from 'zod';
import * as catalog from '../controllers/catalogController';
import { validate } from '../middleware/validate';
import { wrap } from '../utils/asyncHandler';
import { paginationQuery, validateCouponSchema } from '../validators/schemas';

export const catalogRoutes = Router();

catalogRoutes.get('/stores', validate(paginationQuery.extend({ category: z.string().optional() }), 'query'), wrap(catalog.listStores));
catalogRoutes.get('/stores/:id', wrap(catalog.getStore));
catalogRoutes.get('/stores/:id/menu', wrap(catalog.getMenu));
catalogRoutes.get('/stores/:id/reviews', wrap(catalog.listStoreReviews));
catalogRoutes.get('/search', wrap(catalog.search));
catalogRoutes.get('/categories', wrap(catalog.listCategories));
catalogRoutes.get('/banners', wrap(catalog.listBanners));
catalogRoutes.get('/coupons', wrap(catalog.listCoupons));
catalogRoutes.post('/coupons/validate', validate(validateCouponSchema), wrap(catalog.validateCoupon));
catalogRoutes.get('/settings/public', wrap(catalog.publicSettings));
catalogRoutes.get('/content/faqs', wrap(catalog.listFaqs));
