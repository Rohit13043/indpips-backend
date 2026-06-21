// Background sync worker. Periodically pulls MT5 data for every active account
// and runs the rules engine. Can run inline with the API server (dev) or as a
// standalone process: `npm run worker`.

import { config } from '../config.js';
import { syncAllActive } from '../services/syncService.js';

let running = false;

export function startSyncLoop(intervalMs = config.syncIntervalMs): NodeJS.Timeout {
  console.log(`[worker] sync loop every ${intervalMs}ms`);

  const tick = async () => {
    if (running) return; // avoid overlapping runs
    running = true;
    const t0 = Date.now();
    try {
      await syncAllActive();
    } catch (err) {
      console.error('[worker] sync failed:', (err as Error).message);
    } finally {
      running = false;
      console.log(`[worker] sync cycle done in ${Date.now() - t0}ms`);
    }
  };

  // Kick off one immediately, then on the interval.
  void tick();
  return setInterval(tick, intervalMs);
}

// Allow running as a standalone process.
if (process.argv[1] && process.argv[1].endsWith('sync.ts')) {
  startSyncLoop();
}
