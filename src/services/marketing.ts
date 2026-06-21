// Marketing & affiliate analytics. `summarizeMarketing` is pure (plain inputs →
// plain output) so it is unit-tested; the rest are Prisma-backed wrappers.
//
// Note: ad spend / CAC / ROAS come from external ad platforms (Meta, Google),
// not from the app itself. This service reports what the app can know:
// signups, funded conversions and revenue per channel, plus affiliate earnings.

import { prisma } from '../db.js';

export interface MUser { id: string; name: string; signupChannel: string; referredById?: string | null }
export interface MAcct { userId: string; status: string; priceCents: number }
export interface MComm { affiliateUserId: string; amountCents: number; status: string }

export function summarizeMarketing(users: MUser[], accounts: MAcct[], commissions: MComm[]) {
  const acctByUser: Record<string, MAcct[]> = {};
  accounts.forEach((a) => { (acctByUser[a.userId] = acctByUser[a.userId] || []).push(a); });

  // per channel
  const ch: Record<string, { channel: string; signups: number; funded: number; revenueCents: number }> = {};
  users.forEach((u) => {
    const c = u.signupChannel || 'organic';
    const e = (ch[c] = ch[c] || { channel: c, signups: 0, funded: 0, revenueCents: 0 });
    e.signups += 1;
    const accs = acctByUser[u.id] || [];
    if (accs.some((a) => a.status === 'funded')) e.funded += 1;
    e.revenueCents += accs.reduce((s, a) => s + (a.priceCents || 0), 0);
  });
  const channels = Object.values(ch)
    .map((e) => ({
      channel: e.channel,
      signups: e.signups,
      funded: e.funded,
      revenue: Math.round(e.revenueCents) / 100,
      conversionPct: e.signups ? Math.round((e.funded / e.signups) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // affiliates
  const userById: Record<string, MUser> = {};
  users.forEach((u) => { userById[u.id] = u; });
  const earnBy: Record<string, number> = {};
  commissions.forEach((c) => { earnBy[c.affiliateUserId] = (earnBy[c.affiliateUserId] || 0) + c.amountCents; });
  const refCount: Record<string, number> = {};
  const refFunded: Record<string, number> = {};
  users.forEach((u) => {
    if (u.referredById) {
      refCount[u.referredById] = (refCount[u.referredById] || 0) + 1;
      const accs = acctByUser[u.id] || [];
      if (accs.some((a) => a.status === 'funded')) refFunded[u.referredById] = (refFunded[u.referredById] || 0) + 1;
    }
  });
  const affIds = new Set<string>([...Object.keys(earnBy), ...Object.keys(refCount)]);
  const affiliates = [...affIds]
    .map((id) => ({
      name: (userById[id] && userById[id].name) || id,
      referrals: refCount[id] || 0,
      funded: refFunded[id] || 0,
      earnings: Math.round(earnBy[id] || 0) / 100,
    }))
    .sort((a, b) => b.earnings - a.earnings);

  const referredSignups = users.filter((u) => u.referredById).length;
  const totalEarnings = Math.round(commissions.reduce((s, c) => s + c.amountCents, 0)) / 100;

  return {
    totals: { signups: users.length, referredSignups, affiliateEarnings: totalEarnings },
    channels,
    affiliates,
  };
}

export async function getMarketingStats() {
  const [users, accounts, commissions] = await Promise.all([
    prisma.user.findMany({ where: { role: 'trader' }, select: { id: true, fullName: true, email: true, signupChannel: true, referredById: true } }),
    prisma.account.findMany({ select: { userId: true, status: true, plan: { select: { priceCents: true } } } }),
    prisma.commission.findMany({ select: { affiliateUserId: true, amountCents: true, status: true } }),
  ]);
  const mUsers: MUser[] = users.map((u) => ({ id: u.id, name: u.fullName || u.email, signupChannel: u.signupChannel, referredById: u.referredById }));
  const mAccts: MAcct[] = accounts.map((a) => ({ userId: a.userId, status: a.status, priceCents: a.plan.priceCents }));
  return summarizeMarketing(mUsers, mAccts, commissions);
}

export async function getAffiliateStats(userId: string) {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
  const [referrals, fundedReferralUsers, commissions] = await Promise.all([
    prisma.user.count({ where: { referredById: userId } }),
    prisma.user.findMany({ where: { referredById: userId, accounts: { some: { status: 'funded' } } }, select: { id: true } }),
    prisma.commission.findMany({ where: { affiliateUserId: userId }, select: { amountCents: true, status: true } }),
  ]);
  const earningsCents = commissions.reduce((s, c) => s + c.amountCents, 0);
  return {
    referralCode: me?.referralCode ?? null,
    referrals,
    fundedReferrals: fundedReferralUsers.length,
    earnings: earningsCents / 100,
    commissionRatePct: 10,
  };
}
