import { Router } from 'express';
import { authenticate } from '../auth/jwt.js';
import { getAffiliateStats } from '../services/marketing.js';

export const affiliateRouter = Router();
affiliateRouter.use(authenticate);

// A trader's own affiliate dashboard: code, referrals, funded conversions, earnings.
affiliateRouter.get('/me', async (req, res) => {
  res.json(await getAffiliateStats(req.user!.sub));
});
