// The rules engine. Pure functions only. Every rule below is exactly one you
// specified — there are no invented limits or thresholds. Plans supply the
// numbers (targets, %, bases); this file only applies them.
//
// Drawdown percentages are returned as positive magnitudes. Profit is signed.

import type {
  AccountState,
  AccountStatus,
  Basis,
  EvaluationResult,
  PlanRules,
  Violation,
} from './types.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The measured value for this plan's DD/target basis. */
function measured(state: AccountState, basis: Basis): number {
  return basis === 'equity' ? state.equity : state.balance;
}

/** Floor value for the static daily drawdown, or null if the plan has none. */
export function dailyLossFloor(state: AccountState, plan: PlanRules): number | null {
  if (plan.dailyDdPct == null) return null;
  return state.dayOpenValue * (1 - plan.dailyDdPct / 100);
}

/** Absolute floor value for the max/overall drawdown. */
export function maxLossFloor(state: AccountState, plan: PlanRules): number {
  // Trailing → from the running peak; static → from the starting balance.
  const base = plan.maxDdTrailing ? state.peakValue : state.startingBalance;
  return base * (1 - plan.maxDdPct / 100);
}

/** Value needed to pass the current evaluation phase, or null if no target. */
export function profitTargetValue(state: AccountState, plan: PlanRules): number | null {
  const target = state.phase === 2 ? plan.phase2TargetPct : plan.phase1TargetPct;
  if (target == null) return null;
  return state.startingBalance * (1 + target / 100);
}

/** Current daily drawdown as a positive % of the day's opening value. */
export function dailyDrawdownPct(state: AccountState, plan: PlanRules): number {
  if (plan.dailyDdPct == null || state.dayOpenValue <= 0) return 0;
  const dd = ((state.dayOpenValue - measured(state, plan.ddBasis)) / state.dayOpenValue) * 100;
  return dd > 0 ? round2(dd) : 0;
}

/** Current max/overall drawdown as a positive % of the relevant base. */
export function maxDrawdownPct(state: AccountState, plan: PlanRules): number {
  const base = plan.maxDdTrailing ? state.peakValue : state.startingBalance;
  if (base <= 0) return 0;
  const dd = ((base - measured(state, plan.ddBasis)) / base) * 100;
  return dd > 0 ? round2(dd) : 0;
}

/** Total profit as a signed % of the starting balance. */
export function profitPct(state: AccountState): number {
  if (state.startingBalance <= 0) return 0;
  return round2(((state.balance - state.startingBalance) / state.startingBalance) * 100);
}

/** Detect every hard rule violation for the current state. */
export function detectViolations(state: AccountState, plan: PlanRules): Violation[] {
  const violations: Violation[] = [];

  // 1. Daily drawdown.
  if (plan.dailyDdPct != null) {
    const dd = dailyDrawdownPct(state, plan);
    if (dd > plan.dailyDdPct) {
      violations.push({
        rule: 'daily_drawdown',
        message: `Daily drawdown ${dd}% exceeded the ${plan.dailyDdPct}% limit (${plan.ddBasis}).`,
        valuePct: dd,
        limitPct: plan.dailyDdPct,
        hard: true,
      });
    }
  }

  // 2. Max / overall drawdown.
  const maxDd = maxDrawdownPct(state, plan);
  if (maxDd > plan.maxDdPct) {
    violations.push({
      rule: 'max_drawdown',
      message: `Max drawdown ${maxDd}% exceeded the ${plan.maxDdPct}% ${
        plan.maxDdTrailing ? 'trailing ' : ''
      }limit (${plan.ddBasis}).`,
      valuePct: maxDd,
      limitPct: plan.maxDdPct,
      hard: true,
    });
  }

  // 3. Weekend trading.
  if (!plan.weekendTradingAllowed && state.hasWeekendTrade) {
    violations.push({
      rule: 'weekend_trading',
      message: 'A trade was opened during the weekend, which is not allowed.',
      valuePct: 0,
      limitPct: 0,
      hard: true,
    });
  }

  // 4. Single-trade floating loss cap.
  if (plan.maxTradeFloatingLossPct != null) {
    if (state.worstTradeFloatingLossPct > plan.maxTradeFloatingLossPct) {
      violations.push({
        rule: 'trade_floating_loss',
        message: `A single trade's floating loss ${state.worstTradeFloatingLossPct}% exceeded the ${plan.maxTradeFloatingLossPct}% per-trade cap.`,
        valuePct: state.worstTradeFloatingLossPct,
        limitPct: plan.maxTradeFloatingLossPct,
        hard: true,
      });
    }
  }

  return violations;
}

/** Compute the next phase/status after a phase target is passed. */
function promote(state: AccountState, plan: PlanRules): { status: AccountStatus; phase: number } {
  if (state.status === 'funded') return { status: 'funded', phase: state.phase };
  const nextPhase = state.phase + 1;
  if (nextPhase > plan.phases) {
    return { status: 'funded', phase: state.phase }; // cleared the final phase
  }
  const status: AccountStatus = nextPhase === 2 ? 'phase_2' : 'phase_1';
  return { status, phase: nextPhase };
}

/**
 * Main entry point. Order of precedence:
 *   1. Any hard violation kills the account (-> breached), even if the target
 *      was also reached on the same update.
 *   2. Otherwise, if the phase profit target is reached, promote/fund. There is
 *      no minimum-trading-days gate (you pass instantly).
 *   3. Otherwise the account stays where it is.
 */
export function evaluate(state: AccountState, plan: PlanRules): EvaluationResult {
  const metrics = {
    dailyDrawdownPct: dailyDrawdownPct(state, plan),
    maxDrawdownPct: maxDrawdownPct(state, plan),
    profitPct: profitPct(state),
    dailyLossFloor: dailyLossFloor(state, plan) == null ? null : round2(dailyLossFloor(state, plan)!),
    maxLossFloor: round2(maxLossFloor(state, plan)),
    profitTargetValue: profitTargetValue(state, plan) == null ? null : round2(profitTargetValue(state, plan)!),
  };

  if (state.status === 'breached') {
    return { nextStatus: 'breached', nextPhase: state.phase, changed: false, violations: [], targetReached: false, metrics };
  }

  const violations = detectViolations(state, plan);
  if (violations.some((v) => v.hard)) {
    return {
      nextStatus: 'breached',
      nextPhase: state.phase,
      changed: state.status !== 'breached',
      violations,
      targetReached: false,
      metrics,
    };
  }

  // Funded accounts keep running; profit is realised via payouts, not promotion.
  if (state.status === 'funded') {
    return { nextStatus: 'funded', nextPhase: state.phase, changed: false, violations, targetReached: false, metrics };
  }

  // Evaluation phases: check the profit target (no day gate).
  const targetValue = profitTargetValue(state, plan);
  const targetReached = targetValue != null && measured(state, plan.ddBasis) >= targetValue;

  if (targetReached) {
    const { status, phase } = promote(state, plan);
    return {
      nextStatus: status,
      nextPhase: phase,
      changed: status !== state.status || phase !== state.phase,
      violations,
      targetReached: true,
      metrics,
    };
  }

  // No change. Normalise a fresh 'pending' account that has started trading.
  let nextStatus = state.status;
  if (state.status === 'pending' && (state.balance !== state.startingBalance || state.equity !== state.startingBalance)) {
    nextStatus = plan.phases === 0 ? 'funded' : 'phase_1';
  }

  return { nextStatus, nextPhase: state.phase, changed: nextStatus !== state.status, violations, targetReached: false, metrics };
}
