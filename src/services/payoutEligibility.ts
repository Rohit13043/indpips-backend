// Payout eligibility: a funded trader may request a payout once they have
// accumulated at least `payoutMinProfitableDays` profitable days, where a day
// counts if its net profit is >= `payoutMinDailyProfitPct`% of the account
// size. Days are counted cumulatively (they need not be consecutive), using the
// plan's daily boundary (default 02:30 IST = 21:00 UTC).

import { prisma } from '../db.js';
import { lastBoundary } from './syncService.js';

export interface Eligibility {
  eligible: boolean;
  profitableDays: number;
  requiredDays: number;
  minDailyProfitPct: number;
  profit: number;          // total realised profit in account currency
  maxWithdrawableCents: number; // trader's share of profit
}

/** Group a date into its trading-day key based on the plan boundary. */
function dayKey(closedAt: Date, boundaryUtcMin: number): string {
  return lastBoundary(closedAt, boundaryUtcMin).toISOString().slice(0, 10);
}

export async function getEligibility(accountId: string): Promise<Eligibility> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    include: { plan: true },
  });
  if (!account) throw new Error('Account not found');
  const plan = account.plan;

  const trades = await prisma.trade.findMany({
    where: { accountId },
    select: { closedAt: true, profit: true, commission: true, swap: true },
  });

  // Net profit per trading day.
  const perDay = new Map<string, number>();
  for (const t of trades) {
    const key = dayKey(t.closedAt, plan.ddBoundaryUtcMin);
    perDay.set(key, (perDay.get(key) ?? 0) + t.profit + t.commission + t.swap);
  }

  const threshold = account.startingBalance * (plan.payoutMinDailyProfitPct / 100);
  let profitableDays = 0;
  for (const net of perDay.values()) {
    if (net >= threshold) profitableDays += 1;
  }

  const profit = account.equity - account.startingBalance;
  const share = Math.max(0, profit) * (plan.profitSplitPct / 100);

  return {
    eligible:
      account.status === 'funded' &&
      profitableDays >= plan.payoutMinProfitableDays &&
      profit > 0,
    profitableDays,
    requiredDays: plan.payoutMinProfitableDays,
    minDailyProfitPct: plan.payoutMinDailyProfitPct,
    profit,
    maxWithdrawableCents: Math.floor(share * 100),
  };
}
