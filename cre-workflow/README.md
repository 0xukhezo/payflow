# PayFlow · CRE Payroll Workflow

Chainlink CRE workflow that orchestrates PayFlow payroll runs on the Decentralised Oracle Network (DON). Each CRE node independently executes the steps below; results are aggregated by DON consensus before dispatch.

## What It Does

1. **HTTP trigger** — receives a JSON payload with the employee roster and treasury address.
2. **Chainlink Data Feeds** (2 HTTP requests) — reads ETH/USD and BTC/USD from Chainlink AggregatorV3 on Sepolia. USDC is hardcoded at $1.00.
3. **USDC peg check** — verifies the stablecoin peg (assumed stable, logged for attestation).
4. **Backend quotes** (1 HTTP request) — calls `/api/payroll/:companyId/cre-quotes` to fetch all Uniswap/SideShift quotes in one batch. Handles two-hop routing (bridge + swap) for cross-chain payments.
5. **Rate attestation** — verifies each quote against Chainlink oracle prices. Payments outside `toleranceBps` are flagged and blocked.
6. **On-chain report** (evm-write, optional) — if `dispatcherAddress` is set, sends an ABI-encoded payroll manifest to `PayrollDispatcher.sol` via `writeReport`.
8. **Backend dispatch** (1 HTTP request) — calls `/api/payroll/:companyId/run` to execute the actual token transfers.

**Total HTTP budget: 4 requests** (2 Chainlink + 1 quotes + 1 dispatch), well within the CRE 5-request limit.

## Trigger Payload

```json
{
  "companyId": "uuid",
  "treasury": "0xTreasuryAddress",
  "depositChainId": 42161,
  "employees": [
    {
      "id": "emp-001",
      "name": "Alice",
      "salaryUsdc": 3000,
      "settleAddress": "0xEmployeeAddress",
      "solanaAddress": "SolanaBase58Address",
      "preferredAsset": "WETH",
      "preferredChainId": 42161,
      "splits": [
        {
          "percent": 50,
          "asset": "WETH",
          "chain_id": 42161,
          "settleAddress": "0x..."
        },
        {
          "percent": 50,
          "asset": "USDC",
          "chain_id": 8453,
          "settleAddress": "0x..."
        }
      ]
    }
  ]
}
```

`splits` is optional. If present and sums to 100%, the salary is distributed across the splits instead of using `preferredAsset`/`preferredChainId`.

## Output

```json
{
  "status": "ok",
  "dispatched": true,
  "companyId": "uuid",
  "summary": {
    "totalUsdc": 3000,
    "queued": 2,
    "failed": 0,
    "skipped": 0,
    "timestamp": "2026-04-03T20:00:00.000Z"
  },
  "oracles": {
    "ETH/USD": 2048.32,
    "USDC/USD": 1.0,
    "BTC/USD": 83500.0,
    "pegDeviationBps": 0,
    "pegPass": true
  },
  "results": [
    {
      "employeeId": "emp-001",
      "employeeName": "Alice",
      "salaryUsdc": 1500,
      "settleAmount": 0.00732,
      "settleAsset": "WETH",
      "settleChainId": 42161,
      "settleAddress": "0x...",
      "oraclePrice": 2048.32,
      "deviationBps": 12,
      "status": "queued",
      "attestation": {
        "source": "chainlink-data-feeds",
        "quoteSource": "CLASSIC",
        "oraclePrice": 2048.32,
        "deviationBps": 12,
        "toleranceBps": 8000,
        "withinRange": true
      }
    }
  ],
  "skipped": [
    {
      "employeeId": "emp-002",
      "employeeName": "Bob",
      "reason": "World ID verification required"
    }
  ]
}
```

## Setup

```bash
cd cre-workflow/my-project/my-workflow
bun install
```

### Config

`config/config.staging.json` (used for local simulation):

```json
{
  "toleranceBps": 8000,
  "networkLabel": "Sepolia Testnet",
  "dispatcherAddress": "",
  "backendApiUrl": "http://localhost:3001",
  "uniswapApiKey": "your-key",
  "oracleRpc": "https://ethereum-sepolia-rpc.publicnode.com",
  "feedEthUsd": "0x694AA1769357215DE4FAC081bf1f309aDC325306",
  "feedBtcUsd": "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43"
}
```

`config/config.production.json` — same shape with mainnet RPC, mainnet feed addresses, `toleranceBps: 200`, and `backendApiUrl` pointing to your deployed backend.

### Simulate

```bash
cre workflow simulate ./my-workflow \
  --config /tmp/pf-cfg.json \
  --http-payload "$(cat test-block.json)" \
  --non-interactive \
  --trigger-index 0
```

Or trigger via the backend (which handles the symlink and subprocess automatically):

```bash
# POST to run-stream endpoint — CRE simulation runs as part of payroll flow
curl -X POST http://localhost:3001/api/payroll/:companyId/run-stream
```

### Deploy

```bash
cre workflow deploy my-workflow --target production-settings
```

## File Structure

```
my-workflow/
├── main.ts                      # Workflow entrypoint
├── types/
│   └── types.ts                 # Config, Employee, PayrollSplit, TriggerPayload types
├── config/
│   ├── config.staging.json      # Staging config (high tolerance, localhost backend)
│   └── config.production.json   # Production config (2% tolerance, deployed backend)
├── test-block.json              # Sample trigger payload for simulation
└── package.json
```

## Chainlink Data Feeds Used

| Asset   | Feed (Sepolia)                               | Feed (Mainnet)                               |
| ------- | -------------------------------------------- | -------------------------------------------- |
| ETH/USD | `0x694AA1769357215DE4FAC081bf1f309aDC325306` | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` |
| BTC/USD | `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43` | `0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c` |

## SDK APIs Used

| API                      | Purpose                                                |
| ------------------------ | ------------------------------------------------------ |
| `HTTPClient.sendRequest` | Chainlink feed reads, backend quotes, backend dispatch |
| `EVMClient.writeReport`  | evm-write: send payroll report to PayrollDispatcher    |
| `Report`                 | Wrap ABI-encoded rawReport for writeReport             |
| `bytesToBigint`          | Decode AggregatorV3 price response                     |
| `runtime.log`            | Stream attestation output to DON logs                  |

## Reference

- [Chainlink CRE Documentation](https://docs.chain.link/cre)
- [CRE TypeScript SDK](https://www.npmjs.com/package/@chainlink/cre-sdk)
