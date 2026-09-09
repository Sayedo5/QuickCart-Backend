import { Router } from 'express';
import * as account from '../controllers/accountController';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { wrap } from '../utils/asyncHandler';
import { addressSchema, paymentMethodSchema, pushTokenSchema, topUpSchema, updateProfileSchema } from '../validators/schemas';

/**
 * Authenticated account endpoints. `requireAuth` is attached per route rather
 * than with `router.use`, because this router is mounted at "/" — a router-level
 * guard would also run for paths handled by later routers (and turn a 404 into a 401).
 */
export const accountRoutes = Router();

// Profile
accountRoutes.patch('/users/me', requireAuth, validate(updateProfileSchema), wrap(account.updateProfile));
accountRoutes.post('/users/me/push-token', requireAuth, validate(pushTokenSchema), wrap(account.registerPushToken));

// Addresses
accountRoutes.get('/addresses', requireAuth, wrap(account.listAddresses));
accountRoutes.post('/addresses', requireAuth, validate(addressSchema), wrap(account.createAddress));
accountRoutes.patch('/addresses/:id', requireAuth, validate(addressSchema.partial()), wrap(account.updateAddress));
accountRoutes.delete('/addresses/:id', requireAuth, wrap(account.deleteAddress));

// Payment methods
accountRoutes.get('/payment-methods', requireAuth, wrap(account.listPaymentMethods));
accountRoutes.post('/payment-methods', requireAuth, validate(paymentMethodSchema), wrap(account.createPaymentMethod));
accountRoutes.delete('/payment-methods/:id', requireAuth, wrap(account.deletePaymentMethod));

// Favourites
accountRoutes.get('/favourites', requireAuth, wrap(account.listFavourites));
accountRoutes.get('/favourites/stores', requireAuth, wrap(account.listFavouriteStores));
accountRoutes.post('/favourites/:storeId', requireAuth, wrap(account.addFavourite));
accountRoutes.delete('/favourites/:storeId', requireAuth, wrap(account.removeFavourite));

// Wallet
accountRoutes.get('/wallet', requireAuth, wrap(account.getWallet));
accountRoutes.post('/wallet/top-up', requireAuth, validate(topUpSchema), wrap(account.topUpWallet));

// Notifications
accountRoutes.get('/notifications', requireAuth, wrap(account.listNotifications));
accountRoutes.post('/notifications/read-all', requireAuth, wrap(account.markNotificationsRead));
