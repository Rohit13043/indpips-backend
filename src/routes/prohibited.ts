import { Router } from 'express';
import { PROHIBITED_ACTIVITIES } from '../rules/prohibitedActivities.js';

export const prohibitedRouter = Router();

// Public: the prohibited/restricted trading activities catalog (FundedNext-style).
prohibitedRouter.get('/', (_req, res) => {
  res.json(PROHIBITED_ACTIVITIES);
});
