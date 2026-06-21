// Adapter factory. The rest of the app calls getAdapter() and never imports a
// concrete adapter directly, so swapping sources is a one-line env change.

import type { Mt5Adapter } from './types.js';
import { MockMt5Adapter } from './mockAdapter.js';
import { EaBridgeAdapter } from './eaBridge.js';
import { MetaApiAdapter } from './metaApiAdapter.js';

let cached: Mt5Adapter | null = null;

export function getAdapter(): Mt5Adapter {
  if (cached) return cached;

  const kind = (process.env.MT5_ADAPTER || 'mock').toLowerCase();
  switch (kind) {
    case 'mock':
      cached = new MockMt5Adapter();
      break;
    case 'eabridge':
      cached = new EaBridgeAdapter();
      break;
    case 'metaapi':
      // The MetaApi constructor validates METAAPI_TOKEN, so it only runs here.
      cached = new MetaApiAdapter();
      break;
    default:
      throw new Error(`Unknown MT5_ADAPTER "${kind}" (expected mock | metaapi | eabridge)`);
  }
  return cached;
}

export type { Mt5Adapter, Mt5Snapshot, Mt5Deal, Mt5Account } from './types.js';
