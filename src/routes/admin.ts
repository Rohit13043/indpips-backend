import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate, requireAdmin } from '../auth/jwt.js';
import { getAdminStats } from '../services/adminStats.js';
import { getMarketingStats } from '../services/marketing.js';

export const adminRouter = Router();
adminRouter.use(authenticate, requireAdmin);

// Firm-level stats: overview, funnel, unit economics and risk book.
adminRouter.get('/stats', async (_req, res) => {
  res.json(await getAdminStats());
});

// Marketing: per-channel signups/funded/revenue and affiliate leaderboard.
adminRouter.get('/marketing', async (_req, res) => {
  res.json(await getMarketingStats());
});

// List traders with KYC status and account counts.
adminRouter.get('/users', async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { role: 'trader' },
    select: {
      id: true, email: true, fullName: true, country: true, kycStatus: true, createdAt: true,
      _count: { select: { accounts: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(users.map((u) => ({ ...u, accountCount: u._count.accounts, _count: undefined })));
});

// Verify or reject a trader's KYC.
const kycSchema = z.object({ status: z.enum(['verified', 'rejected', 'pending']) });
adminRouter.patch('/users/:id/kyc', async (req, res) => {
  const parsed = kycSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { kycStatus: parsed.data.status },
    select: { id: true, email: true, kycStatus: true },
  });
  res.json(user);
});
