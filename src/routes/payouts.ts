import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate, requireAdmin } from '../auth/jwt.js';
import { getEligibility } from '../services/payoutEligibility.js';

export const payoutsRouter = Router();
payoutsRouter.use(authenticate);

// Check payout eligibility for an account (profitable-days rule).
payoutsRouter.get('/eligibility/:accountId', async (req, res) => {
  const account = await prisma.account.findUnique({ where: { id: req.params.accountId } });
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (req.user!.role !== 'admin' && account.userId !== req.user!.sub) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(await getEligibility(account.id));
});

// List payouts (own, or all for admin).
payoutsRouter.get('/', async (req, res) => {
  const where = req.user!.role === 'admin' ? {} : { userId: req.user!.sub };
  const payouts = await prisma.payout.findMany({
    where,
    orderBy: { requestedAt: 'desc' },
  });
  res.json(payouts);
});

// A funded trader requests a profit-share withdrawal.
const requestSchema = z.object({
  accountId: z.string(),
  amountCents: z.number().int().positive(),
  note: z.string().optional(),
});

payoutsRouter.post('/', async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { accountId, amountCents, note } = parsed.data;

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    include: { plan: true },
  });
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.userId !== req.user!.sub) return res.status(403).json({ error: 'Forbidden' });
  if (account.status !== 'funded') {
    return res.status(400).json({ error: 'Only funded accounts can request payouts' });
  }

  // Enforce the profitable-days eligibility rule.
  const elig = await getEligibility(account.id);
  if (!elig.eligible) {
    return res.status(400).json({
      error: `Not yet eligible: ${elig.profitableDays}/${elig.requiredDays} profitable days (>=${elig.minDailyProfitPct}% each) required`,
      eligibility: elig,
    });
  }

  if (amountCents > elig.maxWithdrawableCents) {
    return res.status(400).json({
      error: `Requested amount exceeds your ${account.plan.profitSplitPct}% share`,
      maxShareCents: elig.maxWithdrawableCents,
    });
  }

  const payout = await prisma.payout.create({
    data: {
      accountId,
      userId: req.user!.sub,
      amountCents,
      profitSplitPct: account.plan.profitSplitPct,
      note,
    },
  });
  res.status(201).json(payout);
});

// Admin: approve / pay / reject a payout.
const decisionSchema = z.object({
  status: z.enum(['approved', 'paid', 'rejected']),
  note: z.string().optional(),
});

payoutsRouter.patch('/:id', requireAdmin, async (req, res) => {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const payout = await prisma.payout.update({
    where: { id: req.params.id },
    data: {
      status: parsed.data.status,
      note: parsed.data.note,
      processedAt: new Date(),
    },
  });
  res.json(payout);
});
