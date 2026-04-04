"use client";

import React, { useState } from "react";
import { WorldIdBadge } from "./WorldIdBadge";
import { API_URL } from "@/lib/contracts";
import { getNetworkByChainId } from "@/lib/networks";
import { useToast } from "@/components/Toast";
import { Loader2, Plus, Trash2, Pencil, Check, X } from "lucide-react";
import Image from "next/image";

const TOKEN_ICONS: Record<string, string> = {
  eth:  "/token-eth.svg",
  weth: "/token-eth.svg",
  usdc: "/token-usdc.svg",
  usdt: "/token-usdt.svg",
  dai:  "/token-dai.svg",
  wbtc: "/token-wbtc.svg",
  sol:  "/token-sol.svg",
};

const CHAIN_ICONS: Record<number, string> = {
  8453:     "/chain-base.svg",
  84532:    "/chain-base.svg",
  42161:    "/chain-arbitrum.svg",
  421614:   "/chain-arbitrum.svg",
};

function TokenBadge({ asset }: { asset: string }) {
  const key = asset.toLowerCase();
  const icon = TOKEN_ICONS[key];
  const label = key === "eth" ? "WETH" : asset.toUpperCase();
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon && <Image src={icon} alt={label} width={14} height={14} className="rounded-full" />}
      <span className="font-mono text-xs text-gold tracking-widest">{label}</span>
    </span>
  );
}

function NetworkBadge({ chainId }: { chainId: number }) {
  const icon = CHAIN_ICONS[chainId];
  const name = getNetworkByChainId(chainId)?.shortName ?? String(chainId);
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon && <Image src={icon} alt={name} width={14} height={14} className="rounded-full" />}
      <span className="font-mono text-xs text-muted">{name}</span>
    </span>
  );
}

interface PayrollSplit {
  percent: number;
  asset: string;
  chain_id: number;
  settleAddress?: string;
}

interface Employee {
  id: string;
  name: string;
  preferredAsset: string;
  preferredChainId?: number;
  settleAddress: string;
  solanaAddress?: string | null;
  salaryAmount: number;
  worldIdVerified?: boolean;
  splits?: PayrollSplit[];
}

interface PayrollTableProps {
  employees: Employee[];
  companyId: string;
  onAddEmployee: () => void;
  onEmployeeRemoved: () => void;
  onSalaryUpdated?: () => void;
}

