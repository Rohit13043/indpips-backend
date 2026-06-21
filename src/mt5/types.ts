// The contract every MT5 data source must satisfy. The rest of the app talks
// only to this interface, so you can swap the underlying source (a mock, a
// cloud service like MetaApi, or a self-hosted EA bridge) without touching the
// rules engine, API, or worker.

export interface Mt5Account {
  login: string;
  server: string;
  balance: number;
  equity: number;
  currency: string;
}

export interface Mt5Deal {
  externalId: string;   // unique id of the closed deal/ticket
  symbol: string;
  side: 'buy' | 'sell';
  volume: number;       // lots
  openPrice: number;
  closePrice: number;
  profit: number;       // net P/L in account currency
  commission: number;
  swap: number;
  openedAt: Date;
  closedAt: Date;
}

// An open (currently floating) position. Needed for the per-trade floating
// loss rule, which closed deals alone cannot express.
export interface Mt5Position {
  externalId: string;
  symbol: string;
  side: 'buy' | 'sell';
  volume: number;
  openPrice: number;
  currentPrice: number;
  floatingPnl: number; // current unrealised P/L in account currency
  openedAt: Date;
}

export interface Mt5Snapshot {
  account: Mt5Account;
  // Closed deals that finished at or after `since`.
  deals: Mt5Deal[];
  // Currently open positions (may be empty).
  positions: Mt5Position[];
}

export interface Mt5Adapter {
  readonly name: string;

  /**
   * Pull the current account figures and any closed deals since `since`.
   * Implementations should return deals idempotently keyed by externalId — the
   * ingestion layer de-duplicates, so returning overlap is safe.
   */
  fetchSnapshot(params: {
    login: string;
    server?: string;
    mt5AccountId?: string | null;
    since: Date;
  }): Promise<Mt5Snapshot>;
}

// Re-exported helper shape; adapters that cannot supply positions return [].
export interface SnapshotParams {
  login: string;
  server?: string;
  mt5AccountId?: string | null;
  since: Date;
}
