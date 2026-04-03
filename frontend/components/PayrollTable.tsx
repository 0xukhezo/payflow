"use client";

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { WorldIdBadge } from "./WorldIdBadge";
import { API_URL } from "@/lib/contracts";
import { getNetworkByChainId } from "@/lib/networks";
import { useToast } from "@/components/Toast";
import { Loader2, Plus, Trash2, Pencil, Check, X } from "lucide-react";


interface Employee {
  id: string;
  name: string;
  preferredAsset: string;
  preferredChainId?: number;
  settleAddress: string;
  salaryAmount: number;
  worldIdVerified?: boolean;
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
  const [ensNames, setEnsNames] = useState<Map<string, string>>(new Map());
  const [editingSalaryId, setEditingSalaryId] = useState<string | null>(null);
  const [salaryDraft, setSalaryDraft] = useState("");
  const [savingSalaryId, setSavingSalaryId] = useState<string | null>(null);

  useEffect(() => {
    if (!employees.length) return;
    const sepoliaProvider = new ethers.JsonRpcProvider(
      "https://ethereum-sepolia-rpc.publicnode.com",
      { chainId: 11155111, name: "sepolia", ensAddress: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" }
    );
    const addresses = employees.map((e) => e.settleAddress).filter(Boolean);
    Promise.all(
      addresses.map(async (addr) => {
        try {
          const name = await sepoliaProvider.lookupAddress(addr);
          return [addr, name] as [string, string | null];
        } catch {
          return [addr, null] as [string, null];
        }
      })
    ).then((entries) => {
      const map = new Map<string, string>();
      for (const [addr, name] of entries) {
        if (name) map.set(addr.toLowerCase(), name);
      }
      setEnsNames(map);
    });
  }, [employees]);

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
                const rowClass = !emp.worldIdVerified
                  ? "border-b border-line opacity-50"
                  : "border-b border-line hover:bg-white/[0.02] transition-colors";

                return (
                  <tr key={emp.id} className={rowClass}>
                    <td className="py-3 px-4 text-ink font-medium">{emp.name}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <WorldIdBadge verified={emp.worldIdVerified ?? false} />
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-mono text-xs text-gold tracking-widest">
                        {emp.preferredAsset.toLowerCase() === "eth" ? "WETH" : emp.preferredAsset.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-mono text-xs text-muted">
                        {getNetworkByChainId(emp.preferredChainId ?? 11155111)?.shortName ?? "Sepolia"}
                      </span>
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
                      {(() => {
                        const ens = ensNames.get(emp.settleAddress.toLowerCase());
                        return ens ? (
                          <div>
                            <div className="font-mono text-xs text-ink">{ens}</div>
                            <div className="font-mono text-[10px] text-faint">
                              {emp.settleAddress.slice(0, 6)}…{emp.settleAddress.slice(-4)}
                            </div>
                          </div>
                        ) : (
                          <code className="font-mono text-xs text-muted">
                            {emp.settleAddress.slice(0, 8)}…{emp.settleAddress.slice(-6)}
                          </code>
                        );
                      })()}
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
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
