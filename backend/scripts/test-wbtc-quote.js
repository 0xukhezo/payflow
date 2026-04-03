/**
 * Standalone WBTC route tester — does NOT touch any production code.
 * Tests Uniswap Trading API quotes for WBTC on Arbitrum and Base.
 *
 * Run: node scripts/test-wbtc-quote.js
 *
 * Requires UNISWAP_API_KEY and RELAYER_PRIVATE_KEY in backend/.env
 */
import dotenv from "dotenv";
import { ethers } from "ethers";
dotenv.config();

const API_BASE = "https://trade-api.gateway.uniswap.org/v1";
const API_KEY  = process.env.UNISWAP_API_KEY || "";

const RELAYER_KEY = process.env.RELAYER_PRIVATE_KEY || "";
const wallet      = RELAYER_KEY ? new ethers.Wallet(RELAYER_KEY) : ethers.Wallet.createRandom();
const SWAPPER     = wallet.address;

const TOKENS = {
  // Arbitrum
  usdc_arb:  { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6,  chainId: 42161, symbol: "USDC@Arbitrum" },
  wbtc_arb:  { address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8,  chainId: 42161, symbol: "WBTC@Arbitrum" },
  // Base
  usdc_base: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6,  chainId: 8453,  symbol: "USDC@Base" },
  wbtc_base: { address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8,  chainId: 8453,  symbol: "WBTC@Base" },
  // Sepolia
  usdc_sep:  { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6,  chainId: 11155111, symbol: "USDC@Sepolia" },
};

const AMOUNT_USDC = 1; // $1 USDC — small test amount

function headers() {
  return {
    "Content-Type": "application/json",
    "Accept": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
  };
}

function toUnits(amount, decimals) {
  return BigInt(Math.round(amount * 10 ** decimals)).toString();
}

async function testQuote(label, tokenIn, tokenOut, routingParams) {
  const amountIn = toUnits(AMOUNT_USDC, tokenIn.decimals);
  const body = {
    tokenIn:         tokenIn.address,
    tokenOut:        tokenOut.address,
    tokenInChainId:  tokenIn.chainId,
    tokenOutChainId: tokenOut.chainId,
    type:            "EXACT_INPUT",
    amount:          amountIn,
    swapper:         SWAPPER,
    ...routingParams,
  };

  console.log(`\n${"─".repeat(60)}`);
  console.log(`TEST: ${label}`);
  console.log(`  ${tokenIn.symbol} → ${tokenOut.symbol}`);
  console.log(`  Routing params: ${JSON.stringify(routingParams)}`);

  try {
    const res  = await fetch(`${API_BASE}/quote`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
    const data = await res.json();

    if (!res.ok) {
      console.log(`  ✗ FAIL ${res.status}: ${data.errorCode} — ${data.detail}`);
      return false;
    }

    const rawQuote   = data.quote;
    const outAmount  = Number(rawQuote.output.amount) / 10 ** tokenOut.decimals;
    const routing    = data.routing || rawQuote.routing || "CLASSIC";

    console.log(`  ✓ PASS`);
    console.log(`  Routing used: ${routing}`);
    console.log(`  Output: ${outAmount.toFixed(8)} ${tokenOut.symbol.split("@")[0]}`);
    console.log(`  Rate: ${(outAmount / AMOUNT_USDC).toFixed(8)} WBTC/USDC`);
    console.log(`  Quote ID: ${rawQuote.quoteId || data.requestId}`);
    if (rawQuote.route) {
      console.log(`  Route hops: ${rawQuote.route.length}`);
    }
    return true;
  } catch (err) {
    console.log(`  ✗ ERROR: ${err.message}`);
    return false;
  }
}

async function run() {
  console.log("WBTC Route Tester — Uniswap Trading API");
  console.log(`Swapper: ${SWAPPER}`);
  console.log(`API key: ${API_KEY ? "set" : "NOT SET — rate-limited"}`);

  const results = [];

  // ── 1. Same-chain WBTC on Arbitrum ─────────────────────────────
  // V2+V3 only (current production restriction — this should FAIL or PASS?)
  results.push(["Arbitrum same-chain, protocols V2+V3 (current prod)", await testQuote(
    "Arbitrum same-chain V2+V3",
    TOKENS.usdc_arb, TOKENS.wbtc_arb,
    { protocols: ["V2", "V3"] }
  )]);

  // V2+V3+V4
  results.push(["Arbitrum same-chain, protocols V2+V3+V4", await testQuote(
    "Arbitrum same-chain V2+V3+V4",
    TOKENS.usdc_arb, TOKENS.wbtc_arb,
    { protocols: ["V2", "V3", "V4"] }
  )]);

  // BEST_PRICE (lets API decide — V2/V3/V4/UniswapX)
  results.push(["Arbitrum same-chain, BEST_PRICE", await testQuote(
    "Arbitrum same-chain BEST_PRICE",
    TOKENS.usdc_arb, TOKENS.wbtc_arb,
    { routingPreference: "BEST_PRICE" }
  )]);

  // CLASSIC only (forces on-chain V2/V3/V4, no UniswapX off-chain orders)
  results.push(["Arbitrum same-chain, CLASSIC", await testQuote(
    "Arbitrum same-chain CLASSIC",
    TOKENS.usdc_arb, TOKENS.wbtc_arb,
    { routingPreference: "CLASSIC" }
  )]);

  // ── 2. Same-chain WBTC on Base ──────────────────────────────────
  results.push(["Base same-chain, protocols V2+V3 (current prod)", await testQuote(
    "Base same-chain V2+V3",
    TOKENS.usdc_base, TOKENS.wbtc_base,
    { protocols: ["V2", "V3"] }
  )]);

  results.push(["Base same-chain, protocols V2+V3+V4", await testQuote(
    "Base same-chain V2+V3+V4",
    TOKENS.usdc_base, TOKENS.wbtc_base,
    { protocols: ["V2", "V3", "V4"] }
  )]);

  results.push(["Base same-chain, BEST_PRICE", await testQuote(
    "Base same-chain BEST_PRICE",
    TOKENS.usdc_base, TOKENS.wbtc_base,
    { routingPreference: "BEST_PRICE" }
  )]);

  results.push(["Base same-chain, CLASSIC", await testQuote(
    "Base same-chain CLASSIC",
    TOKENS.usdc_base, TOKENS.wbtc_base,
    { routingPreference: "CLASSIC" }
  )]);

  // ── 3. Cross-chain Arbitrum → Base WBTC (bridge leg) ───────────
  results.push(["Cross-chain Arbitrum→Base WBTC, BEST_PRICE", await testQuote(
    "Cross-chain Arbitrum→Base WBTC",
    TOKENS.usdc_arb, TOKENS.wbtc_base,
    { routingPreference: "BEST_PRICE" }
  )]);

  // ── Summary ─────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  console.log("SUMMARY");
  console.log("═".repeat(60));
  for (const [label, passed] of results) {
    console.log(`  ${passed ? "✓" : "✗"} ${label}`);
  }
  console.log("");
  console.log("If BEST_PRICE or V2+V3+V4 passes but V2+V3 fails → use those params for WBTC.");
  console.log("If CLASSIC passes → safe to add WBTC with routingPreference: \"CLASSIC\" for same-chain.");
  console.log("IMPORTANT: passing quote ≠ swap will succeed. Check routing field in output.");
  console.log("  If routing = 'DUTCH_V2' or 'DUTCH_LIMIT' → UniswapX (off-chain order, no calldata).");
  console.log("  If routing = 'CLASSIC' → on-chain V2/V3/V4 calldata → safe to executeSwap().");
}

run().catch(console.error);
