/**
 * Comprehensive route tester — all token pairs across all supported chains.
 * Tests every realistic production route: same-chain and cross-chain.
 * Does NOT touch any production code. Read-only (quotes only, no swaps).
 *
 * Run: node scripts/test-all-routes.js
 */
import dotenv from "dotenv";
import { ethers } from "ethers";
dotenv.config();

const API_BASE = "https://trade-api.gateway.uniswap.org/v1";
const API_KEY  = process.env.UNISWAP_API_KEY || "";
const RELAYER  = process.env.RELAYER_PRIVATE_KEY
  ? new ethers.Wallet(process.env.RELAYER_PRIVATE_KEY).address
  : ethers.Wallet.createRandom().address;

// ── Token registry ──────────────────────────────────────────────────────────
const TOKENS = {
  // Sepolia
  "USDC@Sepolia": { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6,  chain: 11155111 },
  "USDT@Sepolia": { address: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0", decimals: 6,  chain: 11155111 },
  "DAI@Sepolia":  { address: "0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357", decimals: 18, chain: 11155111 },
  "WETH@Sepolia": { address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", decimals: 18, chain: 11155111 },

  // Arbitrum
  "USDC@Arbitrum": { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6,  chain: 42161 },
  "USDT@Arbitrum": { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6,  chain: 42161 },
  "DAI@Arbitrum":  { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18, chain: 42161 },
  "WETH@Arbitrum": { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18, chain: 42161 },

  // Base
  "USDC@Base": { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6,  chain: 8453 },
  "USDT@Base": { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6,  chain: 8453 },
  "DAI@Base":  { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18, chain: 8453 },
  "WETH@Base": { address: "0x4200000000000000000000000000000000000006", decimals: 18, chain: 8453 },
};

// ── Routes to test ──────────────────────────────────────────────────────────
// All amounts in terms of the INPUT token (small amounts for testing)
const AMOUNT_USDC = 1;   // $1
const AMOUNT_WETH = 0.0005; // ~$1 worth
const AMOUNT_DAI  = 1;   // $1
const AMOUNT_USDT = 1;   // $1

function inputAmount(symbol) {
  if (symbol.startsWith("WETH")) return AMOUNT_WETH;
  if (symbol.startsWith("DAI"))  return AMOUNT_DAI;
  if (symbol.startsWith("USDT")) return AMOUNT_USDT;
  return AMOUNT_USDC;
}

// Generate all same-chain pairs for a given chain label
function sameChainPairs(chainLabel) {
  const keys = Object.keys(TOKENS).filter(k => k.endsWith(`@${chainLabel}`));
  const pairs = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = 0; j < keys.length; j++) {
      if (i !== j) pairs.push([keys[i], keys[j]]);
    }
  }
  return pairs;
}

// Cross-chain: company always deposits USDC on Arbitrum → any token on Base
const CROSS_CHAIN_PAIRS = [
  ["USDC@Arbitrum", "USDC@Base"],
  ["USDC@Arbitrum", "USDT@Base"],
  ["USDC@Arbitrum", "DAI@Base"],
  ["USDC@Arbitrum", "WETH@Base"],
];

// ── Quote function ───────────────────────────────────────────────────────────
async function quote(inKey, outKey, routingParams) {
  const tokenIn  = TOKENS[inKey];
  const tokenOut = TOKENS[outKey];
  const amount   = inputAmount(inKey);
  const amountIn = BigInt(Math.round(amount * 10 ** tokenIn.decimals)).toString();

  const body = {
    tokenIn:         tokenIn.address,
    tokenOut:        tokenOut.address,
    tokenInChainId:  tokenIn.chain,
    tokenOutChainId: tokenOut.chain,
    type:            "EXACT_INPUT",
    amount:          amountIn,
    swapper:         RELAYER,
    ...routingParams,
  };

  const res  = await fetch(`${API_BASE}/quote`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json", ...(API_KEY ? { "x-api-key": API_KEY } : {}) },
    body:    JSON.stringify(body),
  });
  const data = await res.json();

  if (!res.ok) return { ok: false, error: `${data.errorCode}: ${data.detail}` };

  const rawQuote  = data.quote;
  const outAmount = Number(rawQuote.output.amount) / 10 ** tokenOut.decimals;
  const routing   = data.routing || rawQuote.routing || "CLASSIC";

  // Flag if routing is UniswapX (off-chain order → no calldata → executeSwap will fail)
  const isUniswapX = ["DUTCH_V2", "DUTCH_LIMIT", "DUTCH_V1", "PRIORITY"].includes(routing);

  return { ok: true, outAmount, routing, isUniswapX };
}

