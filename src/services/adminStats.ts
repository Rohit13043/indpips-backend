// Firm-level analytics for the admin/owner console: funnel, unit economics and
// the risk book (exposure, outstanding liability, accounts near breach, top
// liability / A-book candidates, country concentration).
//
// `summarize` is pure (plain inputs → plain output) so it is unit-tested.
// `getAdminStats` is the Prisma-backed wrapper used by the admin routes.

import { prisma } from '../db.js';
import type { Basis } from '../rules/types.js';

export interface AccLite {
  id: string;
  trader: string;
  country?: string | null;
  plan: string;
  status: string;
  startingBalance: number;
  balance: number;
  equity: number;
  peakValue: number;
  priceCents: number;       // challenge fee paid
  splitPct: number;         // profit split
  maxDdPct: number;
  maxDdTrailing: boolean;
  ddBasis: Basis;
}
export interface PayLite { accountId: string; amountCents: number; status: string }

/** Drawdown used as a fraction of the account's max-DD limit (0..1+). */
export function ddRatio(a: AccLite): number {
  const base = a.maxDdTrailing ? a.peakValue : a.startingBalance;
  if (base <= 0) return 0;
  const measured = a.ddBasis === 'equity' ? a.equity : a.balance;
  const usedPct = Math.max(0, (base - measured) / base * 100);
  return a.maxDdPct > 0 ? usedPct / a.maxDdPct : 0;
}

/** Outstanding profit-share owed on a funded account (what you'd pay if withdrawn now). */
export function liability(a: AccLite): number {
  if (a.status !== 'funded') return 0;
  return Math.max(0, a.equity - a.startingBalance) * (a.splitPct / 100);
}

export function summarize(accounts: AccLite[], payouts: PayLite[], usersCount: number) {
  const funded = accounts.filter((a) => a.status === 'funded');
  const inEval = accounts.filter((a) => a.status.startsWith('phase')).length;
  const breached = accounts.filter((a) => a.status === 'breached').length;

  const revenue = accounts.reduce((s, a) => s + a.priceCents / 100, 0);
  const paid = payouts.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amountCents / 100, 0);
  const outstanding = funded.reduce((s, a) => s + liability(a), 0);
  const exposure = funded.reduce((s, a) => s + a.startingBalance, 0);
  const paidAccts = new Set(payouts.filter((p) => p.status === 'paid').map((p) => p.accountId)).size;

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const passRate = accounts.length ? funded.length / accounts.length * 100 : 0;

  // risk book
  const atRisk = accounts
    .filter((a) => a.status !== 'breached' && ddRatio(a) >= 0.65)
    .map((a) => ({ id: a.id, trader: a.trader, plan: a.plan, status: a.status, ddRatioPct: r2(ddRatio(a) * 100) }))
    .sort((x, y) => y.ddRatioPct - x.ddRatioPct);

  const topLiability = funded
    .map((a) => ({ id: a.id, trader: a.trader, plan: a.plan, owed: r2(liability(a)) }))
    .filter((x) => x.owed > 0)
    .sort((x, y) => y.owed - x.owed)
    .slice(0, 10);

  const byCountry: Record<string, number> = {};
  funded.forEach((a) => { const c = a.country || 'Unknown'; byCountry[c] = (byCountry[c] || 0) + liability(a); });

  return {
    overview: {
      users: usersCount,
      accounts: accounts.length,
      funded: funded.length,
      inEval,
      breached,
      passRatePct: r2(passRate),
    },
    funnel: { sold: accounts.length, inEval, funded: funded.length, paid: paidAccts },
    economics: {
      revenue: r2(revenue),
      paidOut: r2(paid),
      outstandingLiability: r2(outstanding),
      payoutToRevenuePct: r2(revenue ? paid / revenue * 100 : 0),
      netMarginPct: r2(revenue ? (revenue - paid) / revenue * 100 : 0),
      arpu: r2(usersCount ? revenue / usersCount : 0),
    },
    risk: {
      fundedCapitalExposure: r2(exposure),
      outstandingLiability: r2(outstanding),
      atRisk,
      topLiability,
      concentrationByCountry: Object.entries(byCountry)
        .map(([country, owed]) => ({ country, owed: r2(owed) }))
        .sort((a, b) => b.owed - a.owed),
    },
  };
}

export async function getAdminStats() {
  const [accounts, payouts, usersCount] = await Promise.all([
    prisma.account.findMany({ include: { plan: true, user: { select: { fullName: true, email: true, country: true } } } }),
    prisma.payout.findMany({ select: { accountId: true, amountCents: true, status: true } }),
    prisma.user.count(),
  ]);
  const lite: AccLite[] = accounts.map((a) => ({
    id: a.id,
    trader: a.user.fullName || a.user.email,
    country: a.user.country,
    plan: a.plan.name,
    status: a.status,
    startingBalance: a.startingBalance,
    balance: a.balance,
    equity: a.equity,
    peakValue: a.peakValue,
    priceCents: a.plan.priceCents,
    splitPct: a.plan.profitSplitPct,
    maxDdPct: a.plan.maxDdPct,
    maxDdTrailing: a.plan.maxDdTrailing,
    ddBasis: a.plan.ddBasis as Basis,
  }));
  return summarize(lite, payouts, usersCount);
}
