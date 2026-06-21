import { createApp } from './app.js';
import { config } from './config.js';
import { startSyncLoop } from './worker/sync.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
  console.log(`MT5 adapter: ${config.mt5Adapter}`);

  // Run the background sync loop in-process for dev convenience. In production
  // run `npm run worker` as a separate process instead and set RUN_INLINE_WORKER=0.
  if (process.env.RUN_INLINE_WORKER !== '0') {
    startSyncLoop();
  }
});
