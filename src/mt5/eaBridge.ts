// Self-hosted EA bridge — the fully free path. Instead of polling, an MT5
// Expert Advisor running on the trader's terminal POSTs account figures and
// closed deals to your API (see routes/ingest.ts). Those pushes land in this
// in-memory buffer, and the adapter simply hands the latest buffered data to
// the sync worker.
//
// In-memory is fine for a single-process dev/demo setup. For production, persist
// the buffer to Redis or a table so it survives restarts and scales across
// workers. A reference EA is documented in README.md.

import type { Mt5Adapter, Mt5Deal, Mt5Position, Mt5Snapshot } from './types.js';

interface BufferEntry {
  balance: number;
  equity: number;
  currency: string;
  server: string;
  deals: Mt5Deal[];
  positions: Mt5Position[];
}

const buffer = new Map<string, BufferEntry>();

/** Called by the /ingest route when an EA pushes data for a login. */
export function pushEaData(login: string, entry: BufferEntry): void {
  const existing = buffer.get(login);
  if (!existing) {
    buffer.set(login, entry);
    return;
  }
  // Merge new deals, de-duplicating by externalId; update live figures.
  const seen = new Set(existing.deals.map((d) => d.externalId));
  const merged = [...existing.deals];
  for (const d of entry.deals) {
    if (!seen.has(d.externalId)) merged.push(d);
  }
  buffer.set(login, {
    balance: entry.balance,
    equity: entry.equity,
    currency: entry.currency,
    server: entry.server,
    deals: merged,
    positions: entry.positions, // open positions reflect the latest push
  });
}

export class EaBridgeAdapter implements Mt5Adapter {
  readonly name = 'eabridge';

  async fetchSnapshot(params: { login: string; since: Date }): Promise<Mt5Snapshot> {
    const entry = buffer.get(params.login);
    if (!entry) {
      // No EA data yet — report a neutral snapshot with no deals.
      return {
        account: {
          login: params.login,
          server: 'pending-ea',
          balance: 0,
          equity: 0,
          currency: 'USD',
        },
        deals: [],
        positions: [],
      };
    }

    const deals = entry.deals.filter((d) => d.closedAt >= params.since);
    return {
      account: {
        login: params.login,
        server: entry.server,
        balance: entry.balance,
        equity: entry.equity,
        currency: entry.currency,
      },
      deals,
      positions: entry.positions ?? [],
    };
  }
}
