# Uniswap Trading API — Developer Feedback

**Project:** PayFlow — cross-chain crypto payroll
**API used:** `https://trade-api.gateway.uniswap.org/v1`
**Context:** Server-side relayer calling the Trading API to swap and bridge USDC/WETH/WBTC on behalf of employees across Arbitrum and Base mainnet.

---

## Issue 1 — Intermittent `APIResponseValidationError` on valid V4 routes (Base mainnet, WBTC)

**Description:**
`POST /v1/quote` with `protocols: ["V2","V3","V4"]` for WBTC on Base returns `APIResponseValidationError` ~30% of the time with no additional context. The exact same request body succeeds on retry. There is no way to distinguish this from a real validation error without retrying blindly.

**Reproduce:**

```bash
# Run this 5–10 times — roughly 1 in 3 calls returns APIResponseValidationError
# Route: USDC → WBTC on Base mainnet (chain 8453)
curl -X POST https://trade-api.gateway.uniswap.org/v1/quote \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{
    "type": "EXACT_INPUT",
    "amount": "1000000",
    "tokenInChainId": 8453,
    "tokenOutChainId": 8453,
    "tokenIn": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "tokenOut": "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
    "swapper": "0xYOUR_RELAYER_ADDRESS",
    "routingPreference": "BEST_PRICE",
    "protocols": ["V2", "V3", "V4"]
  }'
```

**Tokens used:**

