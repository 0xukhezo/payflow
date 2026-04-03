/**
 * Chainlink Data Feeds Service
 * Reads real-time USD prices from Chainlink AggregatorV3Interface.
 * Used for swap rate verification in payroll (deviation check against market price).
 *
 * Feed addresses: https://docs.chain.link/data-feeds/price-feeds/addresses
 */
import { ethers } from "ethers";
import { getNetwork } from "../config/networks.js";

const AGGREGATOR_ABI = [
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() external view returns (uint8)",
];

// Chainlink AggregatorV3 feed addresses per chain + asset
// Source: https://docs.chain.link/data-feeds/price-feeds/addresses
const FEED_ADDRESSES = {
  // ── Sepolia testnet ──────────────────────────────────────────────
  11155111: {
    eth:  "0x694AA1769357215DE4FAC081bf1f309aDC325306", // ETH / USD
    weth: "0x694AA1769357215DE4FAC081bf1f309aDC325306", // ETH / USD
    usdc: "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E", // USDC / USD
    usdt: "0x7169D38820dfd117C3FA1f22a697dBA58d90BA06", // USDT / USD
  },

  // ── Arbitrum One mainnet ─────────────────────────────────────────
  42161: {
    eth:  "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612", // ETH  / USD
    weth: "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612", // ETH  / USD
    btc:  "0x6ce185539ad4fdaecd227d37b37b4687c2b3f5a3", // BTC  / USD
    wbtc: "0x6ce185539ad4fdaecd227d37b37b4687c2b3f5a3", // WBTC / USD
    usdc: "0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3", // USDC / USD
    usdt: "0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7", // USDT / USD
    dai:  "0xc5C8E77B397E531B8EC06BFb0048328B30E9eCfB", // DAI  / USD
  },

  // ── Base mainnet ─────────────────────────────────────────────────
  8453: {
    eth:  "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", // ETH  / USD
    weth: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", // ETH  / USD
    btc:  "0xCCADC697c55bbB68dc5bCdf8d3CBe83CdD4E071E", // BTC  / USD
    wbtc: "0xCCADC697c55bbB68dc5bCdf8d3CBe83CdD4E071E", // WBTC / USD
    usdc: "0x7e860098F58bBFC8648a4311b374B1D669a2bc9b", // USDC / USD
    usdt: "0xf19d560eB8d2ADf07BD6D13ed03e1D11215721F9", // USDT / USD
    dai:  "0x591e79239a7d679378eC8c847e5038150364C78F", // DAI  / USD
  },
};

// Primary chain for Chainlink queries per network mode
// Arbitrum and Sepolia have the most complete feed coverage for our tokens
const PRICE_CHAIN = {
  mainnet: 42161,  // Arbitrum One
  testnet: 11155111, // Sepolia
};

// USD-pegged stablecoins — return 1.0 if no Chainlink feed is configured
const STABLECOINS = new Set(["usdc", "usdt", "dai"]);

/**
 * Read the latest USD price for a single asset from Chainlink Data Feeds.
 *
 * @param {string} symbol   - Asset symbol (eth, weth, btc, wbtc, usdc, usdt, dai)
 * @param {number} chainId  - Chain to query (11155111 | 42161 | 8453)
 * @returns {{ symbol, price, updatedAt, roundId, source }}
 */
async function getChainlinkPrice(symbol, chainId) {
  const sym = symbol.toLowerCase();
  const feedAddress = FEED_ADDRESSES[chainId]?.[sym];

  if (!feedAddress) {
    return _fallback(sym, chainId, "no feed configured");
  }

  try {
    const net = getNetwork(chainId);
    const provider = new ethers.JsonRpcProvider(net.rpcUrl);
    const feed = new ethers.Contract(feedAddress, AGGREGATOR_ABI, provider);

    const [roundId, answer, , updatedAt] = await feed.latestRoundData();
    const decimals = await feed.decimals();

    const price = Number(answer) / Math.pow(10, Number(decimals));

    return {
      symbol: sym.toUpperCase(),
      price,
      updatedAt: Number(updatedAt),
      roundId: roundId.toString(),
      source: "chainlink",
    };
  } catch (err) {
    console.warn(`[Chainlink] Feed failed for ${sym} on chain ${chainId}: ${err.message}`);
    return _fallback(sym, chainId, err.message);
  }
}

/**
 * Convenience: get a Chainlink price using network mode ("mainnet" | "testnet")
 * instead of a raw chainId. Uses the canonical price chain for that mode.
 *
 * @param {string} symbol
 * @param {"mainnet"|"testnet"} networkMode
 */
export async function getChainlinkPriceByMode(symbol, networkMode = "testnet") {
  const chainId = PRICE_CHAIN[networkMode] ?? PRICE_CHAIN.testnet;
  return getChainlinkPrice(symbol, chainId);
}

/**
 * Verify that a swap rate is within tolerance of the Chainlink market price.
 * Aborts payroll if the DEX is giving a materially worse rate than the oracle.
 *
 * @param {number} swapRate    - Rate returned by Uniswap quote (output / input, e.g. DAI per USDC)
 * @param {string} settleCoin  - Asset being received (e.g. "dai", "eth", "usdc")
 * @param {"mainnet"|"testnet"} networkMode
 * @returns {{ chainlinkPrice, swapRate, deviationPercent, toleranceBps, withinRange, settleCoin, source }}
 */
export async function checkRate(swapRate, settleCoin, networkMode = "testnet") {
  const { price: chainlinkPrice, source } = await getChainlinkPriceByMode(settleCoin, networkMode);

  // swapRate is settleToken/depositToken (e.g. 0.00047 ETH/USDC).
  // Chainlink price is USD/settleToken (e.g. $2120 USD/ETH).
  // For non-stablecoins: invert swapRate to get implied USD price (USDC ≈ $1).
  const normalised = STABLECOINS.has(settleCoin.toLowerCase()) ? swapRate : (1 / swapRate);
  const deviation = Math.abs(normalised - chainlinkPrice) / chainlinkPrice;
  const deviationPercent = (deviation * 100).toFixed(2);
  const toleranceBps = networkMode === "mainnet" ? 200 : 8000;
  const withinRange = deviation * 10000 <= toleranceBps;
  console.log(
    `[RateCheck] ${settleCoin.toUpperCase()} | swap: ${swapRate.toFixed(8)} | implied: $${normalised.toFixed(4)} | Chainlink: $${chainlinkPrice.toFixed(4)}${source === "fallback" ? " (fallback)" : ""} | deviation: ${deviationPercent}% (${Math.round(deviation * 10000)} bps) | tolerance: ${toleranceBps / 100}% | ${withinRange ? "PASS ✓" : "FAIL ✗"}`
  );
  return { chainlinkPrice, swapRate, deviationPercent, toleranceBps, withinRange, settleCoin, source };
}

// ─────────────────────────────────────────────────────────────────────────────

function _fallback(symbol, chainId, reason) {
  const DEFAULTS = {
    btc:  85000,
    wbtc: 85000,
    eth:  2000,
    weth: 2000,
    usdc: 1.0,
    usdt: 1.0,
    dai:  1.0,
  };

  const price = STABLECOINS.has(symbol) ? 1.0 : (DEFAULTS[symbol] ?? 1.0);

  console.warn(
    `[Chainlink] Fallback price for ${symbol.toUpperCase()} on chain ${chainId}` +
    ` ($${price}) — reason: ${reason}`
  );

  return {
    symbol: symbol.toUpperCase(),
    price,
    updatedAt: Math.floor(Date.now() / 1000),
    roundId: null,
    source: "fallback",
    isFallback: true,
  };
}
