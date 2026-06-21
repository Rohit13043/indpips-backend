import { describe, it, expect } from 'vitest';
import { summarizeMarketing, type MUser, type MAcct, type MComm } from './marketing.js';

const users: MUser[] = [
  { id: 'u1', name: 'Affiliate A', signupChannel: 'organic' },
  { id: 'u2', name: 'Ref One', signupChannel: 'affiliate', referredById: 'u1' },
  { id: 'u3', name: 'Ref Two', signupChannel: 'affiliate', referredById: 'u1' },
  { id: 'u4', name: 'YT Lead', signupChannel: 'youtube' },
];
const accounts: MAcct[] = [
  { userId: 'u2', status: 'funded', priceCents: 9900 },
  { userId: 'u3', status: 'phase_1', priceCents: 9900 },
  { userId: 'u4', status: 'breached', priceCents: 4900 },
];
const commissions: MComm[] = [
  { affiliateUserId: 'u1', amountCents: 990, status: 'earned' }, // 10% of u2's 9900
  { affiliateUserId: 'u1', amountCents: 990, status: 'earned' }, // 10% of u3's 9900
];

const s = summarizeMarketing(users, accounts, commissions);

describe('summarizeMarketing — channels', () => {
  it('counts signups per channel', () => {
    const aff = s.channels.find((c) => c.channel === 'affiliate');
    expect(aff?.signups).toBe(2);
    expect(s.channels.find((c) => c.channel === 'youtube')?.signups).toBe(1);
  });
  it('counts funded conversions and revenue per channel', () => {
    const aff = s.channels.find((c) => c.channel === 'affiliate')!;
    expect(aff.funded).toBe(1);          // only u2 is funded
    expect(aff.revenue).toBe(198);       // 9900 + 9900 = 19800c = $198
    expect(aff.conversionPct).toBe(50);  // 1 of 2
  });
});

describe('summarizeMarketing — affiliates', () => {
  it('aggregates referrals, funded and earnings per affiliate', () => {
    const a = s.affiliates.find((x) => x.name === 'Affiliate A')!;
    expect(a.referrals).toBe(2);
    expect(a.funded).toBe(1);
    expect(a.earnings).toBe(19.8); // 1980 cents
  });
  it('reports totals', () => {
    expect(s.totals.signups).toBe(4);
    expect(s.totals.referredSignups).toBe(2);
    expect(s.totals.affiliateEarnings).toBe(19.8);
  });
});
