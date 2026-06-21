# Funded Prop Firm — Backend & Rules Engine

A backend for a funded prop trading firm: user accounts, challenge/evaluation
plans, a pure rules engine (drawdown limits, profit targets, phase progression),
MT5 trade ingestion via a swappable adapter layer, payouts, and a background
sync worker.

This phase is **backend + rules engine** focused. The dashboard/admin UI sits on
top of this API.

## Stack

- **Node.js 20+ / TypeScript / Express** — REST API
- **Prisma ORM** — SQLite for dev (zero config); one-line swap to PostgreSQL
- **JWT auth** (bcrypt password hashing) with `trader` / `admin` roles
- **Zod** request validation
- **Vitest** unit tests for the rules engine

## Quick start

```bash
npm install
cp .env.example .env          # edit JWT_SECRET etc.
npm run prisma:push           # create the SQLite schema (dev.db)
npm run seed                  # demo admin, trader, plans, one mock account
npm run dev                   # API on http://localhost:4000 (with inline sync worker)
```

Seed logins:

- Admin: `admin@propfirm.test` / `admin1234`
- Trader: `trader@propfirm.test` / `trader1234`

Run the tests:

```bash
npm test                      # rules-engine tests
```

### Trader dashboard

`dashboard.html` is a self-contained trader UI (Chart.js via CDN, no build
step). **Just open the file in a browser** — it has two modes, chosen on the
login screen:

- **Demo (offline)** — the default. Runs entirely in your browser with a faithful
  in-page port of the rules engine and a mock trade feed, so it is fully
  operational with nothing to install or run. Each "Sync now" simulates one
  trading day, so progress, daily-DD resets, breaches, and the payout
  profitable-days rule all behave realistically. State persists in the browser.
- **Live API** — point it at your running backend (default
  `http://localhost:4000`) and log in with the seeded
  `trader@propfirm.test` / `trader1234`. CORS is already enabled on the API.

Both modes share the same screens: accounts overview, a buy-a-challenge
storefront, account detail with equity/balance charts and live limit floors,
"Sync now", payout eligibility + requests, and the prohibited-activities list.

> If you cloned this from a synced/Windows folder and `node_modules` looks
> partial, delete it and run `npm install` again on your local machine.

## How it fits together

```
MT5 source ──> Adapter (mock | metaapi | eabridge) ──> Sync service
                                                          │
                                                          ├─ ingest closed deals (idempotent)
                                                          ├─ recompute balance/equity/drawdown
                                                          ├─ run RULES ENGINE  ◄── pure, fully tested
                                                          └─ persist status, snapshots, violations
Express API ──> auth / plans / accounts / payouts / ingest
```

### The rules engine (`src/rules/`)

Pure functions — no database, no HTTP. You feed it a plan's rules and an
account's live numbers; it returns the next status/phase and any violations.
That purity is why it's the part with full unit-test coverage (19 tests).

The exact rules currently configured (all breaches are **hard** = account fails):

| Rule | 1-Step | 2-Step | Instant |
|---|---|---|---|
| Profit target | 6% | 4% → 6% | none |
| Daily drawdown | 4% (balance) | 4% (balance) | none |
| Max drawdown | 6% trailing (balance) | 6% trailing (balance) | 5% trailing (equity) |
| DD refresh | EOD 02:30 IST (21:00 UTC) | EOD 02:30 IST | real-time |
| Weekend trading | not allowed | not allowed | allowed |
| Max floating loss / single trade | 2% | 2% | — |
| News trading | allowed | allowed | allowed |
| Consistency / min days | none | none | none |
| Payout: profitable days @≥0.25% | 7 | 5 | 4 |
| Account sizes | 5/10/25/50/100K | 5/10/25/50/100K | + 200K |

- **Drawdown basis & refresh** — each plan sets `ddBasis` (balance/equity) and
  `ddRefresh` (eod/realtime). EOD plans lock the daily baseline and trailing
  peak at the 02:30 IST boundary; realtime plans trail the live value.
- **Phase progression** — `pending → phase_1 → phase_2 → funded`, or instant
  funding (0-step). There is no minimum-trading-days gate — you pass the moment
  the target is hit. A hard breach takes precedence over a simultaneous target.
- **Payout eligibility** — a funded account needs N profitable days (each
  ≥0.25% of account size), counted cumulatively. Enforced in
  `services/payoutEligibility.ts` and on `POST /payouts`.

Plans are data, not code (`ChallengePlan` table), so every number above is
editable per-plan without touching the engine.

### Prohibited trading activities (`src/rules/prohibitedActivities.ts`)

A catalog of restricted/prohibited strategies copied from FundedNext's public
policy, **including their numeric thresholds** — gambling/risk-margin,
all-in-one, quick-strike, HFT, copy-trading across accounts, group hedging,
arbitrage, tick scalping, grid, settlement-window, latency, account rolling,
one-sided betting, hyperactivity, demo-error exploits, low-liquidity
guarantees, and account/device sharing. Each entry carries its enforcement type
(`auto` / `manual` / `hybrid`), the FundedNext thresholds where defined
(quick-strike 30s/30%, hyperactivity 200 trades / 2,000 msgs, 3% risk / 70%
margin, settlement window 00:00–02:00), and the consequence. Exposed at
`GET /prohibited-activities`. These thresholds are FundedNext's and are separate
from your plan rules — tune them whenever you like.

## MT5 integration — pick what's free/cheap for you

The app talks only to the `Mt5Adapter` interface (`src/mt5/`), so you swap the
source with one env var (`MT5_ADAPTER`) and never touch the rules engine.

