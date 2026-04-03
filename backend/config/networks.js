/**
 * Single source of truth for all supported chains and tokens.
 * No hardcoded addresses anywhere else — always import from here.
 */

export const NETWORKS = {
  testnet: {
    sepolia: {
      chainId: 11155111,
      name: "Sepolia",
      rpcUrl: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      explorer: "https://sepolia.etherscan.io",
      tokens: {
        usdc: { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6,  symbol: "USDC" },
        usdt: { address: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0", decimals: 6,  symbol: "USDT" },
        weth: { address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", decimals: 18, symbol: "WETH" },
        eth:  { address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", decimals: 18, symbol: "WETH" }, // alias
        // DAI excluded — thin testnet liquidity
      },
    },
    baseSepolia: {
      chainId: 84532,
      name: "Base Sepolia",
      rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      explorer: "https://sepolia.basescan.org",
      tokens: {
        // Circle USDC on Base Sepolia
        usdc: { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", decimals: 6,  symbol: "USDC" },
        // Standard predeploy — same address as Base mainnet
        weth: { address: "0x4200000000000000000000000000000000000006", decimals: 18, symbol: "WETH" },
        eth:  { address: "0x4200000000000000000000000000000000000006", decimals: 18, symbol: "WETH" }, // alias
      },
    },
  },
  mainnet: {
    arbitrum: {
      chainId: 42161,
      name: "Arbitrum",
      rpcUrl: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
      explorer: "https://arbiscan.io",
      tokens: {
        usdc: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6,  symbol: "USDC" },
        usdt: { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6,  symbol: "USDT" },
        weth: { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18, symbol: "WETH" },
        eth:  { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18, symbol: "WETH" }, // alias
        dai:  { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18, symbol: "DAI"  },
        wbtc: { address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8,  symbol: "WBTC" },
        btc:  { address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8,  symbol: "WBTC" }, // alias
      },
    },
    base: {
      chainId: 8453,
      name: "Base",
      rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      explorer: "https://basescan.org",
      tokens: {
        usdc: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6,  symbol: "USDC" },
        usdt: { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6,  symbol: "USDT" },
        weth: { address: "0x4200000000000000000000000000000000000006", decimals: 18, symbol: "WETH" },
        eth:  { address: "0x4200000000000000000000000000000000000006", decimals: 18, symbol: "WETH" }, // alias
        dai:  { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18, symbol: "DAI"  },
        wbtc: { address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8,  symbol: "WBTC" },
        btc:  { address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8,  symbol: "WBTC" }, // alias
      },
    },
  },
};

export const SUPPORTED_CHAIN_IDS = [11155111, 84532, 42161, 8453];

export const EVM_ASSETS = ["usdc", "usdt", "weth", "eth", "dai", "wbtc", "btc"];

// Pseudo chain-id for Solana (not an EVM chain — used as a routing marker)
export const SOLANA_CHAIN_ID = 1399811149;
export const SOLANA_ASSETS   = ["sol"];

/** Return network config by chainId, throws if unsupported */
export function getNetwork(chainId) {
  for (const mode of Object.values(NETWORKS)) {
    for (const net of Object.values(mode)) {
      if (net.chainId === chainId) return net;
    }
  }
  throw new Error(`Unsupported chainId: ${chainId}`);
}

/** Return token config ({ address, decimals, symbol }) by symbol + chainId */
export function getToken(symbol, chainId) {
  const net = getNetwork(chainId);
  const token = net.tokens[symbol.toLowerCase()];
  if (!token) throw new Error(`Token ${symbol} not supported on chain ${chainId}`);
  return token;
}

/** Return which swap provider to use for a given asset+chain pair */
export function getSwapProvider(depositAsset, depositChainId, settleAsset, settleChainId) {
  const isEvmIn     = EVM_ASSETS.includes(depositAsset.toLowerCase()) && SUPPORTED_CHAIN_IDS.includes(depositChainId);
  const isEvmOut    = EVM_ASSETS.includes(settleAsset.toLowerCase())  && SUPPORTED_CHAIN_IDS.includes(settleChainId);
  const isSolanaOut = SOLANA_ASSETS.includes(settleAsset.toLowerCase()) && settleChainId === SOLANA_CHAIN_ID;

  if (isEvmIn && isEvmOut)    return "uniswap";
  if (isEvmIn && isSolanaOut) return "sideshift";
  return "unsupported";
}
