# PayFlow — Contracts

Solidity contract for PayFlow. `PayrollDispatcher` is the on-chain execution target of the Chainlink CRE workflow, deployable on Arbitrum, Base, or Sepolia.

## Contract

### PayrollDispatcher.sol

Implements the Chainlink CRE `IReceiver` interface. After the DON reaches consensus on the payroll manifest, the CRE workflow calls `EVMClient.writeReport()` targeting this contract via the Chainlink CRE KeystoneForwarder.

**How it works:**

1. CRE workflow ABI-encodes `(bytes32 payrollId, address treasury, address[] recipients, uint256[] amounts)` and sends it via `writeReport`.
2. `onReport(bytes metadata, bytes rawReport)` is called by the Chainlink CRE KeystoneForwarder.
3. The contract checks the treasury has approved sufficient USDC, pulls the total in one `transferFrom`, then distributes to each recipient.
4. Emits `PayrollDispatched` (payroll-level) and `EmployeePaid` (per recipient).

**Key functions:**

```solidity
function onReport(bytes calldata metadata, bytes calldata rawReport) external onlyForwarder

function approvedAllowance(address treasury) external view returns (uint256)

function setForwarder(address _forwarder) external onlyOwner
```

**Report encoding (`rawReport`):**

```solidity
abi.encode(bytes32 payrollId, address treasury, address[] recipients, uint256[] amounts)
// amounts are USDC with 6 decimal places
```

---

## USDC Addresses

| Network | Chain ID | USDC |
|---------|----------|------|
| Sepolia | 11155111 | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Arbitrum | 42161 | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| Base | 8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

---

## Deployed Addresses

Populated automatically by the deploy script into `deployments.json`.

| Network | Contract | Address |
|---------|----------|---------|
| Sepolia | PayrollDispatcher | _deploy via `scripts/deploy-dispatcher.js`_ |
| Arbitrum | PayrollDispatcher | _deploy via `scripts/deploy-dispatcher.js`_ |
| Base | PayrollDispatcher | _deploy via `scripts/deploy-dispatcher.js`_ |

---

## Setup & Deployment

### Prerequisites

- Node.js 18+
- Funded wallet on the target network

### Install

```bash
npm install
```

### Compile

```bash
npx hardhat compile
```

### Environment Variables

Create `contracts/.env`:

```env
PRIVATE_KEY=              # deployer private key
CRE_FORWARDER_ADDRESS=    # Chainlink CRE KeystoneForwarder on target network
                          # leave unset to use placeholder, call setForwarder() later

# RPC overrides (optional — defaults are set in hardhat.config.js)
SEPOLIA_RPC_URL=
ARBITRUM_RPC_URL=
BASE_RPC_URL=
```

### Deploy

```bash
# Sepolia (testnet)
npx hardhat run scripts/deploy-dispatcher.js --network sepolia

# Arbitrum (mainnet)
npx hardhat run scripts/deploy-dispatcher.js --network arbitrum

# Base (mainnet)
npx hardhat run scripts/deploy-dispatcher.js --network base
```

The deploy script automatically:
- Writes the deployed address to `deployments.json`
- Updates `dispatcherAddress` in `cre-workflow/config/config.staging.json`
- Updates `PAYROLL_DISPATCHER_ADDRESS` in `backend/.env`

### Verify on Etherscan (optional)

```bash
npx hardhat verify --network sepolia   <address> <USDC_ADDRESS> <CRE_FORWARDER_ADDRESS>
npx hardhat verify --network arbitrum  <address> <USDC_ADDRESS> <CRE_FORWARDER_ADDRESS>
npx hardhat verify --network base      <address> <USDC_ADDRESS> <CRE_FORWARDER_ADDRESS>
```

---

## Post-Deployment Checklist

1. **Approve USDC** — each company treasury must approve `PayrollDispatcher` to spend their USDC:
   ```js
   usdc.approve(dispatcherAddress, totalPayrollAmount);
   ```
2. **Set forwarder** — if deployed without `CRE_FORWARDER_ADDRESS`, call `setForwarder()` with the real address:
   ```js
   await dispatcher.setForwarder(creForwarderAddress);
   ```
3. **Update production config** — set `dispatcherAddress` in `cre-workflow/config/config.production.json`.

---

## Contract Interaction Examples

**Check treasury allowance before payroll:**

```js
const dispatcher = new ethers.Contract(DISPATCHER_ADDRESS, DISPATCHER_ABI, provider);
const allowance = await dispatcher.approvedAllowance(treasuryAddress);
```

**Update the CRE forwarder address:**

```js
await dispatcher.setForwarder(newForwarderAddress);
```

---

## Security Notes

- `onReport` is restricted to the Chainlink CRE `KeystoneForwarder` via `onlyForwarder` — no direct external calls possible.
- Pre-flight allowance check ensures the treasury has approved sufficient USDC before any transfer occurs.
- All transfers use the standard ERC20 interface; reverts propagate cleanly on failure.
