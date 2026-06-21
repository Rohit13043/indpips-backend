// Sync service: for one account, pull the latest MT5 snapshot, ingest new
// closed deals, maintain the daily boundary + trailing peak in the plan's DD
// basis, compute the weekend-trade and per-trade floating-loss inputs, run the
// rules engine, and persist the result.

import type { ChallengePlan } from '@prisma/client';
import { prisma } from '../db.js';
import { getAdapter } from '../mt5/index.js';
import type { Mt5Position } from '../mt5/types.js';
import { evaluate } from '../rules/engine.js';
import type { AccountState, AccountStatus, Basis, PlanRules } from '../rules/types.js';

function planToRules(plan: ChallengePlan): PlanRules {
  return {
    accountSize: plan.accountSize,
    phases: plan.phases,
    phase1TargetPct: plan.phase1TargetPct,
    phase2TargetPct: plan.phase2TargetPct,
    dailyDdPct: plan.dailyDdPct,
    maxDdPct: plan.maxDdPct,
    maxDdTrailing: plan.maxDdTrailing,
    ddBasis: plan.ddBasis as Basis,
    ddRefresh: plan.ddRefresh as 'eod' | 'realtime',
    weekendTradingAllowed: plan.weekendTradingAllowed,
    maxTradeFloatingLossPct: plan.maxTradeFloatingLossPct,
    payoutMinProfitableDays: plan.payoutMinProfitableDays,
    payoutMinDailyProfitPct: plan.payoutMinDailyProfitPct,
  };
}

/**
 * The UTC instant of the most recent daily boundary at or before `now`.
 * boundaryUtcMin is minutes past UTC midnight (1260 = 21:00 UTC = 02:30 IST).
 */
export function lastBoundary(now: Date, boundaryUtcMin: number): Date {
  const b = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  b.setUTCMinutes(boundaryUtcMin);
  if (b.getTime() > now.getTime()) b.setUTCDate(b.getUTCDate() - 1);
  return b;
}

/** True if a trade opened on a Saturday or Sunday (UTC). */
function isWeekendOpen(openedAt: Date): boolean {
  const d = openedAt.getUTCDay(); // 0 = Sun, 6 = Sat
  return d === 0 || d === 6;
}

/** Worst single open position floating loss as a positive % of balance. */
function worstFloatingLossPct(positions: Mt5Position[], balance: number): number {
  if (balance <= 0) return 0;
  let worst = 0;
  for (const p of positions) {
    if (p.floatingPnl < 0) {
      const pct = (-p.floatingPnl / balance) * 100;
      if (pct > worst) worst = pct;
    }
  }
  return Math.round(worst * 100) / 100;
}