export function PayrollTable({ employees, companyId, onAddEmployee, onEmployeeRemoved, onSalaryUpdated }: PayrollTableProps) {
  const toast = useToast();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editingSalaryId, setEditingSalaryId] = useState<string | null>(null);
  const [salaryDraft, setSalaryDraft] = useState("");
  const [savingSalaryId, setSavingSalaryId] = useState<string | null>(null);

  const removeEmployee = async (employeeId: string) => {
    setRemovingId(employeeId);
    try {
      const res = await fetch(`${API_URL}/api/company/${companyId}/employee/${employeeId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      onEmployeeRemoved();
      toast("info", "Employee removed from payroll.");
    } catch {
      toast("error", "Failed to remove employee.");
    } finally {
      setRemovingId(null);
    }
  };

  const saveSalary = async (employeeId: string) => {
    const amount = Number(salaryDraft);
    if (!salaryDraft || isNaN(amount) || amount <= 0) {
      toast("error", "Enter a valid salary amount.");
      return;
    }
    setSavingSalaryId(employeeId);
    try {
      const res = await fetch(`${API_URL}/api/company/${companyId}/employee/${employeeId}/salary`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salaryAmount: amount }),
      });
      if (!res.ok) throw new Error(await res.text());
      setEditingSalaryId(null);
      toast("success", "Salary updated.");
      onSalaryUpdated?.();
    } catch {
      toast("error", "Failed to update salary.");
    } finally {
      setSavingSalaryId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="font-heading text-sm font-bold text-ink">Employees</div>
        <button
          onClick={onAddEmployee}
          className="inline-flex items-center gap-2 px-4 py-2 border border-dashed border-rim text-muted font-mono text-xs tracking-widest hover:border-gold hover:text-gold transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> ADD EMPLOYEE
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr className="border-b border-line">
              {["Name", "Verified", "Receives", "Network", "Salary", "Settlement Address", "Status", "Attestation", ""].map((h) => (
                <th key={h} className="text-left py-3 px-4 section-label font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center font-mono text-xs text-faint">
                  No employees yet — add your first employee to get started.
                </td>
              </tr>
            ) : (
              employees.map((emp) => {
                const hasSplits = emp.splits && emp.splits.length > 0 && emp.splits.reduce((s, x) => s + x.percent, 0) === 100;
                const rowClass = !emp.worldIdVerified
                  ? "border-b border-line opacity-50"
                  : `${hasSplits ? "" : "border-b border-line"} hover:bg-white/[0.02] transition-colors`;

                return (
                  <React.Fragment key={emp.id}>
                  <tr className={rowClass}>
                    <td className="py-3 px-4 text-ink font-medium">{emp.name}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <WorldIdBadge verified={emp.worldIdVerified ?? false} />
                    </td>
                    <td className="py-3 px-4">
                      {hasSplits ? <span className="text-faint">—</span> : <TokenBadge asset={emp.preferredAsset} />}
                    </td>
                    <td className="py-3 px-4">
                      {hasSplits ? <span className="text-faint">—</span> : <NetworkBadge chainId={emp.preferredChainId ?? 11155111} />}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {editingSalaryId === emp.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min="1"
                            step="0.01"
                            value={salaryDraft}
                            onChange={(e) => setSalaryDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") saveSalary(emp.id); if (e.key === "Escape") setEditingSalaryId(null); }}
                            autoFocus
                            className="w-24 px-2 py-1 bg-overlay border border-gold font-mono text-xs text-ink focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <button
                            onClick={() => saveSalary(emp.id)}
                            disabled={savingSalaryId === emp.id}
                            className="p-1 text-green hover:brightness-125 transition-colors disabled:opacity-40"
                          >
                            {savingSalaryId === emp.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          </button>
                          <button onClick={() => setEditingSalaryId(null)} className="p-1 text-muted hover:text-ink transition-colors">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 group">
                          <span className="font-mono text-sm text-ink">
                            ${emp.salaryAmount.toLocaleString()}
                          </span>
                          <button
                            onClick={() => { setSalaryDraft(String(emp.salaryAmount)); setEditingSalaryId(emp.id); }}
                            className="p-1 text-faint hover:text-gold transition-colors opacity-0 group-hover:opacity-100"
                            title="Edit salary"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {hasSplits ? <span className="text-faint">—</span> : (
                        <code className="font-mono text-xs text-muted">
                          {emp.settleAddress.slice(0, 8)}…{emp.settleAddress.slice(-6)}
                        </code>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-faint">—</span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="text-faint">—</span>
                    </td>
                    <td className="py-3 px-2">
                      <button
                        onClick={() => removeEmployee(emp.id)}
                        disabled={removingId === emp.id}
                        className="p-1.5 text-faint hover:text-red transition-colors disabled:opacity-40"
                        title="Remove employee"
                      >
                        {removingId === emp.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                  </tr>
                  {hasSplits && emp.splits!.map((split, i) => {
                    const isSol = split.asset.toLowerCase() === "sol";
                    const addr = isSol
                      ? (emp.solanaAddress || null)
                      : (split.settleAddress || emp.settleAddress);
                    return (
                    <tr key={`${emp.id}-split-${i}`} className={`bg-white/[0.015] ${i === emp.splits!.length - 1 ? "border-b border-line" : ""}`}>
                      <td className="py-1.5 px-4 pl-8">
                        <span className="font-mono text-[10px] text-faint">↳ split {i + 1}/{emp.splits!.length}</span>
                      </td>
                      <td className="py-1.5 px-4" />
                      <td className="py-1.5 px-4">
                        <span className="inline-flex items-center gap-1.5">
                          <TokenBadge asset={split.asset} />
                          <span className="font-mono text-[10px] text-faint">{split.percent}%</span>
                        </span>
                      </td>
                      <td className="py-1.5 px-4">
                        {isSol ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Image src="/token-sol.svg" alt="Solana" width={14} height={14} className="rounded-full" />
                            <span className="font-mono text-xs text-muted">Solana</span>
                          </span>
                        ) : (
                          <NetworkBadge chainId={split.chain_id} />
                        )}
                      </td>
                      <td className="py-1.5 px-4">
                        <span className="font-mono text-xs text-muted">
                          ${((emp.salaryAmount * split.percent) / 100).toFixed(2)}
                        </span>
                      </td>
                      <td className="py-1.5 px-4 whitespace-nowrap">
                        {addr ? (
                          <>
                            <code className="font-mono text-[10px] text-muted">
                              {addr.slice(0, 8)}…{addr.slice(-6)}
                            </code>
                            {!isSol && !split.settleAddress && (
                              <span className="font-mono text-[9px] text-faint ml-1">(main)</span>
                            )}
                          </>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="py-1.5 px-4" />
                      <td className="py-1.5 px-4" />
                      <td className="py-1.5 px-2" />
                    </tr>
                    );
                  })}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
