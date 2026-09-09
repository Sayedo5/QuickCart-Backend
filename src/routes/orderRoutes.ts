import { Router } from 'express';
import { z } from 'zod';
import * as orders from '../controllers/orderController';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { wrap } from '../utils/asyncHandler';
import { orderStatusSchema, paginationQuery, placeOrderSchema, quoteSchema, reviewSchema } from '../validators/schemas';

/** Every order route needs a signed-in user; this router is mounted at "/orders". */
export const orderRoutes = Router();
orderRoutes.use(requireAuth);

// Admin / rider — declared before "/:id" so those words are not read as ids.
orderRoutes.get(
  '/all',
  requireRole('ADMIN'),
  validate(paginationQuery.extend({ status: z.string().optional(), storeId: z.string().optional(), riderId: z.string().optional(), from: z.string().optional(), to: z.string().optional() }), 'query'),
  wrap(orders.listAllOrders),
);

// Customer
orderRoutes.post('/quote', validate(quoteSchema), wrap(orders.quote));
orderRoutes.post('/', validate(placeOrderSchema), wrap(orders.placeOrder));
orderRoutes.get('/my', wrap(orders.myOrders));
orderRoutes.get('/', wrap(orders.myOrders));
orderRoutes.post('/:id/cancel', wrap(orders.cancelOrder));
orderRoutes.post('/:id/review', validate(reviewSchema), wrap(orders.reviewOrder));

orderRoutes.put('/:id/status', requireRole('ADMIN', 'RIDER'), validate(orderStatusSchema), wrap(orders.updateStatus));
orderRoutes.put('/:id/assign-rider', requireRole('ADMIN'), validate(z.object({ riderId: z.string().min(1) })), wrap(orders.assignRider));

orderRoutes.get('/:id', wrap(orders.getOrder));
