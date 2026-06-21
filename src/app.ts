import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { plansRouter } from './routes/plans.js';
import { accountsRouter } from './routes/accounts.js';
import { ingestRouter } from './routes/ingest.js';
import { payoutsRouter } from './routes/payouts.js';
import { prohibitedRouter } from './routes/prohibited.js';
import { adminRouter } from './routes/admin.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

  app.use('/auth', authRouter);
  app.use('/plans', plansRouter);
  app.use('/accounts', accountsRouter);
  app.use('/ingest', ingestRouter);
  app.use('/payouts', payoutsRouter);
  app.use('/prohibited-activities', prohibitedRouter);
  app.use('/admin', adminRouter);

  // Centralised error handler.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[error]', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
