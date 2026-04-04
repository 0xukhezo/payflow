# PayFlow — Frontend

Next.js 16 app with two portals: a company dashboard for running payroll and an employee portal for managing payout splits.

## Pages

| Route               | Description                                                                    |
| ------------------- | ------------------------------------------------------------------------------ |
| `/`                 | Landing page with role selection (company / employee)                          |
| `/company`          | Company dashboard — treasury balance, employee list, payroll execution         |
| `/employee`         | Employee portal — payout splits, payment history                               |
| `/verify/[shiftId]` | Public attestation viewer — Chainlink oracle rate verification for any payment |

---

## Key Features

### Company Dashboard (`/company`)

- **Wallet connection** via Reown AppKit (`useAppKitAccount`, `useAppKitProvider`)
- **SIWX** — Sign In With X prompt on wallet connect; session stored via `DefaultSIWX`
- **USDC Approve** — calls `USDC.approve(relayerAddress, MaxUint256)` directly from the connected wallet
- **Run Payroll** — calls `POST /api/payroll/:companyId/run-stream`, streams live progress steps via SSE
- **Progress modal** — shows each step (Chainlink rate verification, treasury pull, swap, bridge, transfer) with status icons, tx hash links, and per-employee sections
- **Network mode toggle** — switches between testnet (high tolerance) and mainnet (2% tolerance)

### Employee Portal (`/employee`)

- **Join requests** — search for a company by name and submit a join request; the company owner reviews and accepts it from their dashboard
- **Payout splits** — configure multiple splits (token + chain + percentage). Splits must sum to 100%.
- **SOL support** — selecting SOL auto-sets chain to Solana and shows a Solana address input
- **Payment history** — salary history table sourced from Supabase with per-payment oracle attestation badges

### Verify Page (`/verify/[shiftId]`)

Public page. Fetches shift data from `GET /api/payroll/shift/:shiftId`, displays:

- Swap provider (Uniswap / SideShift)
- Deviation from Chainlink oracle price in bps and %
- PASS / FAIL result
- Links to swap tx and transfer tx on the relevant explorer

---

## Wallet Connection (Reown AppKit + SIWX)

Reown AppKit is used throughout the app for wallet connection, transaction signing, and authentication.

**`providers.tsx`**

```tsx
import { DefaultSIWX } from "@reown/appkit-siwx";

createAppKit({
  adapters: [new EthersAdapter(), solanaAdapter],
  networks: [sepolia, solana],
  projectId,
  siwx: new DefaultSIWX(),  // prompts wallet sign after connect
});
```

**`/company`** — wallet auth + signing

```tsx
const { address, isConnected } = useAppKitAccount();
const { walletProvider } = useAppKitProvider("eip155");
// Use walletProvider with BrowserProvider + viem for tx signing
```

**`useUserRole`** hook — determines whether the connected wallet belongs to a company or employee by querying the backend.

---

## Component Library

| Component          | Description                                                  |
| ------------------ | ------------------------------------------------------------ |
| `WalletCard`       | Shows wallet address, network, treasury balance              |
| `PayrollTable`     | Employee list with salary amounts                            |
| `SalaryHistory`    | Payment history table with attestation badges and tx links   |
| `AssetSelector`    | Dropdown for selecting preferred token (including SOL)       |
| `NetworkSelector`  | Dropdown for selecting the settlement network                |
| `AttestationBadge` | Shows Chainlink oracle deviation % and PASS/FAIL             |
| `AppNav`           | Navigation bar with network mode toggle                      |
| `HomeNav`          | Landing page navigation                                      |
| `Toast`            | Toast notification system                                    |
| `AuthGate`         | Wraps pages requiring wallet connection                      |

---

## Environment Variables

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_REOWN_PROJECT_ID=    # from https://cloud.reown.com
NEXT_PUBLIC_API_URL=http://localhost:3001   # backend URL
```

---

## Development

```bash
npm install
npm run dev     # http://localhost:3000
```

```bash
npm run build   # production build
npm start       # serve production build
```

---

## Deployment (Vercel)

1. Push to GitHub
2. Import repo in Vercel
3. Set environment variables:
   - `NEXT_PUBLIC_REOWN_PROJECT_ID`
   - `NEXT_PUBLIC_API_URL` (your deployed backend URL)
4. Deploy

The backend must be deployed separately (Railway, Render, or similar) before the frontend can function.

---

## Network Support

| Network          | Chain ID | Used For                               |
| ---------------- | -------- | -------------------------------------- |
| Arbitrum         | 42161    | Company treasury, employee EVM payouts |
| Base             | 8453     | Employee EVM payouts                   |
| Ethereum Sepolia | 11155111 | Testnet                                |
| Solana           | —        | Employee SOL payouts (via SideShift)   |

---

## Tech Stack

| Package                       | Version | Purpose                               |
| ----------------------------- | ------- | ------------------------------------- |
| `next`                        | 16.2.0  | Framework                             |
| `react`                       | 19.2.4  | UI                                    |
| `@reown/appkit`               | latest  | Wallet connection + signing           |
| `@reown/appkit-siwx`          | latest  | Sign In With X authentication         |
| `@reown/appkit-adapter-ethers`| latest  | EVM wallet connectors                 |
| `viem`                        | latest  | Typed contract calls for USDC approve |
| `ethers`                      | ^6.16   | BrowserProvider, tx signing           |
| `tailwindcss`                 | ^4      | Styling                               |
| `lucide-react`                | ^0.577  | Icons                                 |
