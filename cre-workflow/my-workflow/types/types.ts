export type Config = {
  toleranceBps:           number;   // oracle deviation tolerance in bps (e.g. 8000 = 80% for testnet)
  networkLabel:           string;   // human-readable label for logs (e.g. "Sepolia Testnet")
  dispatcherAddress:      string;   // PayrollDispatcher contract (empty = skip writeReport)
  backendApiUrl:          string;   // PayFlow backend base URL (e.g. "http://localhost:3001")
  uniswapApiKey:          string;   // Uniswap Trading API key
  oracleRpc:              string;   // JSON-RPC URL for reading Chainlink feeds (Sepolia or Mainnet)
  feedEthUsd:             string;   // Chainlink ETH/USD AggregatorV3 address
  feedBtcUsd:             string;   // Chainlink BTC/USD AggregatorV3 address
  enableLogTrigger:       boolean;  // true on deployed DON, false for local simulation
  triggerContractAddress: string;   // PayrollTrigger contract on Sepolia
};

export interface PayrollSplit {
  percent:        number;   // 0-100, all splits must sum to 100
  asset:          string;   // e.g. "WETH", "USDC"
  chain_id:       number;
  settleAddress?: string;   // optional custom delivery wallet for this split
}

export interface Employee {
  id: string;
  name: string;
  salaryUsdc: number;
  settleAddress: string;
  solanaAddress?: string;   // Solana wallet address — required when preferredAsset is "SOL"
  preferredAsset:   string;  // "ETH" | "WETH" | "WBTC" | "BTC" | "USDC" | "USDT" | "DAI" | "SOL"
  preferredChainId: number;  // destination chain (use 1399811149 for Solana)
  worldIdVerified: boolean;
  splits?: PayrollSplit[];   // optional salary split — if present and sums to 100, overrides preferredAsset
}

export interface TriggerPayload {
  companyId:      string;
  treasury:       string;   // company USDC treasury address
  depositChainId: number;   // chain where company holds USDC (used for Uniswap quotes)
  employees:      Employee[];
}
