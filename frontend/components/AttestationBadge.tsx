"use client";

import { useState } from "react";
import { CheckCircle, XCircle, ExternalLink, Shield, Loader2, Share2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { API_URL } from "@/lib/contracts";
import { explorerTxUrl, getNetworkByChainId } from "@/lib/networks";

interface AttestationBadgeProps {
  shiftId: string;
  withinRange: boolean;
  deviationPercent: string;
  className?: string;
}

interface ShiftData {
  shiftId: string;
  status: string;
  provider?: string;
  isTwoHop?: boolean;
  txHash?: string;
  depositChainId?: number;
  settleChainId?: number;
  transferTxHash?: string;
  secondHopTxHash?: string;
  attestation?: {
    deviationBps?: number;
    deviationPercent?: string;
    withinRange?: boolean;
  } | null;
}

export function AttestationBadge({ shiftId, withinRange, deviationPercent, className }: AttestationBadgeProps) {
  const hasDeviation = deviationPercent && deviationPercent !== "—";
  const [open, setOpen]       = useState(false);
  const [data, setData]       = useState<ShiftData | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied]   = useState(false);

  const handleClick = async () => {
    setOpen(true);
    if (data) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/payroll/shift/${shiftId}`);
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  const isUniswapTx = shiftId.startsWith("0x") && shiftId.length === 66;
  const provider    = data?.provider ?? (isUniswapTx ? "uniswap" : "sideshift");

  return (
    <>
      <button
        onClick={handleClick}
        title="View attestation"
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-0.5 font-mono text-[10px] tracking-wider border transition-opacity hover:opacity-80 cursor-pointer",
          withinRange ? "border-teal/30 text-teal" : "border-red/30 text-red",
          className
        )}
      >
        <span>{withinRange ? "Oracle ✓" : "Out of range"}</span>
        {hasDeviation && <span className="text-muted">· {deviationPercent}% dev</span>}
        <Shield className="w-2.5 h-2.5 opacity-50" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="w-full max-w-lg bg-surface border border-rim max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-line">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 flex items-center justify-center border ${
                  data?.attestation?.withinRange ? "bg-teal/10 border-teal/30" :
                  data                          ? "bg-red/10 border-red/30"   :
                                                  "bg-gold/15 border-gold-dim"
                }`}>
                  <Shield className={`w-3.5 h-3.5 ${data?.attestation?.withinRange ? "text-teal" : data ? "text-red" : "text-gold"}`} />
                </div>
                <div>
                  <div className="font-heading font-bold text-sm text-ink">Payment Rate Verification</div>
                  <div className="section-label mt-0.5">Chainlink oracle · Uniswap rate attestation</div>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-ink transition-colors font-mono text-xs">✕</button>
            </div>

            {/* Body */}
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 font-mono text-xs text-faint">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading attestation…
              </div>
            ) : !data ? (
              <div className="p-10 text-center">
                <XCircle className="w-7 h-7 mx-auto mb-3 text-red" />
                <p className="font-mono text-sm text-muted">Verification not found.</p>
                <code className="block mt-1 font-mono text-xs text-faint break-all">{shiftId}</code>
                <p className="mt-3 font-mono text-xs text-faint">The attestation may not have been submitted yet.</p>
              </div>
            ) : (
              <div className="p-6 space-y-5">
                {/* Result banner */}
                <div className={`flex items-center gap-3 p-4 border ${
                  withinRange ? "bg-teal/8 border-teal/30" : "bg-red/8 border-red/30"
                }`}>
                  {withinRange
                    ? <CheckCircle className="w-4.5 h-4.5 shrink-0 text-teal" />
                    : <XCircle    className="w-4.5 h-4.5 shrink-0 text-red"  />}
                  <div>
                    <p className={`font-heading font-bold text-sm ${withinRange ? "text-teal" : "text-red"}`}>
                      {withinRange ? "Within acceptable range" : "Out of acceptable range"}
                    </p>
                    {hasDeviation && (
                      <p className="font-mono text-xs text-muted">{deviationPercent}% deviation from Chainlink oracle price</p>
                    )}
                  </div>
                </div>

                {/* Details */}
                <div>
                  {[
                    { label: "Shift ID",      value: shiftId },
                    { label: "Swap Provider", value: provider === "uniswap" ? "Uniswap (EVM)" : "SideShift (Cross-chain)" },
                    { label: "Network",       value: data.depositChainId ? (getNetworkByChainId(data.depositChainId)?.name ?? "Unknown") : (provider === "uniswap" ? "Sepolia testnet" : "Mainnet") },
                    { label: "Status",        value: data.status },
                    ...(data.attestation?.deviationBps != null ? [{ label: "Deviation", value: `${data.attestation.deviationPercent}% (${data.attestation.deviationBps} bps)` }] : []),
                  ].map(({ label, value }) => (
                    <div key={label} className="data-row">
                      <span className="data-label">{label}</span>
                      <code className="data-value break-all">{value}</code>
                    </div>
                  ))}
                </div>

                {/* On-chain links */}
                <div className="pt-4 space-y-2 border-t border-line">
                  {data.transferTxHash ? (() => {
                    const chainId = data.settleChainId ?? data.depositChainId ?? 11155111;
                    const net     = getNetworkByChainId(chainId);
                    return (
                      <a href={explorerTxUrl(chainId, data.transferTxHash!)} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 font-mono text-xs text-gold hover:brightness-110 transition-all">
                        <ExternalLink className="w-3.5 h-3.5" />
                        View payment to employee wallet on {net?.name ?? "Etherscan"}
                      </a>
                    );
                  })() : (
                    <span className="flex items-center gap-2 font-mono text-xs text-faint">
                      <ExternalLink className="w-3.5 h-3.5 opacity-30" />
                      Transfer tx not recorded for this run
                    </span>
                  )}
                  {provider === "uniswap" && (data.txHash || isUniswapTx) && (() => {
                    const chainId = data.depositChainId ?? 11155111;
                    const net     = getNetworkByChainId(chainId);
                    const url     = explorerTxUrl(chainId, data.txHash || shiftId);
                    return (
                      <a href={url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 font-mono text-xs text-muted hover:text-ink transition-colors">
                        <ExternalLink className="w-3.5 h-3.5" />
                        View Uniswap swap on {net?.name ?? "Etherscan"}
                      </a>
                    );
                  })()}
                  {data.secondHopTxHash && (() => {
                    const chainId = data.settleChainId ?? 11155111;
                    const net     = getNetworkByChainId(chainId);
                    return (
                      <a href={explorerTxUrl(chainId, data.secondHopTxHash!)} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 font-mono text-xs text-muted hover:text-ink transition-colors">
                        <ExternalLink className="w-3.5 h-3.5" />
                        View second hop on {net?.name ?? "Etherscan"}
                      </a>
                    );
                  })()}
                  {provider === "sideshift" && (
                    <a href={`https://sideshift.ai/orders/${shiftId}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 font-mono text-xs text-muted hover:text-ink transition-colors">
                      <ExternalLink className="w-3.5 h-3.5" />
                      View order on SideShift.ai
                    </a>
                  )}
                </div>

                {/* Footer */}
                <p className="pt-4 border-t border-line font-mono text-xs text-faint leading-relaxed">
                  The deviation measures how closely the swap rate matches the Chainlink oracle price
                  at the time of payment, accounting for fees and spread.
                  Payments outside the configured tolerance are blocked by the CRE workflow.
                </p>

                <div className="flex items-center justify-between pt-1">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/verify/${shiftId}`);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-rim text-muted font-mono text-xs tracking-widest transition-all hover:border-muted hover:text-ink"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-teal" /> : <Share2 className="w-3.5 h-3.5" />}
                    {copied ? "COPIED!" : "SHARE THIS PROOF"}
                  </button>
                  <button onClick={() => setOpen(false)} className="font-mono text-xs text-faint hover:text-muted transition-colors">
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
