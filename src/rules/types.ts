// Shared types for the rules engine. The engine is pure: no Prisma, no Express,
// no MT5. You feed it plain numbers and it returns a decision. Every rule here
// maps 1:1 to a rule you specified — nothing is assumed.

export type AccountStatus =
  | 'pending'   // bought, MT5 not linked / no trades yet
  | 'phase_1'   // evaluation phase 1
  | 'phase_2'   // evaluation phase 2 (2-step only)
  | 'funded'    // live funded account
  | 'breached'; // a hard rule was broken — account is dead

// Which value a drawdown/target is measured against.
export type Basis = 'balance' | 'equity';

// How the drawdown baseline/peak moves.
//  - 'eod'      : daily baseline and trailing peak lock to the end-of-day value
//                 at the configured boundary (e.g. 02:30 IST = 21:00 UTC).
//  - 'realtime' : the trailing peak follows the live value continuously.
export type DdRefresh = 'eod' | 'realtime';

export interface PlanRules {
  accountSize: number;
  phases: number; // 0 = instant, 1 = 1-step, 2 = 2-step

  // Profit targets per phase. Undefined/null = no target (instant funding).
  phase1TargetPct?: number | null;
  phase2TargetPct?: number | null;

  // Daily drawdown. Undefined/null = no daily rule (instant has none).
  dailyDdPct?: number | null;

  // Max/overall drawdown (always present).
  maxDdPct: number;
  maxDdTrailing: boolean; // all your plans: true

  // Basis + refresh model applied to BOTH daily and max DD for this plan.
  ddBasis: Basis;
  ddRefresh: DdRefresh;

  // Other hard rules.
  weekendTradingAllowed: boolean;
  // Max floating loss a SINGLE open trade may show, as % of balance.
  // Undefined/null = rule disabled (instant).
  maxTradeFloatingLossPct?: number | null;

  // Payout eligibility (applies on funded accounts).
  payoutMinProfitableDays: number;
  payoutMinDailyProfitPct: number; // a day counts if profit >= this % of account size
}

// The live numbers describing an account at the moment of evaluation.
export interface AccountState {
  status: AccountStatus;
  phase: number; // 1-based
  startingBalance: number;
  balance: number;
  equity: number;

  // Trailing peak in the plan's DD basis (peak balance for eod-balance plans,
  // peak equity for realtime-equity plans). Maintained by the sync service.
  peakValue: number;
  // The value (in the plan's basis) at the start of the current trading day,
  // used for the static daily drawdown. Maintained by the sync service.
  dayOpenValue: number;

  // Whether any trade was opened during a weekend since the account started.
  hasWeekendTrade: boolean;
  // The worst single open trade's floating loss right now, as % of balance
  // (positive magnitude). 0 if no open trade is in loss.
  worstTradeFloatingLossPct: number;
}

export type ViolationRule =
  | 'daily_drawdown'
  | 'max_drawdown'
  | 'weekend_trading'
  | 'trade_floating_loss';

export interface Violation {
  rule: ViolationRule;
  message: string;
  valuePct: number;
  limitPct: number;
  hard: boolean; // every rule you specified is hard
}

export interface EvaluationResult {
  nextStatus: AccountStatus;
  nextPhase: number;
  changed: boolean;
  violations: Violation[];
  targetReached: boolean;
  metrics: {
    dailyDrawdownPct: number;
    maxDrawdownPct: number;
    profitPct: number;
    dailyLossFloor: number | null; // value floor for today (null if no daily rule)
    maxLossFloor: number;          // absolute value floor
    profitTargetValue: number | null; // value needed to pass current phase
  };
}
