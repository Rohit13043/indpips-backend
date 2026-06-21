// Ingestion endpoint for the self-hosted EA bridge path. An MT5 Expert Advisor
// POSTs account figures and closed deals here; the data lands in the EA bridge
// buffer for the next sync. Protected by a shared secret header, not JWT, since
// the caller is a trading terminal, not a logged-in user.

import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { pushEaData } from '../mt5/eaBridge.js';

export const ingestRouter = Router();

const dealSchema = z.object({
  externalId: z.string(),
  symbol: z.string(),
  side: z.enum(['buy', 'sell']),
  volume: z.number(),
  openPrice: z.number(),
  closePrice: z.number(),
  profit: z.number(),
  commission: z.number().default(0),
  swap: z.number().default(0),
  openedAt: z.coerce.date(),
  closedAt: z.coerce.date(),
});

const positionSchema = z.object({
  externalId: z.string(),
  symbol: z.string(),
  side: z.enum(['buy', 'sell']),
  volume: z.number(),
  openPrice: z.number(),
  currentPrice: z.number(),
  floatingPnl: z.number(),
  openedAt: z.coerce.date(),
});

const payloadSchema = z.object({
  login: z.string(),
  server: z.string().default('EA'),
  balance: z.number(),
  equity: z.number(),
  currency: z.string().default('USD'),
  deals: z.array(dealSchema).default([]),
  positions: z.array(positionSchema).default([]),
});

ingestRouter.post('/', (req, res) => {
  const secret = req.headers['x-ea-secret'];
  if (secret !== config.eaBridgeSecret) {
    return res.status(401).json({ error: 'Bad EA secret' });
  }

  const parsed = payloadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { login, server, balance, equity, currency, deals, positions } = parsed.data;
  pushEaData(login, { balance, equity, currency, server, deals, positions });

  res.json({ ok: true, buffered: deals.length, openPositions: positions.length });
});
