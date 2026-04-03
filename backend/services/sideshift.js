/**
 * SideShift.ai API service
 * Used for EVM → Solana cross-chain payments.
 * SideShift accepts a deposit on EVM (e.g. USDC on Arbitrum) and delivers
 * the settled asset (e.g. SOL) to a Solana address.
 *
 * Docs: https://docs.sideshift.ai/api
 */

const BASE_URL = "https://sideshift.ai/api/v2";

// SideShift coin + network identifiers
// depositCoin / settleCoin   → coin symbol as SideShift knows it
// depositNetwork / settleNetwork → network tag SideShift uses

// Mapping from our internal (asset, chainId) → SideShift identifiers
const SIDESHIFT_COINS = {
  usdc: {
    42161: { coin: "usdc", network: "arbitrum" },
    8453:  { coin: "usdc", network: "base" },
    11155111: { coin: "usdc", network: "eth" }, // testnet — use ETH network
  },
  usdt: {
    42161: { coin: "usdt", network: "arbitrum" },
    8453:  { coin: "usdt", network: "base" },
  },
  weth: {
    42161: { coin: "eth",  network: "arbitrum" },
    8453:  { coin: "eth",  network: "base" },
  },
  eth: {
    42161: { coin: "eth",  network: "arbitrum" },
    8453:  { coin: "eth",  network: "base" },
  },
};

// Solana settle target (canonical chain-id lives in config/networks.js)
const SIDESHIFT_SOLANA = { coin: "sol", network: "solana" };

function ssId(asset, chainId) {
  const map = SIDESHIFT_COINS[asset.toLowerCase()];
  if (!map || !map[chainId]) {
    throw new Error(`SideShift: unsupported deposit asset ${asset} on chain ${chainId}`);
  }
  return map[chainId];
}

async function apiFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-sideshift-secret": process.env.SIDESHIFT_SECRET || "",
      },
      ...options,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: { message: text } }; }

  if (!res.ok) {
    const msg = data?.error?.message || data?.error || res.statusText;
    throw new Error(`SideShift API error (${res.status}): ${msg}`);
  }
  return data;
}

/**
 * Get a fixed-rate quote from SideShift.
 * @param {string} depositAsset  - internal asset key, e.g. "usdc"
 * @param {number} depositChainId - EVM chain id, e.g. 42161
 * @param {number} depositAmount  - amount in deposit asset
 * @param {string} settleAddress  - Solana wallet address to receive SOL
 * @returns {Object} normalized quote with quoteId, depositAmount, settleAmount, rate, expiresAt
 */
export async function getQuote(depositAsset, depositChainId, depositAmount, settleAddress) {
  const dep = ssId(depositAsset, depositChainId);
  const set = SIDESHIFT_SOLANA;

  const body = {
    depositCoin:    dep.coin,
    depositNetwork: dep.network,
    settleCoin:     set.coin,
    settleNetwork:  set.network,
    depositAmount:  String(depositAmount),
    settleAddress,
    type: "fixed",
  };

  const data = await apiFetch("/quotes", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return {
    quoteId:       data.id,
    depositCoin:   dep.coin,
    depositNetwork: dep.network,
    settleCoin:    set.coin,
    settleNetwork: set.network,
    depositAmount: Number(data.depositAmount),
    settleAmount:  Number(data.settleAmount),
    rate:          Number(data.rate),
    expiresAt:     data.expiresAt,
    // unified fields used by payroll service
    id:            data.id,
    isCrossChain:  true,
    isSideShift:   true,
    _raw:          data,
  };
}

/**
 * Create a fixed order from a quote.
 * Returns the EVM deposit address that the relayer must send funds to.
 *
 * @param {Object} quote         - result of getQuote()
 * @param {string} settleAddress - Solana wallet address (must match quote)
 * @returns {Object} order with orderId, depositAddress, expiresAt
 */
export async function createOrder(quote, settleAddress) {
  const body = {
    quoteId:       quote.quoteId,
    settleAddress,
    affiliateId:   process.env.SIDESHIFT_AFFILIATE_ID || undefined,
  };

  const data = await apiFetch("/shifts/fixed", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return {
    orderId:        data.id,
    depositAddress: data.depositAddress,
    depositCoin:    data.depositCoin,
    depositNetwork: data.depositNetwork,
    depositAmount:  Number(data.depositAmount),
    settleCoin:     data.settleCoin,
    settleNetwork:  data.settleNetwork,
    settleAmount:   Number(data.settleAmount),
    settleAddress:  data.settleAddress,
    expiresAt:      data.expiresAt,
    status:         data.status,
    // unified fields used by payroll service
    id:             data.id,
    provider:       "sideshift",
    isCrossChain:   true,
    transferTxHash: null,
    explorerUrl:    `https://sideshift.ai/orders/${data.id}`,
    _raw:           data,
  };
}

