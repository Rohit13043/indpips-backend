# MT5 Integration Guide

This connects real MetaTrader 5 trading to the INDPIPS rules engine. The whole
app talks only to the `Mt5Adapter` interface, so you pick **one** of two paths
and set `MT5_ADAPTER` accordingly — nothing in the rules engine changes.

| Path | Cost | Best for |
|---|---|---|
| **EA bridge** (`eabridge`) | **Free** | Launching now, self-hosted, any broker |
| **MetaApi** (`metaapi`) | Cheap (free tier) | Hands-off cloud, no EA on the trader's PC |

Both feed the same pipeline:

```
MT5 terminal ──(deals + positions + balance/equity)──▶ /ingest or MetaApi
        ──▶ sync worker ──▶ rules engine ──▶ account status, drawdown, payouts
```

---

## Path A — EA bridge (free)

An Expert Advisor on the trader's MT5 terminal POSTs a snapshot to your API on a
timer. The reference EA is in `mt5-ea/INDPIPS_Bridge.mq5`.

### Server side
1. In `.env` set:
   ```
   MT5_ADAPTER=eabridge
   EA_BRIDGE_SECRET=<a long random string>
   ```
2. Run the API (`npm run dev`) and the sync worker (inline in dev, or `npm run worker`).
3. When you create a trader's account, set:
   - `mt5Source = "eabridge"`
   - `mt5Login = "<their MT5 account number>"`  (must match what the EA sends)

### Trader side (one-time)
1. Copy `INDPIPS_Bridge.mq5` into `MQL5/Experts/` (MetaEditor → compile, or drop the
   `.ex5` build). 
2. In MT5: **Tools → Options → Expert Advisors**
   - tick **"Allow WebRequest for listed URL"**
   - add your API origin, e.g. `https://api.indpips.com`
3. Drag the EA onto any one chart and set inputs:
   - `ApiUrl` = `https://api.indpips.com/ingest`
   - `Secret` = the same `EA_BRIDGE_SECRET`
   - `SendIntervalSec` = `30`
4. Allow algo trading (the EA button is green). It pushes immediately, then every interval.

### What the EA sends
`login, server, balance, equity, currency`, all **open positions** (for the 2%
per-trade floating-loss rule) and **closed deals** from the last `HistoryDays`
(de-duplicated server-side by deal ticket). Payload shape is validated by
`src/routes/ingest.ts` — already verified against the EA output.

### Caveats
- The EA sends **broker server time**. The engine's daily boundary is
  `02:30 IST (21:00 UTC)`. If your broker server isn't on UTC, set
  `ChallengePlan.ddBoundaryUtcMin` so the boundary lands at your intended wall-clock
  reset, or normalise times in `syncService`.
- In-memory buffer: the `eaBridge` adapter holds the latest push in memory. For
  production, persist it (Redis/table) so it survives restarts and scales across
  workers — see the note in `src/mt5/eaBridge.ts`.

---

## Path B — MetaApi (cheap cloud)

No EA on the trader's machine. You provision their MT5 login into MetaApi once;
the cloud keeps a live connection and the `MetaApiAdapter` reads it over HTTP.

### Server side
1. Create a MetaApi account at https://metaapi.cloud and copy your **API token**.
2. In `.env`:
   ```
   MT5_ADAPTER=metaapi
   METAAPI_TOKEN=<your token>
   METAAPI_REGION=new-york
   ```
3. When linking a trader's account, provision it and store the id:
   ```ts
   import { provisionMt5Account } from './src/mt5/metaApiProvision.js';
   const accountId = await provisionMt5Account({
     login: '5012345',
     password: '<investor password>',
     serverName: 'ICMarkets-Demo',
   });
   // save accountId on Account.mt5AccountId, and set mt5Source = "metaapi"
   ```
4. The sync worker then pulls balance/equity, deal history and open positions
   for each account via `src/mt5/metaApiAdapter.ts`.

### Notes
- Use the **investor (read-only) password** — INDPIPS never needs to place trades,
  only read them. Safer for the trader and for you.
- Free tier has connection limits; check current MetaApi pricing before scaling.

---

## The "real" enterprise path (later)

The largest firms run their own **MT5 server / white-label** and use the **MT5
Manager API** to create accounts and read trades server-side (no per-trader EA,
no third party). It has licensing cost. When you get there, add a
`ManagerApiAdapter` implementing the same `Mt5Adapter` interface — the rest of
the platform is unchanged.

---

## Test checklist
- [ ] `EA_BRIDGE_SECRET` (or `METAAPI_TOKEN`) set and `MT5_ADAPTER` chosen
- [ ] Account row has matching `mt5Source` + `mt5Login` (+ `mt5AccountId` for MetaApi)
- [ ] API + sync worker running
- [ ] EA URL whitelisted in MT5 (EA path) and algo trading enabled
- [ ] Make a trade → within a sync cycle it appears on `GET /accounts/:id` and the
      dashboard, with drawdown/target updating
