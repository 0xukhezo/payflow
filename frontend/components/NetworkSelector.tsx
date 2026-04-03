"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NetworkConfig } from "@/lib/networks";

const CHAIN_ICON_IMGS: Record<number, string> = {
  11155111: "/token-eth.svg",
  42161:    "/chain-arbitrum.svg",
  8453:     "/chain-base.svg",
};

function ChainIcon({ chainId, className = "w-4 h-4" }: { chainId?: number; className?: string }) {
  const src = chainId != null ? CHAIN_ICON_IMGS[chainId] : undefined;
  if (src) return <img src={src} alt="" className={className} />;
  return <img src="/token-eth.svg" alt="" className={className} />;
}

interface NetworkSelectorProps {
  networks: NetworkConfig[];
  value: number;
  onChange: (chainId: number) => void;
  label?: string;
  className?: string;
}

export function NetworkSelector({ networks, value, onChange, label, className }: NetworkSelectorProps) {
  const [open, setOpen] = useState(false);
  const selected = networks.find((n) => n.chainId === value) || networks[0];

  return (
    <div className={cn("relative", className)}>
      {label && <div className="section-label mb-1">{label}</div>}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-overlay border border-rim font-mono text-xs text-ink transition-colors"
      >
        <span className="flex items-center gap-2">
          <ChainIcon chainId={selected?.chainId} />
          <span className="tracking-wider">{selected?.shortName ?? "Select network"}</span>
        </span>
        <ChevronDown className={cn("w-4 h-4 text-faint transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          className="absolute z-50 top-full mt-1 left-0 right-0 overflow-hidden bg-overlay border border-rim"
          style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}
        >
          {networks.map((net) => (
            <button
              key={net.chainId}
              type="button"
              onClick={() => { onChange(net.chainId); setOpen(false); }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-left font-mono text-xs text-ink transition-colors",
                value === net.chainId ? "bg-surface" : "hover:bg-surface/50"
              )}
            >
              <ChainIcon chainId={net.chainId} />
              <span className="tracking-wider">{net.shortName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
