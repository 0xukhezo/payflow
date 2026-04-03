interface TokenConfig {
  address: string;
  decimals: number;
  symbol: string;
}

export interface NetworkConfig {
  chainId: number;
  name: string;
  shortName: string;
  rpcUrl: string;
  explorer: string;
  tokens: Record<string, TokenConfig>;
}

export const NETWORKS: Record<string, NetworkConfig> = {
  sepolia: {
    chainId:   11155111,
    name:      "Sepolia",
    shortName: "Sepolia",
    rpcUrl:    "https://ethereum-sepolia-rpc.publicnode.com",
    explorer:  "https://sepolia.etherscan.io",
    tokens: {
      usdc: { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6,  symbol: "USDC" },
      weth: { address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", decimals: 18, symbol: "WETH" },
      eth:  { address: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", decimals: 18, symbol: "WETH" },
      usdt: { address: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0", decimals: 6,  symbol: "USDT" },
      dai:  { address: "0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357", decimals: 18, symbol: "DAI"  },
    },
  },
  baseSepolia: {
    chainId:   84532,
    name:      "Base Sepolia",
    shortName: "Base Sep.",
    rpcUrl:    "https://sepolia.base.org",
    explorer:  "https://sepolia.basescan.org",
    tokens: {
      usdc: { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", decimals: 6,  symbol: "USDC" },
      weth: { address: "0x4200000000000000000000000000000000000006", decimals: 18, symbol: "WETH" },
      eth:  { address: "0x4200000000000000000000000000000000000006", decimals: 18, symbol: "WETH" },
    },
  },
  arbitrum: {
    chainId:   42161,
    name:      "Arbitrum One",
    shortName: "Arbitrum",
    rpcUrl:    "https://arb1.arbitrum.io/rpc",
    explorer:  "https://arbiscan.io",
    tokens: {
      usdc: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6,  symbol: "USDC" },
      usdt: { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6,  symbol: "USDT" },
      weth: { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18, symbol: "WETH" },
      eth:  { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18, symbol: "WETH" },
      dai:  { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18, symbol: "DAI"  },
      wbtc: { address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8,  symbol: "WBTC" },
    },
  },
  base: {
    chainId:   8453,
    name:      "Base",
    shortName: "Base",
    rpcUrl:    "https://mainnet.base.org",
    explorer:  "https://basescan.org",
    tokens: {
      usdc: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6,  symbol: "USDC" },
      usdt: { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6,  symbol: "USDT" },
      weth: { address: "0x4200000000000000000000000000000000000006", decimals: 18, symbol: "WETH" },
      eth:  { address: "0x4200000000000000000000000000000000000006", decimals: 18, symbol: "WETH" },
      dai:  { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18, symbol: "DAI"  },
    },
  },
};

export type NetworkMode = "testnet" | "mainnet";

export const NETWORK_MODE_CONFIG: Record<NetworkMode, { networks: NetworkConfig[]; tokens: string[] }> = {
  testnet: {
    networks: [NETWORKS.sepolia, NETWORKS.baseSepolia],
    tokens:   ["usdc", "weth", "usdt", "dai"],
  },
  mainnet: {
    networks: [NETWORKS.arbitrum, NETWORKS.base],
    tokens:   ["usdc", "usdt", "weth", "dai", "wbtc"],
  },
};

export function getNetworkByChainId(chainId: number): NetworkConfig | undefined {
  return Object.values(NETWORKS).find((n) => n.chainId === chainId);
}

export function getDefaultNetwork(mode: NetworkMode): NetworkConfig {
  return NETWORK_MODE_CONFIG[mode].networks[0];
}

export function explorerTxUrl(chainId: number, txHash: string): string {
  const net = getNetworkByChainId(chainId);
  return net ? `${net.explorer}/tx/${txHash}` : `#`;
}
