import { CheckCircle, XCircle, ExternalLink, Shield } from "lucide-react";
import { AppNav } from "@/components/AppNav";
import { API_URL } from "@/lib/contracts";
import { explorerTxUrl, getNetworkByChainId } from "@/lib/networks";
import { ShareButton } from "./ShareButton";

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

async function getShiftData(shiftId: string): Promise<ShiftData | null> {
  try {
    const res = await fetch(`${API_URL}/api/payroll/shift/${shiftId}`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

function providerLabel(provider?: string) {
  return provider === "uniswap" ? "Uniswap (EVM)" : "SideShift (Cross-chain)";
}

function networkLabel(depositChainId?: number, provider?: string) {
  if (depositChainId) {
    const net = getNetworkByChainId(depositChainId);
    if (net) return net.name;
  }
  return provider === "uniswap" ? "Sepolia testnet" : "Mainnet";
}

export default async function VerifyPage({ params }: { params: Promise<{ shiftId: string }> }) {
  const { shiftId } = await params;
  const data = await getShiftData(shiftId);

  const isUniswapTx = shiftId.startsWith("0x") && shiftId.length === 66;
  const provider    = data?.provider ?? (isUniswapTx ? "uniswap" : "sideshift");
  const withinRange = data?.attestation?.withinRange ?? true;

  return (
    <div className="min-h-screen bg-bg">
      <AppNav label="Verify Payment" />
      <div className="max-w-2xl mx-auto px-8 py-10">

        <div className="bg-surface border border-rim">
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-5 border-b border-line">
            <div className={`w-9 h-9 flex items-center justify-center border ${
              withinRange && data ? "bg-teal/10 border-teal/30" :
              data               ? "bg-red/10 border-red/30"   :
                                   "bg-gold/15 border-gold-dim"
            }`}>
              <Shield className={`w-4 h-4 ${
                withinRange && data ? "text-teal" : data ? "text-red" : "text-gold"
              }`} />
            </div>
            <div>
              <div className="font-heading font-bold text-base text-ink">Payment Rate Verification</div>
              <div className="section-label mt-0.5">Chainlink oracle · Uniswap rate attestation</div>
            </div>
          </div>

          {!data ? (
            <div className="p-10 text-center">
              <XCircle className="w-8 h-8 mx-auto mb-4 text-red" />
              <p className="font-mono text-sm text-muted">Verification not found for shift:</p>
              <code className="block mt-1 font-mono text-xs text-faint">{shiftId}</code>
              <p className="mt-3 font-mono text-xs text-faint">The attestation may not have been submitted yet.</p>
            </div>
          ) : (
            <div className="p-6 space-y-6">
              {/* Result banner */}
              <div className={`flex items-center gap-3 p-4 border ${
                withinRange ? "bg-teal/8 border-teal/30" : "bg-red/8 border-red/30"
              }`}>
                {withinRange
                  ? <CheckCircle className="w-5 h-5 shrink-0 text-teal" />
                  : <XCircle    className="w-5 h-5 shrink-0 text-red"  />}
                <div>
                  <p className={`font-heading font-bold ${withinRange ? "text-teal" : "text-red"}`}>
                    {withinRange ? "Within acceptable range" : "Out of acceptable range"}
                  </p>
                  {data.attestation?.deviationPercent && (
                    <p className="font-mono text-xs text-muted">
                      {data.attestation.deviationPercent}% deviation from Chainlink oracle price
                    </p>
                  )}
                </div>
              </div>

              {/* Details */}
              <div>
                {[
                  { label: "Shift ID",      value: shiftId },
                  { label: "Swap Provider", value: providerLabel(provider) },
                  { label: "Network",       value: networkLabel(data.depositChainId, provider) },
                  { label: "Status",        value: data.status },
                  ...(data.attestation?.deviationBps != null
                    ? [{ label: "Deviation", value: `${data.attestation.deviationPercent}% (${data.attestation.deviationBps} bps)` }]
                    : []),
                ].map(({ label, value }) => (
                  <div key={label} className="data-row">
                    <span className="data-label">{label}</span>
                    <code className="data-value">{value}</code>
                  </div>
                ))}
              </div>

              {/* On-chain links */}
              <div className="pt-4 space-y-2 border-t border-line">
                {data.transferTxHash ? (() => {
                  const chainId = data.settleChainId ?? data.depositChainId ?? 11155111;
                  const net = getNetworkByChainId(chainId);
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
                  const net = getNetworkByChainId(chainId);
                  const url = explorerTxUrl(chainId, data.txHash || shiftId);
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
                  const net = getNetworkByChainId(chainId);
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

              {/* Explanation */}
              <p className="pt-4 border-t border-line font-mono text-xs text-faint leading-loose">
                The deviation measures how closely the swap rate matches the Chainlink oracle price
                at the time of payment, accounting for fees and spread.
                Payments outside the configured tolerance are blocked by the Chainlink CRE workflow.
              </p>

              <ShareButton />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
