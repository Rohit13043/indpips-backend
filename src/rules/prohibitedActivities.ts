// Prohibited / restricted trading activities — copied from FundedNext's public
// "Restricted/Prohibited Trading Strategies" policy (help.fundednext.com),
// including their numeric thresholds. These are conduct rules that sit
// ALONGSIDE the numeric evaluation rules in engine.ts.
//
// NOTE: the thresholds below are FundedNext's own published numbers. They are
// independent of YOUR plan rules in engine.ts / the ChallengePlan table (which
// are unchanged). Tune these later if you want different enforcement numbers.
//
// Source: https://help.fundednext.com/en/articles/8020351-what-are-the-restricted-prohibited-trading-strategies

export type Enforcement = 'auto' | 'manual' | 'hybrid';

export interface ProhibitedActivity {
  id: string;
  name: string;
  description: string;
  enforcement: Enforcement;
  // Concrete numeric thresholds from the policy, when defined.
  thresholds?: Record<string, number | string>;
  consequence: string;
}

export const PROHIBITED_ACTIVITIES: ProhibitedActivity[] = [
  {
    id: 'gambling_behavior',
    name: 'Gambling Behavior (Risk & Margin)',
    description:
      'Overleveraging or high-risk trades without a stop-loss. Risk capped at 3% at any time (vs initial balance); margin usage capped at 70% cumulative across open positions.',
    enforcement: 'auto',
    thresholds: { maxRiskPct: 3, maxMarginPct: 70, proRiskPct: 1, proMarginPct: 30 },
    consequence:
      'First breach: warning + 100% of violating-trade profit deducted from reward. Second: further deduction + reclassification to 1% risk / 30% margin. No account termination for risk/margin alone.',
  },
  {
    id: 'all_in_one',
    name: 'All-in-One Trading',
    description:
      'Concentrating account outcome into a single large position / idea so results depend on one trade. A form of gambling behaviour.',
    enforcement: 'manual',
    consequence: 'May be placed under a structured 1% risk framework; otherwise reward denial / removal.',
  },
  {
    id: 'quick_strike',
    name: 'Quick Strike Method',
    description:
      'Positions closed within 30 seconds of opening. The share of total profit from such trades is measured per cycle.',
    enforcement: 'auto',
    thresholds: { tradeSeconds: 30, warnPct: 20, violationPct: 30 },
    consequence:
      'Challenge: warning at 20%, advancement on hold at >=30%. Funded: warning at 20%; if 30% breached, account terminated at cycle end and quick-strike profit forfeited.',
  },
  {
    id: 'high_frequency_trading',
    name: 'High-Frequency Trading (HFT)',
    description:
      'Bots/EAs executing an excessive number of trades within milliseconds–seconds to exploit micro price moves; strains servers and distorts prices.',
    enforcement: 'hybrid',
    consequence: 'Account suspension; cumulative with hyperactivity warnings; may skip warnings if servers strained.',
  },
  {
    id: 'copy_trading_across_accounts',
    name: 'Copy Trading Across Others’ Accounts',
    description:
      'Copy trading is allowed between a single individual’s own challenge accounts, but copying between accounts not owned by the same person (relatives, friends) is prohibited. Selling "pass your challenge"/signal services is banned.',
    enforcement: 'manual',
    consequence: 'Denial of accounts and permanent ban from all services.',
  },
  {
    id: 'group_hedging',
    name: 'Hedging / Group Hedging Across Accounts',
    description:
      'Hedging is allowed only within the same account. Opposite-direction trades on the same asset across multiple accounts (incl. taking near-full daily-loss risk in one trade, suspected multi-platform hedge) is prohibited.',
    enforcement: 'manual',
    consequence: 'Account termination.',
  },
  {
    id: 'arbitrage',
    name: 'Arbitrage Trading (any form)',
    description:
      'Exploiting price discrepancies or time lags across markets/platforms for risk-free profit, including statistical arbitrage.',
    enforcement: 'manual',
    consequence: 'Terms of Service breach; trades voided / account terminated.',
  },
  {
    id: 'tick_scalping',
    name: 'Tick Scalping',
    description:
      'High volume of trades exploiting the smallest tick movements, often automated, front-running and straining liquidity.',
    enforcement: 'manual',
    consequence: 'Restricted; may void trades / terminate.',
  },
  {
    id: 'grid_trading',
    name: 'Grid Trading',
    description:
      'Placing multiple buy/sell orders at laddered price levels above and below market to profit from oscillation; creates artificial activity and tail risk.',
    enforcement: 'manual',
    consequence: 'Prohibited; account termination.',
  },
  {
    id: 'market_settlement_trading',
    name: 'Market Settlement Trading',
    description:
      'Disproportionately generating profit during the low-liquidity settlement window (00:00–02:00 server time) where prices do not reflect genuine sentiment.',
    enforcement: 'auto',
    thresholds: { windowServerStart: '00:00', windowServerEnd: '02:00' },
    consequence: 'Account review, relevant trades voided, or termination.',
  },
  {
    id: 'latency_trading',
    name: 'Latency Trading',
    description:
      'Trading on delayed market data / execution delays to secure guaranteed profit from price discrepancies.',
    enforcement: 'manual',
    consequence: 'Strictly prohibited; account termination.',
  },
  {
    id: 'account_rolling',
    name: 'Account Rolling',
    description:
      'Buying many evaluation accounts in quick succession and sacrificing some to pass others by probability rather than skill.',
    enforcement: 'hybrid',
    consequence: 'Restrictions on purchasing new accounts or lifetime allocation-limit adjustments.',
  },
  {
    id: 'one_sided_betting',
    name: 'One-Sided Betting',
    description:
      'Concentrated directional exposure / multiple same-direction or reactive trades so outcome depends on a single idea — gambling, not skill.',
    enforcement: 'manual',
    consequence: 'May be forced under the 1% risk rule, or refund + indefinite revocation if declined.',
  },
  {
    id: 'hyperactivity',
    name: 'Hyperactivity',
    description:
      'Excessive trading or frequent order modifications (SL/TP/limit changes) that flood the server with messages.',
    enforcement: 'auto',
    thresholds: { tradesPerDay: 200, messagesPerDay: 2000, forceDisableMessages: 15000 },
    consequence:
      'Warnings at 2,000 messages (cumulative across accounts); 3rd time → breach; 15,000 messages/day → forced disable.',
  },
  {
    id: 'demo_server_error_exploit',
    name: 'Exploiting Demo Server Errors / Data Freezing',
    description:
      'Using platform or data freezing from demo server errors as an unfair advantage instead of reporting it.',
    enforcement: 'manual',
    consequence: 'Investigation; revocation of demo server access.',
  },
  {
    id: 'low_liquidity_profit_guarantee',
    name: 'Guaranteed Profit in Low-Liquidity ("Dead Zone")',
    description:
      'Exploiting the US→Asian session low-liquidity transition to evade normal order executions.',
    enforcement: 'manual',
    consequence: 'Terms of Service violation.',
  },
  {
    id: 'account_device_sharing',
    name: 'Account / Device Sharing',
    description:
      'Sharing or reselling accounts, or sharing trading devices with other traders regardless of relationship.',
    enforcement: 'manual',
    consequence: 'Zero-tolerance: Terms of Service breach.',
  },
];

/** Lookup helper. */
export function getProhibitedActivity(id: string): ProhibitedActivity | undefined {
  return PROHIBITED_ACTIVITIES.find((a) => a.id === id);
}