export async function syncAccount(accountId: string): Promise<{
  accountId: string;
  status: AccountStatus;
  newDeals: number;
  changed: boolean;
}> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    include: { plan: true },
  });
  if (!account) throw new Error(`Account ${accountId} not found`);
  if (account.status === 'breached') {
    return { accountId, status: 'breached', newDeals: 0, changed: false };
  }

  const plan = account.plan;
  const rules = planToRules(plan);
  const adapter = getAdapter();
  const now = new Date();
  const since = account.lastSyncAt ?? new Date(0);

  const snapshot = await adapter.fetchSnapshot({
    login: account.mt5Login ?? account.id,
    server: account.mt5Server ?? undefined,
    mt5AccountId: account.mt5AccountId,
    since,
  });

  // --- 1. Ingest new closed deals idempotently. ---
  for (const d of snapshot.deals) {
    await prisma.trade.upsert({
      where: { accountId_externalId: { accountId, externalId: d.externalId } },
      update: {},
      create: {
        accountId,
        externalId: d.externalId,
        symbol: d.symbol,
        side: d.side,
        volume: d.volume,
        openPrice: d.openPrice,
        closePrice: d.closePrice,
        profit: d.profit,
        commission: d.commission,
        swap: d.swap,
        openedAt: d.openedAt,
        closedAt: d.closedAt,
      },
    });
  }

  // Recompute trading days + detect any weekend-opened trade (authoritative).
  const allTrades = await prisma.trade.findMany({
    where: { accountId },
    select: { closedAt: true, openedAt: true },
  });
  const dayKeys = new Set<string>();
  let hasWeekendTrade = false;
  for (const t of allTrades) {
    dayKeys.add(t.closedAt.toISOString().slice(0, 10));
    if (isWeekendOpen(t.openedAt)) hasWeekendTrade = true;
  }
  const tradingDays = dayKeys.size;

  // --- 2. Daily boundary rollover + trailing peak, in the plan's DD basis. ---
  const basisValue = rules.ddBasis === 'equity' ? snapshot.account.equity : snapshot.account.balance;

  let dayOpenValue = account.dayOpenValue;
  let lastBoundaryAt = account.lastBoundaryAt ?? null;

  if (rules.ddRefresh === 'eod') {
    const boundary = lastBoundary(now, plan.ddBoundaryUtcMin);
    if (!lastBoundaryAt || boundary.getTime() > lastBoundaryAt.getTime()) {
      // New trading day: the daily baseline becomes the value at the boundary
      // (we use the current synced value as the EOD/observed value).
      dayOpenValue = basisValue;
      lastBoundaryAt = boundary;
    }
  } else {
    // realtime: the "day open" baseline is not used for daily DD (instant has
    // no daily rule), so just track the live value.
    dayOpenValue = basisValue;
  }

  // Trailing peak. For eod plans the peak locks to observed (EOD) values; for
  // realtime plans it follows the live value. Either way max() is correct here
  // because the worker observes the value each cycle.
  const peakValue = Math.max(account.peakValue, basisValue);

  const worstFloating = worstFloatingLossPct(snapshot.positions, snapshot.account.balance);

  // --- 3. Build engine input and evaluate. ---
  const state: AccountState = {
    status: account.status as AccountStatus,
    phase: account.phase,
    startingBalance: account.startingBalance,
    balance: snapshot.account.balance,
    equity: snapshot.account.equity,
    peakValue,
    dayOpenValue,
    hasWeekendTrade,
    worstTradeFloatingLossPct: worstFloating,
  };

  const result = evaluate(state, rules);

  // --- 4. Persist violations. ---
  for (const v of result.violations) {
    await prisma.ruleViolation.create({
      data: {
        accountId,
        rule: v.rule,
        message: v.message,
        valuePct: v.valuePct,
        limitPct: v.limitPct,
        hard: v.hard,
      },
    });
  }

  // --- 5. Persist a metric snapshot for charts/audit. ---
  await prisma.metricSnapshot.create({
    data: {
      accountId,
      balance: snapshot.account.balance,
      equity: snapshot.account.equity,
      dailyDrawdown: result.metrics.dailyDrawdownPct,
      overallDrawdown: result.metrics.maxDrawdownPct,
      profitPct: result.metrics.profitPct,
      tradingDays,
    },
  });

  // --- 6. Persist the account's new live state. ---
  const becameFunded = result.nextStatus === 'funded' && account.status !== 'funded';
  const becameBreached = result.nextStatus === 'breached' && account.status !== 'breached';

  await prisma.account.update({
    where: { id: accountId },
    data: {
      status: result.nextStatus,
      phase: result.nextPhase,
      balance: snapshot.account.balance,
      equity: snapshot.account.equity,
      peakValue,
      dayOpenValue,
      lastBoundaryAt,
      tradingDays,
      lastSyncAt: now,
      mt5Server: snapshot.account.server ?? account.mt5Server,
      ...(becameFunded ? { fundedAt: now } : {}),
      ...(becameBreached
        ? {
            breachedAt: now,
            breachReason: result.violations.find((v) => v.hard)?.message ?? 'Rule breached',
          }
        : {}),
    },
  });

  return { accountId, status: result.nextStatus, newDeals: snapshot.deals.length, changed: result.changed };
}

export async function syncAllActive(): Promise<void> {
  const accounts = await prisma.account.findMany({
    where: { status: { not: 'breached' } },
    select: { id: true },
  });
  for (const a of accounts) {
    try {
      await syncAccount(a.id);
    } catch (err) {
      console.error(`[sync] account ${a.id} failed:`, (err as Error).message);
    }
  }
}