// ── Test runner ───────────────────────────────────────────────────────────────
const PASS = "✓";
const FAIL = "✗";
const WARN = "⚠";

async function testRoute(inKey, outKey) {
  const isCrossChain = TOKENS[inKey].chain !== TOKENS[outKey].chain;

  // Production params currently used:
  const prodParams = isCrossChain
    ? { routingPreference: "BEST_PRICE" }
    : { protocols: ["V2", "V3"] };

  // Fallback params with V4 added (for Base):
  const v4Params = isCrossChain
    ? { routingPreference: "BEST_PRICE" }
    : { protocols: ["V2", "V3", "V4"] };

  const prod = await quote(inKey, outKey, prodParams);
  // Only test V4 fallback for same-chain if prod failed
  const v4   = (!prod.ok || prod.isUniswapX) && !isCrossChain
    ? await quote(inKey, outKey, v4Params)
    : null;

  const effective = v4?.ok ? v4 : prod;
  const usedV4    = v4?.ok && !prod.ok;

  let icon, status, detail;

  if (!effective.ok) {
    icon   = FAIL;
    status = "NO ROUTE";
    detail = effective.error;
  } else if (effective.isUniswapX) {
    icon   = WARN;
    status = "UNISWAP_X — off-chain order, no calldata";
    detail = `routing=${effective.routing}`;
  } else {
    icon   = PASS;
    status = `${effective.routing}${usedV4 ? " (needs V4)" : ""}`;
    detail = `out=${effective.outAmount.toFixed(8)} ${outKey.split("@")[0]}`;
  }

  return { inKey, outKey, icon, status, detail, usedV4, isCrossChain, ok: effective.ok && !effective.isUniswapX };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log("═".repeat(72));
  console.log("  PayFlow — Full Route Coverage Test");
  console.log(`  Swapper: ${RELAYER}`);
  console.log(`  API key: ${API_KEY ? "set" : "NOT SET (rate-limited)"}`);
  console.log("═".repeat(72));

  const allPairs = [
    ...sameChainPairs("Sepolia").map(p => ({ ...p, group: "Sepolia (testnet)" })),
    ...sameChainPairs("Arbitrum").map(p => ({ ...p, group: "Arbitrum (mainnet)" })),
    ...sameChainPairs("Base").map(p => ({ ...p, group: "Base (mainnet)" })),
    ...CROSS_CHAIN_PAIRS.map(p => ({ ...p, group: "Cross-chain Arbitrum → Base" })),
  ];

  const results = [];
  let currentGroup = "";

  for (const { 0: inKey, 1: outKey, group } of allPairs) {
    if (group !== currentGroup) {
      currentGroup = group;
      console.log(`\n── ${group} ${"─".repeat(55 - group.length)}`);
    }

    process.stdout.write(`  ${inKey.padEnd(18)} → ${outKey.padEnd(18)} … `);
    const r = await testRoute(inKey, outKey);
    results.push(r);

    const line = `${r.icon} ${r.status}`;
    console.log(r.icon === PASS ? line : `${line}\n       ${r.detail}`);

    // Small delay to avoid rate limiting
    await new Promise(res => setTimeout(res, 200));
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const passed    = results.filter(r => r.ok);
  const failed    = results.filter(r => !r.ok);
  const needsV4   = results.filter(r => r.usedV4);

  console.log(`\n${"═".repeat(72)}`);
  console.log(`  RESULTS: ${passed.length} pass  |  ${failed.length} fail  |  ${needsV4.length} need V4 added`);
  console.log("═".repeat(72));

  if (needsV4.length > 0) {
    console.log("\n  Routes that need [\"V2\",\"V3\",\"V4\"] instead of [\"V2\",\"V3\"]:");
    for (const r of needsV4) console.log(`    • ${r.inKey} → ${r.outKey}`);
  }

  if (failed.length > 0) {
    console.log("\n  Failed routes (no liquidity or unsupported):");
    for (const r of failed) console.log(`    • ${r.inKey} → ${r.outKey}  (${r.detail})`);
  }

  console.log("");
}

run().catch(console.error);
