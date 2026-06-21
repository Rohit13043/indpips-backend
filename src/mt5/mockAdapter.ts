// A fully working, deterministic mock MT5 source. Use it to develop and test the
// whole pipeline for free — no broker, no cloud account. It synthesises a small
// stream of random-ish closed trades and keeps per-login balance in memory so
// equity actually moves between syncs.

import type { Mt5Adapter, Mt5Deal, Mt5Position, Mt5Snapshot } from './types.js';

const SYMBOLS = ['EURUSD', 'GBPUSD', 'XAUUSD', 'US30', 'NAS100'];

interface MockState {
  balance: number;
  dealSeq: number;
  seed: number;
}

const states = new Map<string, MockState>();

// Tiny seeded PRNG so a given login produces a repeatable sequence.
function nextRandom(state: MockState): number {
  state.seed = (state.seed * 1103515245 + 12345) & 0x7fffffff;
  return state.seed / 0x7fffffff;
}

function getState(login: string): MockState {
  let s = states.get(login);
  if (!s) {
    // Derive an initial seed from the login string.
    let seed = 0;
    for (const ch of login) seed = (seed * 31 + ch.charCodeAt(0)) & 0x7fffffff;
    s = { balance: 10000, dealSeq: 0, seed: seed || 1 };
    states.set(login, s);
  }
  return s;
}

/** Lets the seed script / tests preset a login's starting balance. */
export function primeMockAccount(login: string, balance: number): void {
  const s = getState(login);
  s.balance = balance;
}

export class MockMt5Adapter implements Mt5Adapter {
  readonly name = 'mock';

  async fetchSnapshot(params: { login: string; since: Date }): Promise<Mt5Snapshot> {
    const state = getState(params.login);

    // Generate 0–3 new closed deals since the last sync.
    const count = Math.floor(nextRandom(state) * 4);
    const deals: Mt5Deal[] = [];
    const now = Date.now();

    for (let i = 0; i < count; i++) {
      const symbol = SYMBOLS[Math.floor(nextRandom(state) * SYMBOLS.length)];
      const side = nextRandom(state) > 0.5 ? 'buy' : 'sell';
      const volume = Math.round((0.1 + nextRandom(state) * 1.9) * 100) / 100;
      // Profit biased slightly positive so accounts can plausibly pass.
      const profit = Math.round((nextRandom(state) - 0.45) * 400 * volume) / 1;
      const openPrice = Math.round((1 + nextRandom(state)) * 10000) / 10000;
      const closePrice = Math.round(openPrice * (1 + (nextRandom(state) - 0.5) / 100) * 10000) / 10000;

      state.dealSeq += 1;
      state.balance += profit;

      const closedAt = new Date(now - i * 60_000);
      deals.push({
        externalId: `${params.login}-${state.dealSeq}`,
        symbol,
        side,
        volume,
        openPrice,
        closePrice,
        profit,
        commission: -Math.round(volume * 7 * 100) / 100,
        swap: 0,
        openedAt: new Date(closedAt.getTime() - 30 * 60_000),
        closedAt,
      });
    }

    // Occasionally hold an open position with floating P/L so the per-trade
    // floating-loss rule has something to evaluate.
    const positions: Mt5Position[] = [];
    let floating = 0;
    if (nextRandom(state) > 0.5) {
      const symbol = SYMBOLS[Math.floor(nextRandom(state) * SYMBOLS.length)];
      const side = nextRandom(state) > 0.5 ? 'buy' : 'sell';
      const volume = Math.round((0.1 + nextRandom(state) * 1.9) * 100) / 100;
      const fpnl = Math.round((nextRandom(state) - 0.5) * 500 * volume) / 1;
      floating += fpnl;
      positions.push({
        externalId: `${params.login}-pos-${state.dealSeq}`,
        symbol,
        side,
        volume,
        openPrice: 1.05,
        currentPrice: 1.05,
        floatingPnl: fpnl,
        openedAt: new Date(now - 10 * 60_000),
      });
    }

    const equity = Math.round((state.balance + floating) * 100) / 100;

    return {
      account: {
        login: params.login,
        server: 'MockServer-Demo',
        balance: Math.round(state.balance * 100) / 100,
        equity,
        currency: 'USD',
      },
      deals,
      positions,
    };
  }
}
