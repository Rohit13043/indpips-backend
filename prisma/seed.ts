// Seed script: creates an admin, a demo trader, the real challenge plans
// (1-step / 2-step / instant across account sizes), and one active mock
// challenge account so you can hit the API immediately.

import bcrypt from 'bcryptjs';
import { prisma } from '../src/db.js';
import { primeMockAccount } from '../src/mt5/mockAdapter.js';

// Common rule blocks per plan type, applied across every account size.
const STANDARD_SIZES = [5000, 10000, 25000, 50000, 100000];
const INSTANT_SIZES = [5000, 10000, 25000, 50000, 100000, 200000];

// Rough pricing per size (cents); tune freely.
const PRICE_BY_SIZE: Record<number, number> = {
  5000: 4900, 10000: 9900, 25000: 19900, 50000: 29900, 100000: 49900, 200000: 99900,
};

function oneStep(size: number) {
  return {
    name: `1-Step ${size / 1000}K`,
    accountSize: size, priceCents: PRICE_BY_SIZE[size], phases: 1,
    phase1TargetPct: 6, phase2TargetPct: null,
    dailyDdPct: 4, maxDdPct: 6, maxDdTrailing: true,
    ddBasis: 'balance', ddRefresh: 'eod', ddBoundaryUtcMin: 1260, // 02:30 IST
    weekendTradingAllowed: false, maxTradeFloatingLossPct: 2,
    payoutMinProfitableDays: 7, payoutMinDailyProfitPct: 0.25, profitSplitPct: 80,
  };
}

function twoStep(size: number) {
  return {
    name: `2-Step ${size / 1000}K`,
    accountSize: size, priceCents: PRICE_BY_SIZE[size], phases: 2,
    phase1TargetPct: 4, phase2TargetPct: 6,
    dailyDdPct: 4, maxDdPct: 6, maxDdTrailing: true,
    ddBasis: 'balance', ddRefresh: 'eod', ddBoundaryUtcMin: 1260,
    weekendTradingAllowed: false, maxTradeFloatingLossPct: 2,
    payoutMinProfitableDays: 5, payoutMinDailyProfitPct: 0.25, profitSplitPct: 80,
  };
}

function instant(size: number) {
  return {
    name: `Instant ${size / 1000}K`,
    accountSize: size, priceCents: PRICE_BY_SIZE[size], phases: 0,
    phase1TargetPct: null, phase2TargetPct: null,
    dailyDdPct: null, maxDdPct: 5, maxDdTrailing: true,
    ddBasis: 'equity', ddRefresh: 'realtime', ddBoundaryUtcMin: 1260,
    weekendTradingAllowed: true, maxTradeFloatingLossPct: null,
    payoutMinProfitableDays: 4, payoutMinDailyProfitPct: 0.25, profitSplitPct: 80,
  };
}

async function upsertPlan(data: ReturnType<typeof oneStep>) {
  const existing = await prisma.challengePlan.findFirst({ where: { name: data.name } });
  return existing
    ? prisma.challengePlan.update({ where: { id: existing.id }, data })
    : prisma.challengePlan.create({ data });
}

async function main() {
  const adminPass = await bcrypt.hash('admin1234', 10);
  const traderPass = await bcrypt.hash('trader1234', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@propfirm.test' },
    update: {},
    create: { email: 'admin@propfirm.test', passwordHash: adminPass, fullName: 'Admin', role: 'admin' },
  });
  const trader = await prisma.user.upsert({
    where: { email: 'trader@propfirm.test' },
    update: {},
    create: { email: 'trader@propfirm.test', passwordHash: traderPass, fullName: 'Demo Trader', role: 'trader' },
  });

  const plans = [
    ...STANDARD_SIZES.map(oneStep),
    ...STANDARD_SIZES.map(twoStep),
    ...INSTANT_SIZES.map(instant),
  ];
  let firstOneStep = null;
  for (const p of plans) {
    const created = await upsertPlan(p);
    if (p.name === '1-Step 10K') firstOneStep = created;
  }

  // One active mock 1-step 10K challenge for the demo trader.
  if (firstOneStep) {
    const login = 'MOCK-1001';
    const existing = await prisma.account.findFirst({ where: { mt5Source: 'mock', mt5Login: login } });
    if (!existing) {
      await prisma.account.create({
        data: {
          userId: trader.id,
          planId: firstOneStep.id,
          mt5Login: login,
          mt5Server: 'MockServer-Demo',
          mt5Source: 'mock',
          status: 'phase_1',
          phase: 1,
          startingBalance: firstOneStep.accountSize,
          balance: firstOneStep.accountSize,
          equity: firstOneStep.accountSize,
          peakValue: firstOneStep.accountSize,
          dayOpenValue: firstOneStep.accountSize,
        },
      });
    }
    primeMockAccount(login, firstOneStep.accountSize);
  }

  console.log('Seed complete.');
  console.log('  Admin:  admin@propfirm.test / admin1234');
  console.log('  Trader: trader@propfirm.test / trader1234');
  console.log(`  Plans:  ${plans.length} (1-step, 2-step, instant across sizes)`);
  console.log('  Demo mock account login: MOCK-1001 (1-Step 10K)');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
