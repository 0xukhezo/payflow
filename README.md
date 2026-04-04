# PayFlow

Crypto payroll infrastructure. Companies fund a single USDC treasury; every employee receives the exact asset they chose — ETH, WBTC, SOL, or any supported token — on any supported chain. Every swap rate is verified by the Chainlink DON against live Chainlink Data Feed prices before any funds move.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, Tailwind CSS |
| Backend | Node.js, Express |
| Database | Supabase (Postgres) |
| Wallet / Auth | Reown AppKit (EVM + Solana) + SIWX |
| Swaps | Uniswap Trading API v4 |
| Cross-chain | SideShift API v2 (EVM → Solana) |
| Rate verification | Chainlink CRE + Chainlink Data Feeds |

## How it works

1. **Company funds treasury** — deposits USDC (or another asset) into their wallet on any supported chain (Arbitrum, Base, Sepolia).
2. **Company runs payroll** — clicks "Run via Chainlink CRE" in the dashboard. This calls `requestPayroll()` on the `PayrollTrigger` contract on Sepolia, emitting an on-chain event.
3. **CRE verifies rates** — the Chainlink DON (or local simulation) fetches Uniswap quotes and checks each rate against Chainlink Data Feed prices. Payments where the swap rate deviates beyond tolerance are blocked before any funds move.
4. **Payroll executes** — the relayer pulls USDC from the treasury and routes each payment:
   - Same chain, same asset → ERC20 transfer
   - Same chain, different asset → Uniswap swap
   - Cross-chain EVM → Uniswap bridge
   - Cross-chain two-hop (different asset) → bridge then swap
   - EVM → Solana → SideShift order

## Supported networks

| Network | Chain ID | Role |
|---|---|---|
| Arbitrum | 42161 | Treasury (mainnet) |
| Base | 8453 | Settlement (mainnet) |
| Sepolia | 11155111 | Treasury + settlement (testnet) |
| Solana | — | SOL settlement via SideShift |

## Project structure

```
payflow/
├── frontend/          # Next.js app
│   └── app/
│       ├── page.tsx         # Landing page
│       ├── company/page.tsx # Company dashboard
│       └── employee/page.tsx# Employee portal
├── backend/           # Express API
│   └── src/
│       ├── routes/          # API route handlers
│       └── services/        # Business logic
└── CRE_FEEDBACK.md    # Chainlink CRE developer feedback
```

## Quick start

```bash
# Backend
cd backend
cp .env.example .env   # fill in keys
npm install
npm run dev            # port 3001

# Frontend
cd frontend
cp .env.example .env.local
npm install
npm run dev            # port 3000
```
