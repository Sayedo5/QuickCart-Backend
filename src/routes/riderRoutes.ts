import { Router } from 'express';
import { z } from 'zod';
import * as riders from '../controllers/riderController';
import { requireAuth, requireRole } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { wrap } from '../utils/asyncHandler';
import { approvalSchema, paginationQuery, riderApplySchema, riderLocationSchema, riderUpdateSchema } from '../validators/schemas';

export const riderRoutes = Router();

riderRoutes.post('/apply', authLimiter, validate(riderApplySchema), wrap(riders.apply));

riderRoutes.get('/', requireAuth, requireRole('ADMIN'), validate(paginationQuery.extend({ status: z.string().optional() }), 'query'), wrap(riders.list));
riderRoutes.get('/pending', requireAuth, requireRole('ADMIN'), wrap(riders.pending));
riderRoutes.get('/:id', requireAuth, requireRole('ADMIN'), wrap(riders.getOne));
riderRoutes.put('/:id/approve', requireAuth, requireRole('ADMIN'), validate(approvalSchema), wrap(riders.setApproval));
riderRoutes.patch('/:id', requireAuth, requireRole('ADMIN'), validate(riderUpdateSchema), wrap(riders.update));
riderRoutes.delete('/:id', requireAuth, requireRole('ADMIN'), wrap(riders.remove));
riderRoutes.put('/:id/location', requireAuth, requireRole('ADMIN', 'RIDER'), validate(riderLocationSchema), wrap(riders.updateLocation));
