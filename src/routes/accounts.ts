import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { authenticate, requireAdmin } from '../auth/jwt.js';
import { syncAccount } from '../services/syncService.js';

export const accountsRouter = Router();
accountsRouter.use(authenticate);

// List the caller's accounts (admins see all).
accountsRouter.get('/', async (req, res) => {
  const where = req.user!.role === 'admin' ? {} : { userId: req.user!.sub };
  const accounts = await prisma.account.findMany({
    where,
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(accounts);
});

// Buy/start a challenge: creates an Account instance from a plan.
const startSchema = z.object({
  planId: z.string(),
  mt5Login: z.string().optional(),
  mt5Server: z.string().optional(),
  mt5Source: z.enum(['mock', 'metaapi', 'eabridge']).default('mock'),
  mt5AccountId: z.string().optional(),
});

accountsRouter.post('/', async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { planId, mt5Login, mt5Server, mt5Source, mt5AccountId } = parsed.data;

  const plan = await prisma.challengePlan.findUnique({ where: { id: planId } });
  if (!plan || !plan.active) return res.status(404).json({ error: 'Plan not found' });

  // A mock account gets a synthetic login if none provided.
  const login = mt5Login ?? `MOCK-${Math.floor(Math.random() * 1_000_000)}`;
  const initialStatus = plan.phases === 0 ? 'funded' : 'pending';

  const account = await prisma.account.create({
    data: {
      userId: req.user!.sub,
      planId,
      mt5Login: login,
      mt5Server,
      mt5Source,
      mt5AccountId,
      status: initialStatus,
      phase: 1,
      startingBalance: plan.accountSize,
      balance: plan.accountSize,
      equity: plan.accountSize,
      peakValue: plan.accountSize,
      dayOpenValue: plan.accountSize,
      ...(initialStatus === 'funded' ? { fundedAt: new Date() } : {}),
    },
    include: { plan: true },
  });
  res.status(201).json(account);
});

// Account detail with recent snapshots, trades and violations.
accountsRouter.get('/:id', async (req, res) => {
  const account = await prisma.account.findUnique({
    where: { id: req.params.id },
    include: {
      plan: true,
      snapshots: { orderBy: { createdAt: 'desc' }, take: 50 },
      trades: { orderBy: { closedAt: 'desc' }, take: 50 },
      violations: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });
  if (!account) return res.status(404).json({ error: 'Not found' });
  if (req.user!.role !== 'admin' && account.userId !== req.user!.sub) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(account);
});

// Admin: manually override an account's status (pass / breach / reset phase).
const statusSchema = z.object({ status: z.enum(['pending', 'phase_1', 'phase_2', 'funded', 'breached']), reason: z.string().optional() });
accountsRouter.post('/:id/status', requireAdmin, async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { status, reason } = parsed.data;
  const account = await prisma.account.update({
    where: { id: req.params.id },
    data: {
      status,
      ...(status === 'funded' ? { fundedAt: new Date() } : {}),
      ...(status === 'breached' ? { breachedAt: new Date(), breachReason: reason ?? 'Manually breached by admin' } : {}),
    },
  });
  res.json(account);
});

// Admin: link / update an account's MT5 connection.
const mt5Schema = z.object({
  mt5Login: z.string().optional(),
  mt5Server: z.string().optional(),
  mt5Source: z.enum(['mock', 'metaapi', 'eabridge']).optional(),
  mt5AccountId: z.string().optional(),
});
accountsRouter.patch('/:id/mt5', requireAdmin, async (req, res) => {
  const parsed = mt5Schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const account = await prisma.account.update({ where: { id: req.params.id }, data: parsed.data });
  res.json(account);
});

// Force an immediate sync of one account (useful for demos/tests).
accountsRouter.post('/:id/sync', async (req, res) => {
  const account = await prisma.account.findUnique({ where: { id: req.params.id } });
  if (!account) return res.status(404).json({ error: 'Not found' });
  if (req.user!.role !== 'admin' && account.userId !== req.user!.sub) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const result = await syncAccount(account.id);
  res.json(result);
});