- `tokenIn` — USDC on Base (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- `tokenOut` — WBTC on Base (`0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f`)

**Expected:** Valid quote every time — this is a high-liquidity pair on a supported chain
**Actual:** ~30% of calls return `APIResponseValidationError`; identical retry succeeds
**Suggested fix:** Stable error code distinguishing transient vs. real validation failures, or a `Retry-After` hint in the response

---

## Issue 2 — `/v1/swap` returns two incompatible response shapes depending on route type

**Description:**
For same-chain swaps, the response sometimes includes a `signature` field (pre-signed by the API, ready to broadcast) and other times returns `permitData` requiring client-side `signTypedData`. There is no documented field in the response that reliably signals which format will be returned before you parse the body.

**Reproduce:**

```bash
# Step 1: get a quote
# Route: USDC → WETH on Arbitrum (chain 42161)
QUOTE=$(curl -s -X POST https://trade-api.gateway.uniswap.org/v1/quote \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{
    "type": "EXACT_INPUT",
    "amount": "5000000",
    "tokenInChainId": 42161,
    "tokenOutChainId": 42161,
    "tokenIn": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "tokenOut": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    "swapper": "0xYOUR_RELAYER_ADDRESS",
    "routingPreference": "BEST_PRICE"
  }')

# Step 2: call /swap with a Permit2 signature
# Response shape alternates between Shape A and Shape B across calls
curl -X POST https://trade-api.gateway.uniswap.org/v1/swap \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d "{
    \"quote\": $QUOTE,
    \"walletAddress\": \"0xYOUR_RELAYER_ADDRESS\",
    \"signature\": \"0xPRE_SIGNED_PERMIT2_SIG\"
  }"
```

**Tokens used:**

- `tokenIn` — USDC on Arbitrum (`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`)
- `tokenOut` — WETH on Arbitrum (`0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`)

**Observed behavior:**

- Shape A: `{ "swap": { "to", "data", "value" }, "signature": "0x..." }` — ready to broadcast
- Shape B: `{ "swap": { "to", "data", "value" }, "permitData": { "domain", "types", "values" } }` — must call `signTypedData` client-side and re-submit

The switch between shapes appears to correlate with UniswapX availability for the pair but is not documented.

**Suggested fix:** Add a top-level field like `"signingRequired": true/false` or `"responseType": "PRESIGNED" | "PERMIT_DATA"` so callers can branch deterministically.

---

## Issue 3 — BRIDGE routes return raw calldata instead of `encodedOrder` — undocumented

**Description:**
For cross-chain quotes resolved via bridge routing, `/v1/swap` returns `{ swap: { to, data, value } }` — raw calldata to send directly to the bridge contract. For UniswapX routes it returns `{ encodedOrder, orderInfo }`. There is no field in the `/v1/quote` response that indicates which shape `/v1/swap` will produce, forcing detection at execution time.

**Reproduce:**

```bash
# Route: USDC Arbitrum → USDC Base (cross-chain, always resolves as BRIDGE)
curl -X POST https://trade-api.gateway.uniswap.org/v1/quote \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{
    "type": "EXACT_INPUT",
    "amount": "10000000",
    "tokenInChainId": 42161,
    "tokenOutChainId": 8453,
    "tokenIn": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "tokenOut": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "swapper": "0xYOUR_RELAYER_ADDRESS",
    "routingPreference": "BEST_PRICE"
  }'
```

**Tokens used:**

- `tokenIn` — USDC on Arbitrum (`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`)
- `tokenOut` — USDC on Base (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)

**Observed:** Quote succeeds. Calling `/v1/swap` with this quote returns `swap.to` + `swap.data` (raw calldata). No `encodedOrder` field.
**Expected:** A `routeType` or `executionStyle` field in the `/v1/quote` response indicating the execution shape before calling `/v1/swap`
**Suggested fix:** Add `"executionStyle": "UNISWAPX" | "CALLDATA"` to the quote response so callers can prepare the correct execution path upfront.

---

## Issue 4 — Permit2 approval targets the wrong contract for BRIDGE routes — undocumented

**Description:**
For UniswapX routes, token approval must go to Permit2 (`0x000000000022D473030F116dDEE9F6B43aC78BA3`). For BRIDGE routes, approval must go directly to the bridge contract address returned in `swap.to`. This distinction is not documented and must be inferred from the route type at runtime. Approving Permit2 on a BRIDGE route causes the transaction to revert.

**Reproduce:**

```bash
# Use the same cross-chain quote as Issue 3 (USDC Arbitrum → USDC Base)
# Then call /v1/swap and inspect the response:
#
#   UniswapX route:  approve ERC20 to Permit2 (0x000000000022D473030F116dDEE9F6B43aC78BA3)
#                    then broadcast encodedOrder
#
#   BRIDGE route:    approve ERC20 directly to swap.to (the bridge contract)
#                    then send swap.data to swap.to
#
# Using approve(Permit2, amount) on a BRIDGE route → tx reverts on Arbitrum

# Concrete bridge contract returned in swap.to for this route (observed):
# 0x3a23F943181408EAC424116Af7b7790c94Cb97a5  (Across Protocol SpokePool on Arbitrum)
```

**Code that hit this:**

```js
// Had to detect route type at runtime and branch approval target
const approvalTarget = swapData.encodedOrder
  ? "0x000000000022D473030F116dDEE9F6B43aC78BA3" // Permit2 — UniswapX
  : swapData.swap.to; // bridge contract — BRIDGE route
```

**Suggested fix:** Add an explicit `"approvalTarget": "0x..."` field to the `/v1/swap` response so the correct spender address is always unambiguous regardless of route type.

---

## Issue 5 — Requesting unsupported protocols for a pair causes a valid-looking quote that reverts on execution

**Description:**
When requesting `protocols: ["V2"]` for a token pair that has no V2 pools on that chain, the API returns a valid-looking quote. The transaction reverts on-chain because no V2 pool exists for the route. There is no API-level error and no warning in the response indicating that the requested protocol was unavailable.

**Reproduce:**

```bash
# Route: USDC → WBTC on Base mainnet (chain 8453), V2 only
# USDC/WBTC has no meaningful V2 pool on Base — only V3/V4 liquidity exists
curl -X POST https://trade-api.gateway.uniswap.org/v1/quote \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{
    "type": "EXACT_INPUT",
    "amount": "5000000",
    "tokenInChainId": 8453,
    "tokenOutChainId": 8453,
    "tokenIn": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "tokenOut": "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
    "swapper": "0xYOUR_RELAYER_ADDRESS",
    "routingPreference": "BEST_PRICE",
    "protocols": ["V2"]
  }'
```

**Tokens used:**

- `tokenIn` — USDC on Base (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- `tokenOut` — WBTC on Base (`0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f`)

**Observed:** Quote returns successfully with a price. Transaction reverts on-chain.
**Expected:** 400 error ("No V2 pool available for this pair") or automatic fallback with a `"protocolsUsed": ["V3"]` field in the response
**Suggested fix:** Either reject the request when the specified protocol has no liquidity for the pair, or include a `"protocolsUsed"` field in the response reflecting what was actually routed — so callers can detect a protocol mismatch before execution.

---

## Issue 7 — Cross-chain routes return 404 "No quotes available" below an undocumented minimum trade size

**Description:**
`POST /v1/quote` with `routingPreference: "BEST_PRICE"` for cross-chain routes returns `404 ResourceNotFound` / `"No quotes available"` when the input amount is below an undocumented threshold. There is no documented minimum trade size for cross-chain (bridge) routing, and no field in the error response indicating that the failure is amount-related rather than a missing route or unsupported pair.

**Reproduce:**

```bash
# Route: USDC Arbitrum → WETH Base (cross-chain, small amount)
# This pair has liquidity and is supported — but fails below ~$2–5 USDC
curl -X POST https://trade-api.gateway.uniswap.org/v1/quote \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{
    "type": "EXACT_INPUT",
    "amount": "480000",
    "tokenInChainId": 42161,
    "tokenOutChainId": 8453,
    "tokenIn": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "tokenOut": "0x4200000000000000000000000000000000000006",
    "swapper": "0xYOUR_RELAYER_ADDRESS",
    "routingPreference": "BEST_PRICE"
  }'
```

```bash
# Also fails for same-asset cross-chain bridge (USDC Arbitrum → USDC Base)
curl -X POST https://trade-api.gateway.uniswap.org/v1/quote \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{
    "type": "EXACT_INPUT",
    "amount": "400000",
    "tokenInChainId": 42161,
    "tokenOutChainId": 8453,
    "tokenIn": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "tokenOut": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "swapper": "0xYOUR_RELAYER_ADDRESS",
    "routingPreference": "BEST_PRICE"
  }'
```

**Tokens used:**

- `tokenIn` — USDC on Arbitrum (`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`)
- `tokenOut` — WETH on Base (`0x4200000000000000000000000000000000000006`)
- `tokenOut` — USDC on Base (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)

**Observed:** `404 { "errorCode": "ResourceNotFound", "detail": "No quotes available" }` — identical to the response returned when a route genuinely doesn't exist (unsupported pair or chain). Increasing the amount above ~$5 USDC resolves the error immediately with no other changes.

**Expected:** A distinct error code (e.g. `"AMOUNT_TOO_SMALL"`) or a `"minAmount"` field in the error body indicating the minimum accepted input for cross-chain routing.

**Impact:** In a payroll system where an employee's salary is split across multiple chains, small per-split amounts routinely fall below the threshold. The generic 404 is indistinguishable from a "pair not supported" error, causing callers to waste time investigating route configuration rather than diagnosing a size constraint.

**Suggested fix:** One of:
- Return a distinct `errorCode` such as `"AMOUNT_BELOW_MINIMUM"` when the input is too small for bridge routing
- Include a `"minAmount"` field in the 404 response body
- Document the minimum cross-chain trade size per chain pair in the API reference

---

## Issue 6 — Quote TTL (30s) too short for server-side relayer execution flow

**Description:**
The quote from `/v1/quote` expires ~30 seconds after issuance. A server-side relayer must: fetch the quote → pull funds from treasury → submit ERC20 approval tx → wait for confirmation → call `/v1/swap`. On mainnet with any mempool congestion, this regularly exceeds the 30s window. The API returns an expiry error at `/v1/swap` time, requiring the entire flow to restart with a fresh quote (which may have moved in price).

**Reproduce:**

```bash
# Step 1: fetch a quote for USDC → WETH on Arbitrum
curl -X POST https://trade-api.gateway.uniswap.org/v1/quote \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{
    "type": "EXACT_INPUT",
    "amount": "20000000",
    "tokenInChainId": 42161,
    "tokenOutChainId": 42161,
    "tokenIn": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "tokenOut": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    "swapper": "0xYOUR_RELAYER_ADDRESS",
    "routingPreference": "BEST_PRICE"
  }'

# Step 2: simulate a real relayer flow with the required on-chain steps, then call /swap
# The approval tx alone takes 15–25s to confirm on Arbitrum under moderate load.
# By the time /v1/swap is called, the quote is expired.
```

**Observed execution timeline (mainnet, moderate activity):**

```
t=0s    POST /v1/quote                        → quote issued (TTL ~30s)
t=2s    treasury USDC transfer tx submitted
t=9s    treasury transfer confirmed           → funds in relayer
t=10s   ERC20.approve(Permit2) submitted
t=28s   approval confirmed                    → approved
t=29s   POST /v1/swap                         → ❌ quote expired
```

**Tokens used:**

- `tokenIn` — USDC on Arbitrum (`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`)
- `tokenOut` — WETH on Arbitrum (`0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`)

**Suggested fix:** One of:

- Expose a `POST /v1/quote/refresh` endpoint that extends an existing quote's TTL without repricing
- Increase TTL to 60–90s for server-authenticated (API key) callers
- Add `"quotedAt"` and `"expiresAt"` timestamps to the quote response so callers know exactly how much time remains before starting execution
