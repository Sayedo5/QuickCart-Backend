import { Router } from 'express';
import { z } from 'zod';
import * as admin from '../controllers/adminController';
import { requireAdmin } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { wrap } from '../utils/asyncHandler';
import {
  approvalSchema,
  bannerSchema,
  blockSchema,
  broadcastSchema,
  categorySchema,
  couponSchema,
  faqSchema,
  menuCategorySchema,
  paginationQuery,
  productSchema,
  settingsSchema,
  storeSchema,
} from '../validators/schemas';

export const adminRoutes = Router();
adminRoutes.use(...requireAdmin);

adminRoutes.get('/stats', wrap(admin.stats));

// Users
adminRoutes.get('/users', validate(paginationQuery.extend({ role: z.string().optional() }), 'query'), wrap(admin.listUsers));
adminRoutes.get('/users/:id', wrap(admin.getUser));
adminRoutes.put('/users/:id/block', validate(blockSchema), wrap(admin.setBlocked));
adminRoutes.post('/admins', validate(z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(8) })), wrap(admin.createAdmin));

// Stores
adminRoutes.get('/stores', validate(paginationQuery.extend({ status: z.string().optional(), category: z.string().optional() }), 'query'), wrap(admin.listStores));
adminRoutes.get('/stores/:id', wrap(admin.getStore));
adminRoutes.post('/stores', validate(storeSchema), wrap(admin.createStore));
adminRoutes.put('/stores/:id', validate(storeSchema.partial()), wrap(admin.updateStore));
adminRoutes.put('/stores/:id/approve', validate(approvalSchema), wrap(admin.setStoreApproval));
adminRoutes.delete('/stores/:id', wrap(admin.deleteStore));
adminRoutes.post('/stores/:id/menu-categories', validate(menuCategorySchema), wrap(admin.createMenuCategory));
adminRoutes.put('/menu-categories/:id', validate(menuCategorySchema.partial()), wrap(admin.updateMenuCategory));
adminRoutes.delete('/menu-categories/:id', wrap(admin.deleteMenuCategory));

// Products
adminRoutes.get('/products', validate(paginationQuery.extend({ storeId: z.string().optional(), inStock: z.string().optional() }), 'query'), wrap(admin.listProducts));
adminRoutes.post('/products', validate(productSchema), wrap(admin.createProduct));
adminRoutes.put('/products/:id', validate(productSchema.partial()), wrap(admin.updateProduct));
adminRoutes.delete('/products/:id', wrap(admin.deleteProduct));

// Categories
adminRoutes.get('/categories', wrap(admin.listCategoriesAdmin));
adminRoutes.post('/categories', validate(categorySchema), wrap(admin.createCategory));
adminRoutes.put('/categories/:id', validate(categorySchema.partial()), wrap(admin.updateCategory));
adminRoutes.delete('/categories/:id', wrap(admin.deleteCategory));

// Banners
adminRoutes.get('/banners', wrap(admin.listBannersAdmin));
adminRoutes.post('/banners', validate(bannerSchema), wrap(admin.createBanner));
adminRoutes.put('/banners/:id', validate(bannerSchema.partial()), wrap(admin.updateBanner));
adminRoutes.delete('/banners/:id', wrap(admin.deleteBanner));

// Coupons
adminRoutes.get('/coupons', wrap(admin.listCouponsAdmin));
adminRoutes.post('/coupons', validate(couponSchema), wrap(admin.createCoupon));
adminRoutes.put('/coupons/:id', validate(couponSchema.partial()), wrap(admin.updateCoupon));
adminRoutes.delete('/coupons/:id', wrap(admin.deleteCoupon));

// FAQs
adminRoutes.get('/faqs', wrap(admin.listFaqsAdmin));
adminRoutes.post('/faqs', validate(faqSchema), wrap(admin.createFaq));
adminRoutes.put('/faqs/:id', validate(faqSchema.partial()), wrap(admin.updateFaq));
adminRoutes.delete('/faqs/:id', wrap(admin.deleteFaq));

// Reviews
adminRoutes.get('/reviews', wrap(admin.listReviews));
adminRoutes.put('/reviews/:id/approve', validate(z.object({ approved: z.boolean() })), wrap(admin.setReviewApproval));

// Settings & broadcast
adminRoutes.get('/settings', wrap(admin.getSettingsAdmin));
adminRoutes.put('/settings', validate(settingsSchema), wrap(admin.updateSettings));
adminRoutes.post('/broadcast', validate(broadcastSchema), wrap(admin.sendBroadcast));
