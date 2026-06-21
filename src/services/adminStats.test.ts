import { describe, it, expect } from 'vitest';
import { summarize, ddRatio, liability, type AccLite, type PayLite } from './adminStats.js';

function acc(o: Partial<AccLite> = {}): AccLite {
  return {
    id: 'a', trader: 'T', country: 'India', plan: '1-Step 10K', status: 'funded',
    startingBalance: 10000, balance: 10800, equity: 10800, peakValue: 10800,
    priceCents: 9900, splitPct: 80, maxDdPct: 6, maxDdTrailing: true, ddBasis: 'balance',
    ...o,
  };
}

describe('liability', () => {
  it('is profit share for funded accounts', () => {
    expect(liability(acc({ equity: 11000 }))).toBe(800); // 1000 * 80%
  });
  it('is zero for non-funded', () => {
    expect(liability(acc({ status: 'phase_1', equity: 11000 }))).toBe(0);
  });
  it('is zero when in loss', () => {
    expect(liability(acc({ equity: 9000 }))).toBe(0);
  });
});

describe('ddRatio', () => {
  it('is fraction of the max-DD limit used (trailing balance)', () => {
    // peak 10000, balance 9700 -> 3% used of 6% limit = 0.5
    const r = ddRatio(acc({ peakValue: 10000, balance: 9700, equity: 9700, status: 'phase_1' }));
    expect(r).toBeCloseTo(0.5, 2);
  });
});

describe('summarize', () => {
  const accounts: AccLite[] = [
    acc({ id: 'a1', status: 'funded', equity: 10800, balance: 10800, peakValue: 10800 }),
    acc({ id: 'a2', status: 'phase_1', equity: 9650, balance: 9650, peakValue: 10000 }), // 3.5% of 6% = 0.58 (not at-risk)
    acc({ id: 'a3', status: 'phase_2', equity: 9700, balance: 9700, peakValue: 10300 }), // ~5.8% of 6% = 0.97 at-risk
    acc({ id: 'a4', status: 'breached', equity: 9400, balance: 9400, peakValue: 10000 }),
  ];
  const payouts: PayLite[] = [
    { accountId: 'a1', amountCents: 40000, status: 'paid' },
    { accountId: 'a1', amountCents: 20000, status: 'requested' },
  ];
  const s = summarize(accounts, payouts, 3);

  it('counts the funnel correctly', () => {
    expect(s.overview.accounts).toBe(4);
    expect(s.overview.funded).toBe(1);
    expect(s.overview.inEval).toBe(2);
    expect(s.overview.breached).toBe(1);
    expect(s.funnel.paid).toBe(1);
  });
  it('computes unit economics', () => {
    expect(s.economics.revenue).toBe(396); // 4 * 99
    expect(s.economics.paidOut).toBe(400);
    // payout/revenue = 400/396 ~ 101%
    expect(s.economics.payoutToRevenuePct).toBeGreaterThan(100);
  });
  it('flags at-risk accounts (>=65% of DD limit)', () => {
    expect(s.risk.atRisk.some((x) => x.id === 'a3')).toBe(true);
    expect(s.risk.atRisk.some((x) => x.id === 'a2')).toBe(false);
  });
  it('lists outstanding liability for funded only', () => {
    expect(s.risk.outstandingLiability).toBe(640); // a1: 800*0.8 = 640
    expect(s.risk.topLiability[0].id).toBe('a1');
  });
});
