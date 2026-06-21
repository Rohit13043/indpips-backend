import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate, requireAdmin } from '../auth/jwt.js';

export const plansRouter = Router();

// Public: list active challenge plans (the storefront).
plansRouter.get('/', async (_req, res) => {
  const plans = await prisma.challengePlan.findMany({ where: { active: true } });
  res.json(plans);
});

const planSchema = z.object({
  name: z.string().min(1),
  accountSize: z.number().positive(),
  priceCents: z.number().int().nonnegative().default(0),
  phases: z.number().int().min(0).max(3).default(2),
  profitTargetPct: z.number().positive().default(8),
  maxDailyLossPct: z.number().positive().default(5),
  maxOverallLossPct: z.number().positive().default(10),
  trailingDrawdown: z.boolean().default(false),
  minTradingDays: z.number().int().nonnegative().default(3),
  consistencyPct: z.number().nonnegative().default(0),
  profitSplitPct: z.number().min(0).max(100).default(80),
});

// Admin: create a plan.
plansRouter.post('/', authenticate, requireAdmin, async (req, res) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const plan = await prisma.challengePlan.create({ data: parsed.data });
  res.status(201).json(plan);
});
