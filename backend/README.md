# PayFlow — Backend

Express API server that orchestrates the payroll flow: Uniswap swaps, SideShift cross-chain payments, Chainlink rate verification, World ID verification, and Supabase persistence.

## API Endpoints

### Payroll

| Method | Path                                 | Description                                                                   |
| ------ | ------------------------------------ | ----------------------------------------------------------------------------- |
| `POST` | `/api/payroll/:companyId/cre-quotes` | Batch Uniswap/SideShift quotes for CRE workflow (one call, returns all rates) |
| `POST` | `/api/payroll/:companyId/run`        | Execute payroll after CRE verification                                        |
| `POST` | `/api/payroll/:companyId/run-stream` | Run payroll with SSE progress stream (includes CRE simulation)                |
| `GET`  | `/api/payroll/:companyId/status`     | Poll status of the most recent payroll run                                    |
| `GET`  | `/api/payroll/shift/:shiftId`        | Poll status of a specific payment                                             |

### Company

| Method   | Path                                           | Description                                      |
| -------- | ---------------------------------------------- | ------------------------------------------------ |
| `GET`    | `/api/company/:id`                             | Fetch company + employees                        |
| `POST`   | `/api/company`                                 | Create company                                   |
| `GET`    | `/api/company/:id/balance`                     | Treasury balance for any asset/chain             |
| `GET`    | `/api/company/relayer`                         | Relayer address (company approves this for USDC) |
| `POST`   | `/api/company/:id/employee`                    | Add employee to company                          |
| `DELETE` | `/api/company/:id/employee/:employeeId`        | Remove employee                                  |
| `PATCH`  | `/api/company/:id/employee/:employeeId/salary` | Update employee salary                           |

### Employee

| Method  | Path                                | Description                            |
| ------- | ----------------------------------- | -------------------------------------- |
| `GET`   | `/api/employee/by-wallet/:address`  | Look up employee by wallet address     |
| `PATCH` | `/api/employee/:id/preferred-asset` | Update preferred token and chain       |
| `GET`   | `/api/employee/:address/history`    | Payment history (on-chain + Supabase)  |
| `PUT`   | `/api/employee/:employeeId/splits`  | Save payout splits (multi-token/chain) |

### World ID

| Method | Path                      | Description                                              |
| ------ | ------------------------- | -------------------------------------------------------- |
| `POST` | `/api/worldid/verify`     | Validate World ID v4 proof and mark employee as verified |
| `GET`  | `/api/worldid/rp-context` | Get RpContext for frontend IDKit initialization          |

### ENS

| Method | Path                | Description                         |
| ------ | ------------------- | ----------------------------------- |
| `GET`  | `/api/ens/:address` | Resolve ENS name for an EVM address |

---

## Services

### `services/uniswap.js` — Uniswap Trading API

Core EVM swap engine. Supports five routing modes determined automatically at runtime:

**DIRECT** — same chain, same asset: ERC20 `transfer`, no swap.

**CLASSIC** — same chain, different asset:

1. `getQuote()` → Uniswap Trading API with `protocols: ["V2","V3","V4"]`
2. Sign Permit2 EIP-712 typed data
3. Get calldata from `/v1/swap`
4. Broadcast tx; parse `Transfer` events to find output destination
5. If tokens arrived at relayer → forward to employee via ERC20 `transfer`

**BRIDGE** — cross-chain, same asset:

1. `getQuote()` with `routingPreference: "BEST_PRICE"` → bridge calldata
2. Approve bridge contract; broadcast bridge tx

**Two-hop** — cross-chain, different asset (e.g. USDC@Arbitrum → WETH@Base):

1. Bridge USDC source→destination
2. Poll relayer USDC balance on destination chain every 15s
3. When ≥95% of expected amount arrives, fetch fresh quote and execute swap
4. Fire `onSecondHopComplete` callback → update Supabase

**Quote expiry:** Uniswap quotes expire in ~30s. Fresh quotes are fetched immediately before `executeSwap`.

---

### `services/sideshift.js` — SideShift API v2

Handles EVM→Solana payments for employees who want SOL payouts.

1. `getQuote(depositAsset, depositChainId, depositAmount, settleAddress)` → `/v2/quotes` — returns expected SOL output
2. `createOrder(quote, settleAddress)` → `/v2/orders/fixed` — returns an EVM deposit address; relayer sends tokens there, SideShift delivers SOL
3. `getOrderStatus(orderId)` → `/v2/orders/:id` — poll order state

Used when `getSwapProvider()` returns `"sideshift"` (i.e. EVM input + Solana output).

---

### `services/chainlink.js` — Chainlink Price Feeds

Reads Chainlink AggregatorV3 feeds for swap rate verification. Used in both the CRE workflow (on-chain DON reads) and the backend preflight check.

- `getChainlinkPriceByMode(symbol, networkMode)` — returns price + roundId + updatedAt
- `checkRate(swapRate, settleCoin, networkMode)` — verifies swap rate against oracle; aborts if deviation exceeds tolerance (200 bps mainnet / 8000 bps testnet)

Falls back gracefully to hardcoded prices if the feed is unreachable.

---

### `services/cre-runner.js` — CRE Workflow Runner

Two modes selected by environment:

**Deployed** (`CRE_HTTP_TRIGGER_URL` is set): POSTs the trigger payload to the live Chainlink DON and returns immediately. The DON calls back `POST /api/payroll/:id/run` when verification is complete.

