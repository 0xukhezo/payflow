"use client";

import { useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// EVM tokens supported by Uniswap V3 on Arbitrum / Base / Sepolia
// sol is a special Solana asset routed via SideShift (mainnet only)
const ASSETS = [
  { code: "usdt", name: "Tether",      symbol: "USDT", img: "/token-usdt.svg", sepoliaOk: true,  solanaOnly: false },
  { code: "usdc", name: "USD Coin",    symbol: "USDC", img: "/token-usdc.svg", sepoliaOk: true,  solanaOnly: false },
  { code: "dai",  name: "Dai",         symbol: "DAI",  img: "/token-dai.svg",  sepoliaOk: false, solanaOnly: false },
  { code: "eth",  name: "Wrapped ETH", symbol: "WETH", img: "/token-eth.svg",  sepoliaOk: true,  solanaOnly: false },
  { code: "wbtc", name: "Wrapped BTC", symbol: "WBTC", img: "/token-wbtc.svg", sepoliaOk: false, solanaOnly: false },
  { code: "sol",  name: "Solana",      symbol: "SOL",  img: "/token-sol.svg",  sepoliaOk: false, solanaOnly: true  },
];

const SEPOLIA_CHAIN_ID = 11155111;

interface AssetSelectorProps {
  value: string;
  onChange: (code: string) => void;
  chainId?: number;
  className?: string;
  label?: string;
  exclude?: string[];
  evmOnly?: boolean;
}

export function AssetSelector({ value, onChange, chainId, className, label, exclude, evmOnly }: AssetSelectorProps) {
  const [open, setOpen] = useState(false);
  // On Sepolia only show sepoliaOk tokens; evmOnly hides Solana-only assets
  const chainFiltered = chainId === SEPOLIA_CHAIN_ID
    ? ASSETS.filter((a) => a.sepoliaOk)
    : evmOnly
      ? ASSETS.filter((a) => !a.solanaOnly)
      : ASSETS;
  const available = exclude?.length ? chainFiltered.filter((a) => a.code === value || !exclude.includes(a.code)) : chainFiltered;
  const selected  = available.find((a) => a.code === value) || chainFiltered.find((a) => a.code === value) || available[0];

  return (
    <div className={cn("relative", className)}>
      {label && <div className="section-label mb-1">{label}</div>}

      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-overlay border border-rim font-mono text-xs text-ink transition-colors"
      >
        <span className="flex items-center gap-2">
          <img src={selected.img} alt="" className="w-4 h-4" />
          <span className="tracking-wider">{selected.symbol}</span>
          <span className="text-muted">{selected.name}</span>
        </span>
        <ChevronDown className={cn("w-4 h-4 text-faint transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          className="absolute z-50 top-full mt-1 left-0 right-0 overflow-hidden bg-overlay border border-rim"
          style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}
        >
          {available.map((asset) => {
            const isSelected = value === asset.code;
            return (
              <button
                key={asset.code}
                type="button"
                onClick={() => { onChange(asset.code); setOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-left font-mono text-xs transition-colors",
                  isSelected ? "bg-surface text-gold" : "text-ink hover:bg-surface/50"
                )}
              >
                <img src={asset.img} alt="" className="w-4 h-4" />
                <span className="tracking-wider">{asset.symbol}</span>
                <span className={isSelected ? "text-gold/70" : "text-muted"}>{asset.name}</span>
                {isSelected && <Check className="w-3 h-3 ml-auto" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
