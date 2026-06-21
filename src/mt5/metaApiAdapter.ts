// MetaApi adapter (https://metaapi.cloud) — the cheapest "real" path: a cloud
// service that connects to any MT5 account and exposes balance/equity and the
// deal history over HTTP. It has a free tier suitable for getting started.
//
// This is a working REST implementation against MetaApi's documented endpoints,
// but it is left as a thin stub you should harden (pagination, rate limits,
// reconnection) before production. Set MT5_ADAPTER=metaapi and METAAPI_TOKEN to
// use it. The trader's MT5 account must first be provisioned in MetaApi and its
// accountId stored on Account.mt5AccountId.

import type { Mt5Adapter, Mt5Deal, Mt5Position, Mt5Snapshot } from './types.js';

const REGION = process.env.METAAPI_REGION || 'new-york';

export class MetaApiAdapter implements Mt5Adapter {
  readonly name = 'metaapi';
  private token: string;

  constructor(token = process.env.METAAPI_TOKEN || '') {
    if (!token) {
      throw new Error('METAAPI_TOKEN is required when MT5_ADAPTER=metaapi');
    }
    this.token = token;
  }

  private clientBase(accountId: string): string {
    // MetaApi's client API host is region-scoped.
    return `https://mt-client-api-v1.${REGION}.agiliumtrade.ai/users/current/accounts/${accountId}`;
  }

  private async get<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: { 'auth-token': this.token },
    });
    if (!res.ok) {
      throw new Error(`MetaApi ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  async fetchSnapshot(params: {
    login: string;
    mt5AccountId?: string | null;
    since: Date;
  }): Promise<Mt5Snapshot> {
    const accountId = params.mt5AccountId;
    if (!accountId) {
      throw new Error(`Account ${params.login} has no mt5AccountId for MetaApi`);
    }
    const base = this.clientBase(accountId);

    // 1. Account information (balance / equity).
    const info = await this.get<{
      balance: number;
      equity: number;
      currency: string;
      server?: string;
    }>(`${base}/account-information`);

    // 2. Closed deals since `since`.
    const startIso = params.since.toISOString();
    const endIso = new Date().toISOString();
    const raw = await this.get<Array<any>>(
      `${base}/history-deals/time/${encodeURIComponent(startIso)}/${encodeURIComponent(endIso)}`,
    );

    const deals: Mt5Deal[] = raw
      // Only realised position-closing deals carry P/L.
      .filter((d) => d.entryType === 'DEAL_ENTRY_OUT' || typeof d.profit === 'number')
      .map((d) => ({
        externalId: String(d.id ?? d.dealId ?? d.ticket),
        symbol: d.symbol ?? 'UNKNOWN',
        side: d.type === 'DEAL_TYPE_SELL' ? 'sell' : 'buy',
        volume: Number(d.volume ?? 0),
        openPrice: Number(d.openPrice ?? d.price ?? 0),
        closePrice: Number(d.price ?? 0),
        profit: Number(d.profit ?? 0),
        commission: Number(d.commission ?? 0),
        swap: Number(d.swap ?? 0),
        openedAt: new Date(d.brokerTime ?? d.time ?? Date.now()),
        closedAt: new Date(d.time ?? Date.now()),
      }));

    // 3. Open positions (for the per-trade floating loss rule).
    let positions: Mt5Position[] = [];
    try {
      const rawPos = await this.get<Array<any>>(`${base}/positions`);
      positions = rawPos.map((p) => ({
        externalId: String(p.id ?? p.ticket),
        symbol: p.symbol ?? 'UNKNOWN',
        side: p.type === 'POSITION_TYPE_SELL' ? 'sell' : 'buy',
        volume: Number(p.volume ?? 0),
        openPrice: Number(p.openPrice ?? 0),
        currentPrice: Number(p.currentPrice ?? p.openPrice ?? 0),
        floatingPnl: Number(p.profit ?? p.unrealizedProfit ?? 0),
        openedAt: new Date(p.time ?? Date.now()),
      }));
    } catch {
      positions = []; // positions endpoint optional; rule simply won't trigger
    }

    return {
      account: {
        login: params.login,
        server: info.server ?? 'MetaApi',
        balance: info.balance,
        equity: info.equity,
        currency: info.currency ?? 'USD',
      },
      deals,
      positions,
    };
  }
}