**Simulation** (default): Spawns `cre workflow simulate` as a local subprocess, streams attestation results as SSE steps, and returns the parsed JSON result.

---

### `services/dynamic.js` — Relayer Wallet

Manages the relayer EOA (`RELAYER_PRIVATE_KEY`):

- `pullFromTreasury(asset, address, amount, chainId)` — `transferFrom` company treasury to relayer
- `sendFromRelayer(asset, toAddress, amount, chainId)` — ERC20 transfer from relayer to recipient
- `getTreasuryBalance(asset, address, chainId)` — returns token balance in human-readable units

---

### `services/worldid.js` — World ID v4

- `createRpContext(action)` — generates `RpContext` for the frontend IDKit widget
- `verifyProof(rpId, idkitResponse)` — forwards IDKit result to `developer.world.org/api/v4/verify/:rpId`
- Stores verified nullifiers in memory to prevent double-use

---

## Payroll Run Sequence

```
POST /api/payroll/:companyId/run-stream
  │
  ├── 1. runCreSimulation()      — CRE workflow: Uniswap quotes + Chainlink rate attestation
  │       └── abort if any rate check fails — no funds moved
  ├── 2. expandToPaymentUnits()  — expand splits into individual payment units
  ├── 3. preflight (parallel):   getQuote() + checkRate() for each unit
  │       └── abort if any rate check fails — no funds moved
  ├── 4. pullFromTreasury()      source chain
  ├── 5. for each payment unit (parallel):
  │       ├── provider === "sideshift"
  │       │     └── sideshift.createOrder() → relay deposit → SOL delivered
  │       └── provider === "uniswap"
  │             └── uniswap.executeSwap() → EVM token delivery
  │       └── supabase.insert(payroll_runs)
  └── 6. response with results
```

---

## Environment Variables

Create `backend/.env` (see `.env.example`):

```env
# Relayer
RELAYER_PRIVATE_KEY=       # EOA that signs all txs — fund on all chains

# Uniswap
UNISWAP_API_KEY=           # From https://hub.uniswap.org

# SideShift
SIDESHIFT_SECRET=          # API secret for order creation
SIDESHIFT_AFFILIATE_ID=    # Optional affiliate ID

# Chains
ARBITRUM_RPC_URL=          # e.g. https://arb1.arbitrum.io/rpc
BASE_RPC_URL=              # e.g. https://mainnet.base.org
SEPOLIA_RPC_URL=           # e.g. https://ethereum-sepolia-rpc.publicnode.com
BASE_SEPOLIA_RPC_URL=      # e.g. https://sepolia.base.org

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# World ID
WORLD_ID_APP_ID=           # app_xxxx from developer.worldcoin.org
WORLD_ID_ACTION=           # action string (e.g. "verify-employee")
RP_ID=                     # your RP ID
RP_SIGNING_KEY=            # RP signing key

# Chainlink CRE (deployed DON mode — leave empty for local simulation)
CRE_HTTP_TRIGGER_URL=      # https://gateway.cre.chain.link/trigger/<workflow-id>
```

---

## Development

```bash
npm install
npm run dev     # node --watch, restarts on file changes, port 3001
```

```bash
npm start       # production
```

### Health check

```bash
curl http://localhost:3001/health
```

---

## Database Schema (Supabase)

### `companies`

| Column         | Type | Notes                 |
| -------------- | ---- | --------------------- |
| id             | uuid | PK                    |
| name           | text |                       |
| wallet_address | text | Company USDC treasury |
| payment_asset  | text | e.g. "usdc"           |
| chain_id       | int  | e.g. 42161 (Arbitrum) |

### `employees`

| Column             | Type    | Notes                                  |
| ------------------ | ------- | -------------------------------------- |
| id                 | uuid    | PK                                     |
| company_id         | uuid    | FK → companies                         |
| name               | text    |                                        |
| settle_address     | text    | EVM payout address                     |
| solana_address     | text    | Solana payout address (for SOL splits) |
| preferred_asset    | text    | e.g. "weth"                            |
| preferred_chain_id | int     | e.g. 8453 (Base)                       |
| salary_amount      | numeric | In deposit asset units                 |
| world_id_verified  | boolean | Set after World ID proof               |

### `payroll_splits`

| Column         | Type    | Notes                               |
| -------------- | ------- | ----------------------------------- |
| id             | uuid    | PK                                  |
| employee_id    | uuid    | FK → employees                      |
| asset          | text    | e.g. "usdc", "weth", "sol"          |
| chain_id       | int     | e.g. 42161, 8453                    |
| percent        | numeric | 0–100, splits must sum to 100       |
| settle_address | text    | Optional per-split delivery address |

### `payroll_runs`

| Column                             | Type    | Notes                             |
| ---------------------------------- | ------- | --------------------------------- |
| id                                 | text    | Swap tx hash                      |
| employee_id                        | uuid    | FK                                |
| company_id                         | uuid    | FK                                |
| deposit_asset / settle_asset       | text    | e.g. "USDC" / "WETH"              |
| deposit_chain_id / settle_chain_id | int     |                                   |
| deposit_amount / settle_amount     | numeric |                                   |
| transfer_tx_hash                   | text    | Token delivery tx                 |
| swap_tx_hash                       | text    | Second-hop swap tx (two-hop only) |
| attestation                        | jsonb   | Rate check result                 |
| status                             | text    | processing / settled / failed     |
| is_cross_chain                     | boolean |                                   |
| provider                           | text    | "uniswap" or "sideshift"          |
