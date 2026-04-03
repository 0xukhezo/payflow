"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { truncateAddress } from "@/lib/utils";

interface WalletSlot {
  address: string;
  balance: string;
  unit?: string;
  label?: string;
}

interface WalletCardProps {
  address: string;
  balance: string;
  unit?: string;
  label?: string;
  className?: string;
  solana?: WalletSlot;
}

function WalletSlotRow({ address, balance, unit = "USDC", label = "Wallet" }: WalletSlot) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div className="section-label mb-2">{label}</div>
      <div className="flex items-center gap-2 mb-1.5">
        <code className="font-mono text-sm text-ink">{truncateAddress(address)}</code>
        <button
          onClick={handleCopy}
          className={`transition-colors ${copied ? "text-teal" : "text-faint hover:text-muted"}`}
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <div>
        <span className="font-mono text-2xl font-bold text-gold">{balance}</span>
        <span className="ml-2 font-mono text-[11px] tracking-widest text-faint">{unit}</span>
      </div>
    </div>
  );
}

export function WalletCard({ address, balance, unit = "USDC", label = "Wallet", className, solana }: WalletCardProps) {
  return (
    <div className={`bg-surface border border-rim p-5 ${className ?? ""}`}>
      {solana ? (
        <div className="grid grid-cols-2 divide-x divide-rim gap-0">
          <div className="pr-5">
            <WalletSlotRow address={address} balance={balance} unit={unit} label={label} />
          </div>
          <div className="pl-5">
            <WalletSlotRow
              address={solana.address}
              balance={solana.balance}
              unit={solana.unit ?? "SOL"}
              label={solana.label ?? "Solana Wallet"}
            />
          </div>
        </div>
      ) : (
        <WalletSlotRow address={address} balance={balance} unit={unit} label={label} />
      )}
    </div>
  );
}
