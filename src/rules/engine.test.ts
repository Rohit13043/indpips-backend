import { describe, it, expect } from 'vitest';
import {
  evaluate,
  dailyDrawdownPct,
  maxDrawdownPct,
  detectViolations,
} from './engine.js';
import type { AccountState, PlanRules } from './types.js';

// --- Plans matching the real spec ---

const oneStep: PlanRules = {
  accountSize: 10000,
  phases: 1,
  phase1TargetPct: 6,
  phase2TargetPct: null,
  dailyDdPct: 4,
  maxDdPct: 6,
  maxDdTrailing: true,
  ddBasis: 'balance',
  ddRefresh: 'eod',
  weekendTradingAllowed: false,
  maxTradeFloatingLossPct: 2,
  payoutMinProfitableDays: 7,
  payoutMinDailyProfitPct: 0.25,
};

const twoStep: PlanRules = { ...oneStep, phases: 2, phase1TargetPct: 4, phase2TargetPct: 6, payoutMinProfitableDays: 5 };

const instant: PlanRules = {
  ...oneStep,
  phases: 0,
  phase1TargetPct: null,
  phase2TargetPct: null,
  dailyDdPct: null,
  maxDdPct: 5,
  ddBasis: 'equity',
  ddRefresh: 'realtime',
  weekendTradingAllowed: true,
  maxTradeFloatingLossPct: null,
  payoutMinProfitableDays: 4,
};

function state(overrides: Partial<AccountState> = {}): AccountState {
  return {
    status: 'phase_1',
    phase: 1,
    startingBalance: 10000,
    balance: 10000,
    equity: 10000,
    peakValue: 10000,
    dayOpenValue: 10000,
    hasWeekendTrade: false,
    worstTradeFloatingLossPct: 0,
    ...overrides,
  };
}

describe('drawdown math (balance basis)', () => {
  it('daily drawdown is a positive pct of day-open value', () => {
    const s = state({ dayOpenValue: 10000, balance: 9650 });
    expect(dailyDrawdownPct(s, oneStep)).toBe(3.5);
  });

  it('max drawdown trails the peak value', () => {
    const s = state({ peakValue: 11000, balance: 10500 });
    // (11000-10500)/11000 = 4.55%
    expect(maxDrawdownPct(s, oneStep)).toBeCloseTo(4.55, 1);
  });
});

describe('1-step hard breaches', () => {
  it('breaches on daily DD over 4%', () => {
    const s = state({ dayOpenValue: 10000, balance: 9550 }); // 4.5%
    expect(evaluate(s, oneStep).nextStatus).toBe('breached');
  });

  it('does not breach exactly at 4% daily', () => {
    const s = state({ dayOpenValue: 10000, balance: 9600 }); // exactly 4%
    expect(evaluate(s, oneStep).nextStatus).not.toBe('breached');
  });

  it('breaches on trailing max DD over 6%', () => {
    const s = state({ peakValue: 11000, balance: 10000 }); // 9.09%
    const r = evaluate(s, oneStep);
    expect(r.nextStatus).toBe('breached');
    expect(r.violations.some((v) => v.rule === 'max_drawdown')).toBe(true);
  });

  it('breaches on weekend trade', () => {
    const s = state({ hasWeekendTrade: true });
    const r = evaluate(s, oneStep);
    expect(r.nextStatus).toBe('breached');
    expect(r.violations.some((v) => v.rule === 'weekend_trading')).toBe(true);
  });

  it('breaches on a single trade floating loss over 2%', () => {
    const s = state({ worstTradeFloatingLossPct: 2.5 });
    const r = evaluate(s, oneStep);
    expect(r.nextStatus).toBe('breached');
    expect(r.violations.some((v) => v.rule === 'trade_floating_loss')).toBe(true);
  });
});

describe('1-step passing', () => {
  it('funds immediately when 6% target hit (no min days)', () => {
    const s = state({ balance: 10600 });
    const r = evaluate(s, oneStep);
    expect(r.targetReached).toBe(true);
    expect(r.nextStatus).toBe('funded');
  });

  it('does not pass below target', () => {
    const s = state({ balance: 10500 });
    expect(evaluate(s, oneStep).nextStatus).toBe('phase_1');
  });

  it('breach takes precedence over a simultaneous target hit', () => {
    const s = state({ balance: 10600, hasWeekendTrade: true });
    expect(evaluate(s, oneStep).nextStatus).toBe('breached');
  });
});

describe('2-step progression', () => {
  it('phase_1 -> phase_2 at 4% target', () => {
    const s = state({ status: 'phase_1', phase: 1, balance: 10400 });
    const r = evaluate(s, twoStep);
    expect(r.nextStatus).toBe('phase_2');
    expect(r.nextPhase).toBe(2);
  });

  it('phase_2 needs 6% (4% is not enough)', () => {
    const s = state({ status: 'phase_2', phase: 2, balance: 10400 });
    expect(evaluate(s, twoStep).nextStatus).toBe('phase_2');
  });

  it('phase_2 funds at 6%', () => {
    const s = state({ status: 'phase_2', phase: 2, balance: 10600 });
    expect(evaluate(s, twoStep).nextStatus).toBe('funded');
  });
});

describe('instant plan', () => {
  it('has no daily DD rule', () => {
    const s = state({ status: 'funded', phase: 1, dayOpenValue: 10000, equity: 9000, balance: 10000 });
    // 10% off day-open would breach daily IF daily existed; instant has none.
    const v = detectViolations(s, instant);
    expect(v.some((x) => x.rule === 'daily_drawdown')).toBe(false);
  });

  it('breaches on 5% trailing equity DD', () => {
    const s = state({ status: 'funded', phase: 1, peakValue: 10000, equity: 9400 }); // 6% equity
    const r = evaluate(s, instant);
    expect(r.nextStatus).toBe('breached');
  });

  it('allows weekend trades and ignores per-trade floating loss', () => {
    const s = state({ status: 'funded', phase: 1, hasWeekendTrade: true, worstTradeFloatingLossPct: 10, equity: 10000, peakValue: 10000 });
    expect(evaluate(s, instant).nextStatus).toBe('funded');
  });
});

describe('terminal & funded states', () => {
  it('breached stays breached', () => {
    const s = state({ status: 'breached', balance: 12000 });
    const r = evaluate(s, oneStep);
    expect(r.nextStatus).toBe('breached');
    expect(r.changed).toBe(false);
  });

  it('funded survives normal trading without promotion', () => {
    const s = state({ status: 'funded', phase: 1, balance: 10300, peakValue: 10300 });
    expect(evaluate(s, oneStep).nextStatus).toBe('funded');
  });

  it('funded still breaches on blown max DD', () => {
    const s = state({ status: 'funded', phase: 1, peakValue: 11000, balance: 10200 }); // 7.27%
    expect(evaluate(s, oneStep).nextStatus).toBe('breached');
  });
});
// end of tests