| Adapter | Cost | What it is |
|---|---|---|
| `mock` | **Free** | Built-in, working. Synthesises closed trades so you can develop/test the whole pipeline with no broker. Default. |
| `eabridge` | **Free** | You host it. An MT5 Expert Advisor on the trader's terminal POSTs account figures + closed deals to `POST /ingest`. No broker API needed. |
| `metaapi` | **Cheap** (free tier) | [MetaApi](https://metaapi.cloud) cloud connects to any MT5 account and exposes balance/equity + deal history over HTTP. Set `METAAPI_TOKEN` and store each account's `mt5AccountId`. |

> The truly "real" prop-firm setup is an **MT5 Manager API** (you run your own
> MT5 server / white-label), which lets you create accounts and read trades
> server-side. That has licensing cost. The adapter interface is ready for it —
> add a `ManagerApiAdapter` implementing `Mt5Adapter` when you get there.

> **Full MT5 setup is in [MT5_SETUP.md](MT5_SETUP.md)** — it covers the free EA
> bridge (with the ready-to-install Expert Advisor at `mt5-ea/INDPIPS_Bridge.mq5`),
> the MetaApi cloud path (with `src/mt5/metaApiProvision.ts`), and the enterprise
> Manager-API path.

### Reference EA bridge payload

Your Expert Advisor (or a small EA→HTTP helper) sends, on each closed trade or
on a timer:

```http
POST /ingest
x-ea-secret: <EA_BRIDGE_SECRET>
Content-Type: application/json

{
  "login": "5012345",
  "server": "YourBroker-Live",
  "balance": 10250.00,
  "equity": 10180.50,
  "currency": "USD",
  "deals": [
    {
      "externalId": "987654",
      "symbol": "EURUSD",
      "side": "buy",
      "volume": 0.50,
      "openPrice": 1.0850,
      "closePrice": 1.0890,
      "profit": 200.00,
      "commission": -3.50,
      "swap": 0,
      "openedAt": "2026-06-21T08:00:00Z",
      "closedAt": "2026-06-21T09:15:00Z"
    }
  ]
}
```

The account in your DB must have `mt5Source = "eabridge"` and `mt5Login` matching
the EA's `login`.

## API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | — | Create a trader account |
| POST | `/auth/login` | — | Get a JWT |
| GET | `/plans` | — | List active challenge plans |
| POST | `/plans` | admin | Create a plan |
| GET | `/accounts` | user | List own accounts (admin: all) |
| POST | `/accounts` | user | Start a challenge from a plan |
| GET | `/accounts/:id` | owner/admin | Detail + snapshots, trades, violations |
| POST | `/accounts/:id/sync` | owner/admin | Force an immediate sync (handy for demos) |
| POST | `/ingest` | EA secret | EA bridge pushes account data + deals |
| GET | `/payouts` | user | List payouts |
| GET | `/payouts/eligibility/:accountId` | owner/admin | Profitable-days eligibility status |
| POST | `/payouts` | user | Funded trader requests a withdrawal (eligibility enforced) |
| PATCH | `/payouts/:id` | admin | Approve / pay / reject |
| GET | `/prohibited-activities` | — | Prohibited/restricted strategies catalog |
| POST | `/accounts/:id/status` | admin | Manually pass / breach / reset an account |
| PATCH | `/accounts/:id/mt5` | admin | Link or update an account's MT5 connection |
| GET | `/admin/stats` | admin | Firm overview, funnel, unit economics, risk book |
| GET | `/admin/users` | admin | List traders with KYC status + account counts |
| PATCH | `/admin/users/:id/kyc` | admin | Verify / reject a trader's KYC |

### Try it end to end (mock)

```bash
# log in as the seeded trader
TOKEN=$(curl -s localhost:4000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"trader@propfirm.test","password":"trader1234"}' | jq -r .token)

# list accounts, grab the id, then force a few syncs to generate trades
curl -s localhost:4000/accounts -H "Authorization: Bearer $TOKEN" | jq
curl -s -X POST localhost:4000/accounts/<ID>/sync -H "Authorization: Bearer $TOKEN" | jq
```

## Going to production

1. **Postgres**: in `prisma/schema.prisma` set `provider = "postgresql"`, point
   `DATABASE_URL` at your instance, run `npm run prisma:migrate`.
2. **Separate worker**: set `RUN_INLINE_WORKER=0` on the API and run
   `npm run worker` as its own process (so syncs don't block requests).
3. **EA bridge buffer**: it's in-memory for dev. Persist it (Redis or a table)
   so pushes survive restarts and scale across workers.
4. **Payments**: a Razorpay connector is available in this workspace — wire
   `/accounts` creation to a successful payment before activating a challenge.
5. **Secrets/hardening**: strong `JWT_SECRET`, rate limiting, refresh tokens,
   audit logging, and rounding/currency review in the rules engine for your
   exact broker semantics (some firms base daily DD on balance, not equity).

## Project layout

```
prisma/
  schema.prisma         # data model + state machine
  seed.ts               # demo data
src/
  rules/
    engine.ts                # the rules engine (pure)
    types.ts
    engine.test.ts           # 19 unit tests
    prohibitedActivities.ts  # FundedNext-style prohibited strategies catalog
  mt5/
    types.ts            # Mt5Adapter interface (+ open positions)
    mockAdapter.ts      # working free adapter
    metaApiAdapter.ts   # MetaApi (cheap) implementation
    eaBridge.ts         # self-hosted EA bridge (free)
    index.ts            # adapter factory (MT5_ADAPTER env)
  services/
    syncService.ts          # ingest + EOD boundary + evaluate + persist
    payoutEligibility.ts     # profitable-days payout rule
  worker/sync.ts            # periodic sync loop
  routes/                   # auth, plans, accounts, payouts, ingest, prohibited
  auth/jwt.ts
  app.ts  server.ts  config.ts  db.ts
```
