"use client";

import { useEffect, useState } from "react";
import { AttestationBadge } from "./AttestationBadge";
import { API_URL } from "@/lib/contracts";
import { explorerTxUrl } from "@/lib/networks";
import { formatDate } from "@/lib/utils";
import { ExternalLink, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 10;

interface PaymentRecord {
  shiftId: string;
  amount: string;
  asset: string;
  settleChainId?: number;
  depositChainId?: number;
  timestamp: number;
  date: string;
  teeTxHash?: string;
  swapTxHash?: string;
  transferTxHash?: string;
  attestation?: { deviationBps?: number; deviationPercent?: string; withinRange?: boolean } | null;
  source: string;
}

export function SalaryHistory({ employeeAddress }: { employeeAddress: string }) {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const fetchHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/employee/${employeeAddress}/history`);
      if (!res.ok) throw new Error("Failed to fetch payment history");
      const data = await res.json();
      setPayments(data.payments || []);
      setPage(0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (employeeAddress) fetchHistory(); }, [employeeAddress]);

  const totalPages  = Math.ceil(payments.length / PAGE_SIZE);
  const paginated   = payments.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  // How many skeleton rows to show — match current page size or default to PAGE_SIZE
  const skeletonRows = paginated.length || PAGE_SIZE;

  if (error && payments.length === 0) return (
    <div className="p-3 bg-red/8 border border-red/30 text-red font-mono text-xs">{error}</div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="font-heading text-sm font-bold text-ink">Payment History</div>
        <button onClick={fetchHistory} disabled={loading} className="text-faint hover:text-muted transition-colors disabled:opacity-40">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {!loading && payments.length === 0 ? (
        <p className="py-10 text-center font-mono text-xs text-faint">
          No payment history found for this address.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr className="border-b border-line">
                  {["Date", "Received", "Oracle", "Swap Tx", "Transfer Tx"].map((h) => (
                    <th key={h} className="text-left py-3 px-4 section-label font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: skeletonRows }, (_, i) => (
                      <tr key={i} className="border-b border-line">
                        <td className="py-3 px-4"><div className="h-3 w-28 bg-white/5 animate-pulse rounded-sm" /></td>
                        <td className="py-3 px-4"><div className="h-3 w-24 bg-white/5 animate-pulse rounded-sm" /></td>
                        <td className="py-3 px-4"><div className="h-5 w-28 bg-white/5 animate-pulse rounded-sm" /></td>
                        <td className="py-3 px-4"><div className="h-3 w-20 bg-white/5 animate-pulse rounded-sm" /></td>
                        <td className="py-3 px-4"><div className="h-3 w-20 bg-white/5 animate-pulse rounded-sm" /></td>
                      </tr>
                    ))
                  : paginated.map((p) => {
                  const withinRange = p.attestation?.withinRange ?? true;
                  const deviationPercent = p.attestation?.deviationPercent ?? "—";
                  return (
                    <tr key={p.shiftId} className="border-b border-line hover:bg-white/2 transition-colors">
                      <td className="py-3 px-4 font-mono text-xs text-muted whitespace-nowrap">
                        {formatDate(p.timestamp || p.date)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-mono text-sm font-semibold text-ink">{p.amount}</span>
                        {" "}
                        <span className="font-mono text-xs text-gold tracking-widest">
                          {p.asset.toLowerCase() === "eth" ? "WETH" : p.asset.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <AttestationBadge
                          shiftId={p.shiftId}
                          withinRange={withinRange}
                          deviationPercent={deviationPercent}
                        />
                      </td>
                      <td className="py-3 px-4">
                        {p.swapTxHash ? (
                          <a href={explorerTxUrl(p.depositChainId ?? 11155111, p.swapTxHash)} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-xs text-muted hover:text-ink transition-colors">
                            {p.swapTxHash.slice(0, 8)}…{p.swapTxHash.slice(-6)}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : <span className="text-faint">—</span>}
                      </td>
                      <td className="py-3 px-4">
                        {p.transferTxHash ? (
                          <a href={explorerTxUrl(p.settleChainId ?? 11155111, p.transferTxHash)} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-xs text-muted hover:text-ink transition-colors">
                            {p.transferTxHash.slice(0, 8)}…{p.transferTxHash.slice(-6)}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : <span className="text-faint">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-line">
              <span className="font-mono text-[11px] text-faint">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, payments.length)} of {payments.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-1 text-muted hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setPage(i)}
                    className={`w-6 h-6 font-mono text-[11px] transition-colors ${
                      i === page
                        ? "bg-gold text-base font-bold"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page === totalPages - 1}
                  className="p-1 text-muted hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
