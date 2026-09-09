import { Router } from 'express';
import * as auth from '../controllers/authController';
import { requireAuth } from '../middleware/auth';
import { authLimiter, otpLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { wrap } from '../utils/asyncHandler';
import { adminLoginSchema, refreshSchema, sendOtpSchema, signupSchema, verifyOtpSchema } from '../validators/schemas';

export const authRoutes = Router();

authRoutes.post('/send-otp', otpLimiter, validate(sendOtpSchema), wrap(auth.sendOtp));
authRoutes.post('/verify-otp', authLimiter, validate(verifyOtpSchema), wrap(auth.verifyOtp));
authRoutes.post('/signup', authLimiter, validate(signupSchema), wrap(auth.signup));
authRoutes.post('/admin/login', authLimiter, validate(adminLoginSchema), wrap(auth.adminLogin));
authRoutes.post('/refresh', validate(refreshSchema), wrap(auth.refresh));
authRoutes.post('/logout', wrap(auth.logout));
authRoutes.get('/me', requireAuth, wrap(auth.me));
