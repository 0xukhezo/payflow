"use client";

import { useState, useEffect, useRef } from "react";
import { useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import type { Eip1193Provider } from "ethers";
import { ethers } from "ethers";
import { createPublicClient, http, parseAbi } from "viem";
import { sepolia, arbitrum, base } from "viem/chains";
import { AuthGate } from "@/components/AuthGate";
import { AppNav } from "@/components/AppNav";
import { WalletCard } from "@/components/WalletCard";
import { AssetSelector } from "@/components/AssetSelector";
import { NetworkSelector } from "@/components/NetworkSelector";
import { PayrollTable } from "@/components/PayrollTable";
import { API_URL } from "@/lib/contracts";
import { useToast } from "@/components/Toast";
import { useNetworkMode } from "@/lib/network-mode";
import { getNetworkByChainId, NETWORK_MODE_CONFIG } from "@/lib/networks";
import { friendlyError } from "@/lib/errors";
import {
  Loader2,
  CheckCircle,
  ShieldCheck,
  Zap,
  XCircle,
  AlertTriangle,
  ExternalLink,
  UserPlus,
  X,
} from "lucide-react";

const USDC_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

// PayrollTrigger — on-chain CRE entry point (deployed on Sepolia)
const PAYROLL_TRIGGER_ADDRESS = "0x0831Cb0C52438FB25Ea4D328454ec8a8BDfD9E44";
const PAYROLL_TRIGGER_ABI = parseAbi([
  "function requestPayroll(address treasury, uint256 depositChainId) external",
]);

function getViemChain(chainId: number) {
  if (chainId === 42161) return arbitrum;
  if (chainId === 8453) return base;
  return sepolia;
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
  preferredChainId: number;
  settleAddress: string;
  solanaAddress?: string | null;
  salaryAmount: number;
  splits?: PayrollSplit[];
}

interface Company {
  id: string;
  name: string;
  walletAddress: string;
  paymentAsset: string;
  chainId: number;
  employees: Employee[];
}

const INPUT =
  "w-full px-3 py-2 bg-overlay border border-rim text-ink font-ui text-sm placeholder:text-placeholder";

export default function CompanyPage() {
  const { address, isConnected, status } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider<Eip1193Provider>("eip155");
  const primaryWallet = isConnected && address ? { address } : null;
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);
  const sdkHasLoaded = mounted && status !== "connecting";
  const toast = useToast();
  const {
    mode: networkMode,
    supportedNetworks,
    defaultNetwork,
    setMode,
  } = useNetworkMode();
  const [company, setCompany] = useState<Company | null>(null);
  const [treasuryBalance, setTreasuryBalance] = useState("0.000000");
  const [onboardPaymentAsset, setOnboardPaymentAsset] = useState("usdc");
  const [relayerAddress, setRelayerAddress] = useState<string | null>(null);
  const [isApproved, setIsApproved] = useState<boolean | null>(null);
  const [approving, setApproving] = useState(false);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [onboardChainId, setOnboardChainId] = useState(
    () => defaultNetwork.chainId,
  );
  const [onboardError, setOnboardError] = useState<string | null>(null);
  const [addingEmployee, setAddingEmployee] = useState(false);
  const [empForm, setEmpForm] = useState({
    name: "",
    preferredAsset: "usdt",
    preferredChainId: defaultNetwork.chainId,
    settleAddress: "",
    salaryAmount: "",
  });
  const [empError, setEmpError] = useState<string | null>(null);
  const [empLoading, setEmpLoading] = useState(false);
  const pollingRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const [payrollRunning, setPayrollRunning] = useState(false);
  const [payrollResult, setPayrollResult] = useState<{
    paid: number;
    skipped: number;
    results: {
      employeeId: string;
      employeeName: string;
      skipped: boolean;
      reason?: string;
      shiftId?: string;
      depositAsset?: string;
      depositAmount?: number;
      depositChainId?: number;
      settleAmount?: number | string;
      settleAsset?: string;
      settleChainId?: number;
      isTwoHop?: boolean;
      provider?: string;
      transferTxHash?: string;
      explorerUrl?: string;
      status?: string;
    }[];
  } | null>(null);
  const [showPayrollModal, setShowPayrollModal] = useState(false);
  const [payrollSteps, setPayrollSteps] = useState<
    {
      id: string;
      label: string;
      status: string;
      txHash?: string;
      explorerUrl?: string;
      chainId?: number;
      empId?: string;
      empName?: string;
      attestation?: {
        swapRate: number;
        chainlinkPrice: number | null;
        deviationPercent: string;
        toleranceBps: number;
        withinRange: boolean;
        settleCoin: string;
      };
    }[]
  >([]);
  const [payrollError, setPayrollError] = useState<string | null>(null);

  // Join requests (employee-initiated)
  interface JoinRequest {
    id: string;
    employeeName: string;
    employeeAddress: string;
    preferredAsset: string;
    preferredChainId: number;
    solanaAddress: string | null;
    createdAt: string;
  }
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [acceptingRequest, setAcceptingRequest] = useState<JoinRequest | null>(null);
  const [acceptSalary, setAcceptSalary] = useState("");
  const [acceptLoading, setAcceptLoading] = useState(false);

  useEffect(() => {
    if (!primaryWallet) return;
    const id = localStorage.getItem(
      `payflow_company_id_${primaryWallet.address.toLowerCase()}`,
    );
    if (id) {
      setCompanyLoading(true);
      fetchCompany(id)
        .then(() => fetchJoinRequests(id))
        .finally(() => setCompanyLoading(false));
    }
  }, [primaryWallet?.address]);

  useEffect(() => {
    if (!company) return;
    const load = async () => {
      try {
        const d = await fetch(
          `${API_URL}/api/company/${company.id}/wallet`,
        ).then((r) => r.json());
        setTreasuryBalance(d.treasuryBalance ?? "0.000000");
        if (d.relayerAddress) {
          setRelayerAddress(d.relayerAddress);
          const net = getNetworkByChainId(company.chainId || 11155111);
          if (net) {
            const viemChain = getViemChain(net.chainId);
            const publicClient = createPublicClient({
              chain: viemChain,
              transport: http(net.rpcUrl),
            });
            const paymentAsset = (company.paymentAsset || "usdc").toLowerCase();
            const tokenAddress = net.tokens[paymentAsset]?.address as
              | `0x${string}`
              | undefined;
            if (tokenAddress) {
              const allowance = await publicClient.readContract({
                address: tokenAddress,
                abi: USDC_ABI,
                functionName: "allowance",
                args: [
                  company.walletAddress as `0x${string}`,
                  d.relayerAddress as `0x${string}`,
                ],
              });
              setIsApproved((allowance as bigint) > BigInt(0));
            }
          }
        }
      } catch {}
    };
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [company]);

  // Poll shift status for two-hop results until second hop + transfer complete
  useEffect(() => {
    if (!payrollResult) return;
    const twoHopResults = payrollResult.results.filter(
      (r) => !r.skipped && r.shiftId && r.isTwoHop,
    );
    if (twoHopResults.length === 0) return;

    const INTERVAL = 15_000;
    const MAX_POLLS = 80;
    const counters: Record<string, number> = {};

    const intervals = twoHopResults.map((r) => {
      counters[r.shiftId!] = 0;
      return setInterval(async () => {
        if (++counters[r.shiftId!] > MAX_POLLS) return;
        try {
          const res = await fetch(`${API_URL}/api/payroll/shift/${r.shiftId}`);
          if (!res.ok) return;
          const data = await res.json();
          const settleNet = getNetworkByChainId(r.settleChainId ?? 8453);

          if (data.secondHopError) {
            setPayrollSteps((prev) =>
              prev.map((s) =>
                s.id === "second_hop"
                  ? { ...s, status: "error", label: data.secondHopError }
                  : s,
              ),
            );
            return; // stop polling — terminal state
          }

          if (data.secondHopTxHash) {
            setPayrollSteps((prev) => {
              const exists = prev.find(
                (s) => s.id === `second_hop_tx_${r.shiftId}`,
              );
              if (exists) return prev;
              return [
                ...prev.map((s) =>
                  s.id === `second_hop_${r.employeeId}`
                    ? {
                        ...s,
                        status: "done",
                        label: `${r.settleAsset} swap on Base confirmed`,
                      }
                    : s,
                ),
                {
                  id: `second_hop_tx_${r.shiftId}`,
                  empId: r.employeeId,
                  empName: r.employeeName,
                  label: `${r.settleAsset} swap on ${settleNet?.shortName ?? "Base"}`,
                  status: "done",
                  txHash: data.secondHopTxHash,
                  chainId: r.settleChainId ?? 8453,
                },
              ];
            });
          }

          if (data.transferTxHash) {
            setPayrollSteps((prev) => {
              const exists = prev.find(
                (s) =>
                  s.id === `transfer_tx_${r.shiftId}` ||
                  s.txHash === data.transferTxHash,
              );
              if (exists) return prev;
              return [
                ...prev,
                {
                  id: `transfer_tx_${r.shiftId}`,
                  empId: r.employeeId,
                  empName: r.employeeName,
                  label: `${r.settleAsset} sent to employee on ${settleNet?.shortName ?? "Base"}`,
                  status: "done",
                  txHash: data.transferTxHash,
                  chainId: r.settleChainId ?? 8453,
                },
              ];
            });
          }
        } catch {
          /* ignore */
        }
      }, INTERVAL);
    });

    return () => intervals.forEach(clearInterval);
  }, [payrollResult]);

  const fetchCompany = async (id: string) => {
    try {
      const res = await fetch(`${API_URL}/api/company/${id}`);
      if (res.ok) setCompany(await res.json());
    } catch {}
  };

  const fetchJoinRequests = async (id: string) => {
    try {
      const r = await fetch(`${API_URL}/api/company/${id}/join-requests`);
      if (r.ok) {
        const d = await r.json();
        setJoinRequests(d.requests || []);
      }
    } catch {}
  };

  const handleAcceptRequest = async () => {
    if (!acceptingRequest || !company) return;
    const salary = Number(acceptSalary);
    if (!salary || salary <= 0) return;
    setAcceptLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/company/${company.id}/join-requests/${acceptingRequest.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salaryAmount: salary }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      await fetchCompany(company.id);
      setJoinRequests((prev) => prev.filter((x) => x.id !== acceptingRequest.id));
      setAcceptingRequest(null);
      setAcceptSalary("");
      toast("success", `${acceptingRequest.employeeName} added to payroll.`);
    } catch (err: unknown) {
      toast("error", friendlyError(err));
    } finally {
      setAcceptLoading(false);
    }
  };

  const handleRejectRequest = async (req: JoinRequest) => {
    if (!company) return;
    try {
      await fetch(`${API_URL}/api/company/${company.id}/join-requests/${req.id}`, { method: "DELETE" });
      setJoinRequests((prev) => prev.filter((x) => x.id !== req.id));
      toast("success", `Request from ${req.employeeName} dismissed.`);
    } catch {}
  };

  // Full-page loading — SDK initializing or company being fetched
  if (!sdkHasLoaded || companyLoading)
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted" />
      </div>
    );

  const handleOnboard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) return;
    setOnboarding(true);
    setOnboardError(null);
    try {
      const res = await fetch(`${API_URL}/api/company/onboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: companyName,
          email: "company@payflow.xyz",
          walletAddress: primaryWallet!.address,
          paymentAsset:
            networkMode === "testnet" ? "usdc" : onboardPaymentAsset,
          chainId: networkMode === "testnet" ? 11155111 : onboardChainId,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      localStorage.setItem(
        `payflow_company_id_${primaryWallet!.address.toLowerCase()}`,
        data.companyId,
      );
      await fetchCompany(data.companyId);
      toast("success", "Company created! Your treasury wallet is ready.");
    } catch (err: unknown) {
      const msg = friendlyError(err);
      setOnboardError(msg);
      toast("error", msg);
    } finally {
      setOnboarding(false);
    }
  };

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;
    if (
      empForm.settleAddress.toLowerCase() ===
      primaryWallet?.address.toLowerCase()
    ) {
      const msg = "The company owner cannot be added as an employee.";
      setEmpError(msg);
      toast("error", msg);
      return;
    }
    setEmpLoading(true);
    setEmpError(null);
    try {
      const res = await fetch(`${API_URL}/api/company/${company.id}/employee`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: empForm.name,
          preferredAsset: empForm.preferredAsset,
          preferredChainId:
            networkMode === "testnet" ? 11155111 : empForm.preferredChainId,
          settleAddress: empForm.preferredAsset === "sol" ? "0x0000000000000000000000000000000000000000" : empForm.settleAddress,
          solanaAddress: empForm.preferredAsset === "sol" ? empForm.settleAddress : undefined,
          salaryAmount: Number(empForm.salaryAmount),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { employeeId } = await res.json();

      await fetchCompany(company.id);
      setEmpForm({
        name: "",
        preferredAsset: "usdt",
        preferredChainId: defaultNetwork.chainId,
        settleAddress: "",
        salaryAmount: "",
      });
      setAddingEmployee(false);
      toast("success", `${empForm.name} added to payroll.`);
    } catch (err: unknown) {
      const msg = friendlyError(err);
      setEmpError(msg);
      toast("error", msg);
    } finally {
      setEmpLoading(false);
    }
  };

  /* ── Auth gate ─────────────────────────────────────────────── */
  if (!primaryWallet)
    return (
      <AuthGate
        sectionLabel="Company Dashboard"
        heading={
          <>
            Sign in to manage
            <br />
            <span className="text-gradient-gold">your treasury.</span>
          </>
        }
        body="Connect with email or an existing wallet to access your payroll dashboard."
      />
    );

  /* ── Onboarding form ───────────────────────────────────────── */
  if (!company)
    return (
      <div className="min-h-screen bg-bg flex flex-col">
        <AppNav />
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
          <div className="w-full max-w-md">
            <div className="section-label mb-3">Step 1 of 1</div>
            <h1 className="text-3xl font-bold mb-6 font-heading text-ink">
              Set up your company
            </h1>
            <p className="mb-8 font-mono text-xs text-muted">
              Connected as:{" "}
              <span className="text-gold">
                {primaryWallet.address.slice(0, 8)}…
              </span>
            </p>
            <form onSubmit={handleOnboard} className="space-y-4">
              <div>
                <div className="section-label mb-1">Company name</div>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme Corp"
                  className={INPUT}
                />
              </div>
              {networkMode === "mainnet" ? (
                <>
                  <NetworkSelector
                    networks={supportedNetworks}
                    value={onboardChainId}
                    onChange={(chainId) => {
                      setOnboardChainId(chainId);
                      setOnboardPaymentAsset("usdc");
                    }}
                    label="Treasury network"
                  />
                  <div>
                    <div className="section-label mb-1">Treasury asset</div>
                    <AssetSelector
                      value={onboardPaymentAsset}
                      onChange={setOnboardPaymentAsset}
                      chainId={onboardChainId}
                      evmOnly
                    />
                  </div>
                </>
              ) : (
                <div className="px-3 py-2 bg-overlay border border-rim font-mono text-xs text-muted">
                  Network: <span className="text-ink">Sepolia</span> · Asset:{" "}
                  <span className="text-ink">USDC</span>
                </div>
              )}
              {onboardError && (
                <p className="font-mono text-xs text-red">{onboardError}</p>
              )}
              <button
                type="submit"
                disabled={onboarding}
                className="w-full flex items-center justify-center gap-2 py-3 bg-gold text-paper font-mono text-xs font-bold tracking-widest transition-all hover:brightness-110 disabled:opacity-40"
              >
                {onboarding && <Loader2 className="w-4 h-4 animate-spin" />}
                {onboarding ? "CREATING..." : "CREATE COMPANY WALLET →"}
              </button>
            </form>
          </div>
        </div>
      </div>
    );

  const handleApprove = async () => {
    const spender =
      relayerAddress || "0x982997a10b6d0672f359Cb35c34E5E8a26C87b7d";
    if (!primaryWallet || !company || !walletProvider) return;
    const net = getNetworkByChainId(company.chainId || 11155111);
    const paymentAsset = (company.paymentAsset || "usdc").toLowerCase();
    if (!net?.tokens[paymentAsset]) {
      toast(
        "error",
        `${paymentAsset.toUpperCase()} not supported on this network.`,
      );
      return;
    }
    const usdcAddress = net.tokens[paymentAsset].address;
    const viemChain = getViemChain(net.chainId);
    setApproving(true);
    try {
      const provider = new ethers.BrowserProvider(walletProvider);
      // Switch to correct chain — ignore errors (embedded wallets may not need it)
      try {
        await provider.send("wallet_switchEthereumChain", [
          { chainId: `0x${viemChain.id.toString(16)}` },
        ]);
      } catch {}
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(
        usdcAddress,
        ["function approve(address spender, uint256 amount) returns (bool)"],
        signer,
      );
      const tx = await contract.approve(spender, ethers.MaxUint256);

      toast("success", `Approval submitted! Tx: ${tx.hash.slice(0, 10)}…`);
      setIsApproved(true);
    } catch (err: unknown) {
      toast("error", friendlyError(err));
    } finally {
      setApproving(false);
    }
  };

  // Merge a step into the payrollSteps list (upsert by id)
  const applyStep = (step: (typeof payrollSteps)[number]) => {
    setPayrollSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === step.id);
      if (idx >= 0) { const u = [...prev]; u[idx] = step; return u; }
      return [...prev, step];
    });
  };

  // Start polling /api/payroll/:id/status (used when CRE runs on the live DON)
  const startPolling = (companyId: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${API_URL}/api/payroll/${companyId}/status`);
        const data = await r.json();

        // Sync every step we've received so far
        for (const step of data.steps ?? []) applyStep(step);

        if (data.status === "done") {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          const results = data.results ?? [];
          const paid    = results.filter((r: { skipped: boolean }) => !r.skipped).length;
          const skipped = results.filter((r: { skipped: boolean }) => r.skipped).length;
          setPayrollResult({ paid, skipped, results });
          setPayrollRunning(false);
          toast("success", `Payroll sent to ${paid} employee${paid !== 1 ? "s" : ""}.`);
        } else if (data.status === "error") {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          setPayrollSteps((prev) =>
            prev.map((s) => s.status === "running" ? { ...s, status: "error" } : s),
          );
          setPayrollError(data.error ?? "Payroll failed");
          setPayrollRunning(false);
          toast("error", data.error ?? "Payroll failed");
        }
      } catch {
        /* network hiccup — keep polling */
      }
    }, 5_000);
  };

  const handleRunPayroll = async () => {
    if (!company) return;
    setPayrollRunning(true);
    setPayrollResult(null);
    setPayrollSteps([]);
    setPayrollError(null);
    setShowPayrollModal(true);
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }

    // ── Step 0: emit PayrollRequested on-chain via PayrollTrigger ────────────
    // This creates the on-chain trigger record that the CRE DON listens for.
    // Locally we then run the CRE simulation to replicate what the DON would do.
    if (walletProvider && company.walletAddress) {
      applyStep({ id: "onchain_trigger", label: "Submitting on-chain payroll request to Sepolia…", status: "running" });
      try {
        const provider = new ethers.BrowserProvider(walletProvider);
        // PayrollTrigger is on Sepolia — switch wallet to Sepolia before signing
        try {
          await provider.send("wallet_switchEthereumChain", [{ chainId: "0xaa36a7" }]);
        } catch { /* wallet may not need a switch */ }
        const signer          = await provider.getSigner();
        const triggerContract = new ethers.Contract(PAYROLL_TRIGGER_ADDRESS, [
          "function requestPayroll(address treasury, uint256 depositChainId) external",
        ], signer);
        const tx      = await triggerContract.requestPayroll(company.walletAddress, BigInt(company.chainId || 11155111));
        const receipt = await tx.wait();
        applyStep({
          id:          "onchain_trigger",
          label:       "On-chain trigger confirmed — CRE DON event emitted ✓",
          status:      "done",
          txHash:      receipt.hash,
          chainId:     11155111,
          explorerUrl: `https://sepolia.etherscan.io/tx/${receipt.hash}`,
        });
      } catch (triggerErr: unknown) {
        const msg = triggerErr instanceof Error ? triggerErr.message : String(triggerErr);
        const isRejected = msg.toLowerCase().includes("rejected") || msg.toLowerCase().includes("denied") || msg.toLowerCase().includes("cancel");
        applyStep({
          id:     "onchain_trigger",
          label:  isRejected ? "On-chain trigger cancelled — sign the transaction to proceed" : `On-chain trigger failed: ${msg.slice(0, 80)}`,
          status: "error",
        });
        setPayrollError(isRejected ? "Transaction rejected. Sign the on-chain request to run payroll." : `On-chain trigger failed: ${msg.slice(0, 100)}`);
        setPayrollRunning(false);
        return;
      }
    }

    try {
      const response = await fetch(
        `${API_URL}/api/payroll/${company.id}/run-stream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ networkMode }),
        },
      );
      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "step") {
              applyStep({
                id:          event.id,
                label:       event.label,
                status:      event.status,
                txHash:      event.txHash,
                explorerUrl: event.explorerUrl,
                chainId:     event.chainId,
                empId:       event.empId,
                empName:     event.empName,
                attestation: event.attestation,
              });
            } else if (event.type === "pending") {
              // CRE is running on the live DON — switch to polling
              reader.cancel();
              startPolling(company.id);
              return; // exit the SSE loop; polling takes over
            } else if (event.type === "done") {
              const paid    = (event.results ?? []).filter((r: { skipped: boolean }) => !r.skipped).length;
              const skipped = (event.results ?? []).filter((r: { skipped: boolean }) => r.skipped).length;
              setPayrollResult({ paid, skipped, results: event.results ?? [] });
              toast("success", `Payroll sent to ${paid} employee${paid !== 1 ? "s" : ""}.`);
            } else if (event.type === "error") {
              setPayrollSteps((prev) =>
                prev.map((s) => s.status === "running" ? { ...s, status: "error", label: s.label.replace(/\.\.\.$/, "") } : s),
              );
              setPayrollError(event.message);
              toast("error", event.message);
            }
          } catch {
            /* ignore parse errors */
          }
        }
      }
    } catch (err: unknown) {
      const msg = friendlyError(err);
      setPayrollSteps((prev) =>
        prev.map((s) => s.status === "running" ? { ...s, status: "error", label: s.label.replace(/\.\.\.$/, "") } : s),
      );
      setPayrollError(msg);
      toast("error", msg);
    } finally {
      // Only clear running state if we're NOT in polling mode
      if (!pollingRef.current) setPayrollRunning(false);
    }
  };

  const handleSettleAddressChange = (value: string) => {
    setEmpForm((f) => ({ ...f, settleAddress: value }));
  };

  const closeModal = () => {
    setAddingEmployee(false);
    setEmpForm({
      name: "",
      preferredAsset: "usdt",
      preferredChainId: defaultNetwork.chainId,
      settleAddress: "",
      salaryAmount: "",
    });
    setEmpError(null);
  };

  /* ── Main dashboard ────────────────────────────────────────── */
  const isNetworkMismatch = !supportedNetworks.some(
    (n) => n.chainId === company.chainId,
  );
  const requiredMode = NETWORK_MODE_CONFIG.mainnet.networks.some(
    (n) => n.chainId === company.chainId,
  )
    ? ("mainnet" as const)
    : ("testnet" as const);
  const companyNet = getNetworkByChainId(company.chainId || 11155111);

  if (isNetworkMismatch)
    return (
      <div className="min-h-screen bg-bg flex flex-col">
        <AppNav label={company.name} />
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
          <div className="w-full max-w-sm text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 border border-gold/30 bg-gold/5 mb-6">
              <AlertTriangle className="w-5 h-5 text-gold" />
            </div>
            <div className="font-mono text-[10px] text-gold tracking-widest mb-3">
              NETWORK MISMATCH
            </div>
            <h1 className="font-heading text-2xl font-bold text-ink mb-3">
              Wrong network mode
            </h1>
            <p className="font-mono text-xs text-muted leading-relaxed mb-8">
              This company is on{" "}
              <span className="text-ink">
                {companyNet?.shortName ?? "unknown"}
              </span>
              . Switch to <span className="text-ink">{requiredMode}</span> mode
              to access your dashboard.
            </p>
            <button
              onClick={() => setMode(requiredMode)}
              className="w-full py-3 bg-gold text-paper font-mono text-xs font-bold tracking-widest transition-all hover:brightness-110"
            >
              SWITCH TO {requiredMode.toUpperCase()} →
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-bg">
      <AppNav label={company.name} />

      <div className="max-w-6xl mx-auto px-8 py-10">
        {/* Top row: Treasury + XRPL trigger side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 mb-8 items-stretch">
          <WalletCard
            address={company.walletAddress}
            balance={treasuryBalance}
            label={`Treasury Wallet · ${getNetworkByChainId(company.chainId || 11155111)?.shortName ?? "Sepolia"} ${(company.paymentAsset || "USDC").toUpperCase()}`}
          />

          {/* Run Payroll */}
          <div
            className={`bg-surface border border-line p-6 flex flex-col justify-between gap-6 min-w-[280px] relative ${company.employees.length === 0 ? "opacity-50 pointer-events-none select-none" : ""}`}
          >
            {company.employees.length === 0 && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface/80 backdrop-blur-[2px]">
                <AlertTriangle className="w-4 h-4 text-gold" />
                <p className="font-mono text-xs text-muted text-center px-4">
                  Add employees before running payroll
                </p>
              </div>
            )}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-gold" />
                <div className="font-heading text-sm font-bold text-ink">
                  Run Payroll
                </div>
              </div>
              <p className="font-mono text-xs text-muted leading-relaxed">
                Execute payroll for all World ID verified
                <br />
                employees in one transaction.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              {payrollResult && (
                <div className="p-2.5 border border-teal/30 bg-teal/5 font-mono text-[10px] space-y-0.5">
                  <div className="flex items-center gap-1.5 text-teal font-bold">
                    <CheckCircle className="w-3 h-3" /> Payroll executed
                  </div>
                  <div className="text-muted">
                    Paid: <span className="text-ink">{payrollResult.paid}</span>
                    {payrollResult.skipped > 0 && (
                      <>
                        {" "}
                        · Skipped:{" "}
                        <span className="text-ink">
                          {payrollResult.skipped}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}
              <button
                onClick={() => handleRunPayroll()}
                disabled={payrollRunning || isApproved === false}
                title={
                  isApproved === false
                    ? `Approve ${(company.paymentAsset || "USDC").toUpperCase()} first`
                    : "Run payroll with Chainlink rate verification"
                }
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-gold text-paper font-mono text-xs font-bold tracking-widest transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {payrollRunning ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5" />
                )}
                {payrollRunning ? "RUNNING..." : "RUN VIA CHAINLINK CRE →"}
              </button>
            </div>
          </div>
        </div>

        {/* USDC Approval — only show once check resolves to false */}
        {isApproved === false && (
          <div className="bg-surface border border-line p-5 mb-8 flex items-center justify-between gap-4">
            <div>
              <div className="section-label mb-1">Payroll Authorization</div>
              <p className="font-mono text-xs text-muted">
                Approve the relayer once so it can pull{" "}
                {(company.paymentAsset || "USDC").toUpperCase()} when payroll
                runs.
              </p>
            </div>
            <button
              onClick={handleApprove}
              disabled={approving}
              className="shrink-0 inline-flex items-center gap-2 px-5 py-2.5 bg-gold text-paper font-mono text-xs font-bold tracking-widest transition-all hover:brightness-110 disabled:opacity-40"
            >
              {approving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5" />
              )}
              {approving
                ? "APPROVING..."
                : `APPROVE ${(company.paymentAsset || "USDC").toUpperCase()} →`}
            </button>
          </div>
        )}

        {/* Pending join requests */}
        {joinRequests.length > 0 && (
          <div className="mt-4 bg-surface border border-gold/40">
            <div className="px-6 py-4 border-b border-gold/20 flex items-center gap-3">
              <UserPlus className="w-4 h-4 text-gold" />
              <div className="flex-1">
                <div className="font-mono text-[10px] text-gold tracking-widest">PENDING</div>
                <div className="font-heading text-sm font-bold text-ink">
                  {joinRequests.length} Join Request{joinRequests.length > 1 ? "s" : ""}
                </div>
              </div>
            </div>
            <div className="divide-y divide-line">
              {joinRequests.map((req) => (
                <div key={req.id} className="px-6 py-4 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <table className="w-full text-left border-collapse">
                      <tbody>
                        <tr>
                          <td className="font-mono text-[10px] text-muted pr-4 py-0.5 w-20 shrink-0">Name</td>
                          <td className="font-heading text-sm font-bold text-ink">{req.employeeName}</td>
                        </tr>
                        <tr>
                          <td className="font-mono text-[10px] text-muted pr-4 py-0.5">Address</td>
                          <td className="font-mono text-[10px] text-ink break-all">{req.employeeAddress}</td>
                        </tr>
                        {req.solanaAddress && (
                          <tr>
                            <td className="font-mono text-[10px] text-muted pr-4 py-0.5">Solana</td>
                            <td className="font-mono text-[10px] text-ink break-all">{req.solanaAddress}</td>
                          </tr>
                        )}
                        <tr>
                          <td className="font-mono text-[10px] text-muted pr-4 py-0.5">Asset</td>
                          <td className="font-mono text-[10px] text-muted">{req.preferredAsset.toUpperCase()}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 mt-1">
                    <button
                      onClick={() => { setAcceptingRequest(req); setAcceptSalary(""); }}
                      className="px-3 py-1.5 bg-gold text-paper font-mono text-[10px] font-bold tracking-widest hover:brightness-110 transition-all"
                    >
                      ACCEPT
                    </button>
                    <button
                      onClick={() => handleRejectRequest(req)}
                      className="p-1.5 text-muted hover:text-red transition-colors"
                      title="Dismiss"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 bg-surface border border-line">
          <div className="px-6 py-4 border-b border-line">
            <div className="section-label mb-1">Payroll</div>
            <div className="font-heading text-base font-bold text-ink">Employees</div>
          </div>
          <div className="p-6">
            <PayrollTable
              employees={company.employees}
              companyId={company.id}
              onAddEmployee={() => setAddingEmployee(true)}
              onEmployeeRemoved={() => fetchCompany(company.id)}
              onSalaryUpdated={() => fetchCompany(company.id)}
            />
          </div>
        </div>
      </div>

      {/* Payroll Progress Modal */}
      {showPayrollModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full bg-surface border border-rim" style={{ maxWidth: '498px' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-line">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-gold" />
                <div className="font-heading text-sm font-bold text-ink">
                  Payroll
                </div>
              </div>
              {!payrollRunning && (
                <button
                  onClick={() => setShowPayrollModal(false)}
                  className="text-muted hover:text-ink transition-colors font-mono text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Steps */}
            <div className="px-6 py-5 space-y-4 min-h-[200px] max-h-[520px] overflow-y-auto">
              {payrollSteps.length === 0 && (
                <div className="flex items-center gap-2 text-muted font-mono text-xs">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />{" "}
                  Initializing...
                </div>
              )}
              {(() => {
                const ORDER: Record<string, number> = {
                  // On-chain trigger
                  onchain_trigger: -1,
                  // CRE verification phase
                  cre_verify:    0,
                  cre_chainlink: 1,
                  cre_peg:       2,
                  cre_attest:    3,
                  // Execution phase
                  preflight: 10,
                  attest:    11,
                  treasury:  12,
                  usdc:      12,
                  swap:      13,
                  second_hop: 14,
                  transfer:  15,
                };
                const rank = (id: string) => {
                  const k = Object.keys(ORDER).find(
                    (k) => id === k || id.startsWith(k + "_"),
                  );
                  return k ? ORDER[k] : 99;
                };
                const sorted = [...payrollSteps].sort(
                  (a, b) => rank(a.id) - rank(b.id),
                );
                const isCreStep = (id: string) => id.startsWith("cre_");
                const sharedSteps = sorted.filter((s) => !s.empId);
                const empIds = [
                  ...new Set(
                    sorted.filter((s) => s.empId).map((s) => s.empId!),
                  ),
                ];

                const renderStep = (step: (typeof payrollSteps)[0]) => {
                  const companyNet = getNetworkByChainId(company.chainId);
                  const stepNet = step.chainId
                    ? getNetworkByChainId(step.chainId)
                    : null;
                  const href = step.explorerUrl
                    ? step.explorerUrl
                    : stepNet
                      ? `${stepNet.explorer}/tx/${step.txHash}`
                      : `${companyNet?.explorer ?? "https://arbiscan.io"}/tx/${step.txHash}`;
                  return (
                    <div key={step.id} className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0">
                        {step.status === "running" && (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-gold" />
                        )}
                        {step.status === "done" && (
                          <CheckCircle className="w-3.5 h-3.5 text-teal" />
                        )}
                        {step.status === "error" && (
                          <XCircle className="w-3.5 h-3.5 text-red" />
                        )}
                        {step.status === "warn" && (
                          <AlertTriangle className="w-3.5 h-3.5 text-gold" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`font-mono text-xs ${step.status === "error" ? "text-red" : step.status === "done" ? "text-ink" : "text-muted"}`}
                          >
                            {step.label}
                          </span>
                        </div>
                        {step.attestation && (
                          <div className="mt-1.5 px-2 py-1.5 bg-overlay border border-line space-y-0.5">
                            <div className="font-mono text-[10px] text-muted">
                              <span className="text-ink/60">Swap rate</span>{" "}
                              {Number(step.attestation.swapRate).toFixed(8)}{" "}
                              {step.attestation.settleCoin.toUpperCase()}/USDC
                            </div>
                            {step.attestation.chainlinkPrice != null && !["usdc","usdt","dai"].includes(step.attestation.settleCoin.toLowerCase()) && (
                              <div className="font-mono text-[10px] text-muted">
                                <span className="text-ink/60">Implied</span>{" "}
                                <span className="text-ink">${(1 / Number(step.attestation.swapRate)).toFixed(2)}</span>
                                <span className="text-muted/60"> / {step.attestation.settleCoin.toUpperCase()} (Uniswap)</span>
                              </div>
                            )}
                            {step.attestation.chainlinkPrice != null && (
                              <div className="font-mono text-[10px] text-muted">
                                <span className="text-gold/70">Chainlink</span>{" "}
                                ${Number(step.attestation.chainlinkPrice).toFixed(2)}
                                <span className="text-muted/60"> / {step.attestation.settleCoin.toUpperCase()}</span>
                              </div>
                            )}
                            <div className="font-mono text-[10px] flex items-center gap-2">
                              <span>
                                <span className="text-ink/60">Deviation</span>{" "}
                                <span className={step.attestation.withinRange ? "text-teal" : "text-red"}>
                                  {step.attestation.deviationPercent}%
                                </span>
                              </span>
                              <span className="text-muted">·</span>
                              <span className="text-ink/60">
                                tolerance {(step.attestation.toleranceBps / 100).toFixed(0)}%
                              </span>
                              <span className={`ml-auto font-bold tracking-wider text-[9px] px-1.5 py-0.5 border ${step.attestation.withinRange ? "border-teal/40 text-teal" : "border-red/40 text-red"}`}>
                                {step.attestation.withinRange ? "PASS" : "FAIL"}
                              </span>
                            </div>
                          </div>
                        )}
                        {(step.txHash || step.explorerUrl) && (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 mt-0.5 hover:opacity-80 transition-opacity"
                          >
                            <span className="font-mono text-[10px] text-muted truncate">
                              {step.explorerUrl && !step.txHash
                                ? "View on SideShift →"
                                : `${step.txHash!.slice(0, 20)}…`}
                            </span>
                            <ExternalLink className="w-2.5 h-2.5 text-muted shrink-0" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                };

                // Split shared steps into CRE phase and execution phase
                const creShared  = sharedSteps.filter((s) => isCreStep(s.id));
                const execShared = sharedSteps.filter((s) => !isCreStep(s.id));
                // CRE per-employee steps (cre_attest_*)
                const creEmpIds  = [...new Set(sorted.filter((s) => isCreStep(s.id) && s.empId).map((s) => s.empId!))];
                // Execution per-employee steps
                const execEmpIds = [...new Set(sorted.filter((s) => !isCreStep(s.id) && s.empId).map((s) => s.empId!))];

                const SectionDivider = ({ label }: { label: string }) => (
                  <div className="flex items-center gap-2 py-1">
                    <div className="flex-1 h-px bg-line" />
                    <span className="font-mono text-[9px] text-muted/60 tracking-widest uppercase">{label}</span>
                    <div className="flex-1 h-px bg-line" />
                  </div>
                );

                return (
                  <>
                    {/* ── CRE Verification Phase ── */}
                    {(creShared.length > 0 || creEmpIds.length > 0) && (
                      <>
                        <SectionDivider label="Chainlink CRE · Verification" />
                        {creShared.map(renderStep)}
                        {creEmpIds.map((empId) => {
                          const empSteps = sorted.filter((s) => isCreStep(s.id) && s.empId === empId);
                          const empName  = empSteps[0]?.empName ?? empId;
                          return (
                            <div key={empId} className="space-y-4">
                              {creEmpIds.length > 1 && (
                                <div className="flex items-center gap-2 py-1 mt-1">
                                  <div className="flex-1 h-px bg-line" />
                                  <span className="font-mono text-[10px] text-muted tracking-widest uppercase">{empName}</span>
                                  <div className="flex-1 h-px bg-line" />
                                </div>
                              )}
                              {empSteps.map(renderStep)}
                            </div>
                          );
                        })}
                      </>
                    )}

                    {/* ── Execution Phase ── */}
                    {(execShared.length > 0 || execEmpIds.length > 0) && (
                      <>
                        {(creShared.length > 0 || creEmpIds.length > 0) && (
                          <SectionDivider label="Uniswap · Execution" />
                        )}
                        {execShared.map(renderStep)}
                        {execEmpIds.map((empId) => {
                          const empSteps = sorted.filter((s) => !isCreStep(s.id) && s.empId === empId);
                          const empName  = empSteps[0]?.empName ?? empId;
                          return (
                            <div key={empId} className="space-y-4">
                              {execEmpIds.length > 1 && (
                                <div className="flex items-center gap-2 py-1 mt-1">
                                  <div className="flex-1 h-px bg-line" />
                                  <span className="font-mono text-[10px] text-muted tracking-widest uppercase">{empName}</span>
                                  <div className="flex-1 h-px bg-line" />
                                </div>
                              )}
                              {empSteps.map(renderStep)}
                            </div>
                          );
                        })}
                      </>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Footer — result or loading */}
            <div className="px-6 pb-5 space-y-3">
              {payrollError && !payrollRunning && !payrollResult && (
                <>
                  <div className="flex items-start gap-2.5 p-3 border border-red/25 bg-red/5">
                    <XCircle className="w-3.5 h-3.5 text-red shrink-0 mt-0.5" />
                    <p className="font-mono text-xs text-red leading-relaxed">
                      {payrollError}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowPayrollModal(false)}
                    className="w-full py-2.5 border border-rim text-muted font-mono text-xs tracking-widest hover:border-muted transition-colors"
                  >
                    CLOSE
                  </button>
                </>
              )}
              {payrollResult && !payrollRunning ? (
                <>
                  {/* Result cards */}
                  <div className="space-y-2 max-h-64 overflow-y-auto mb-1">
                    {payrollResult.results.map((r, i) => {
                      const settleNet = r.settleChainId ? getNetworkByChainId(r.settleChainId) : undefined;
                      const depositNet = r.depositChainId ? getNetworkByChainId(r.depositChainId) : undefined;
                      // Determine best tx link
                      const txHash = r.shiftId?.startsWith("0x") && r.shiftId.length === 66 ? r.shiftId : r.transferTxHash;
                      const txNet  = txHash ? (r.settleChainId ? settleNet : depositNet) : undefined;
                      const txHref = r.explorerUrl ?? (txHash && txNet ? `${txNet.explorer}/tx/${txHash}` : undefined);
                      const providerLabel = r.provider === "sideshift" ? "SideShift" : r.isTwoHop ? "Bridge" : "Uniswap";
                      return (
                        <div key={`${r.employeeId}-${i}`} className={`px-3 py-2.5 border ${r.skipped ? "border-line bg-overlay/40" : "border-teal/20 bg-teal/5"}`}>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="font-mono text-xs text-ink font-medium truncate">{r.employeeName}</span>
                            <span className={`font-mono text-[9px] tracking-wider px-1.5 py-0.5 border shrink-0 ${r.skipped ? "border-line text-muted" : r.status === "failed" ? "border-red/30 text-red" : "border-teal/40 text-teal"}`}>
                              {r.skipped ? "SKIPPED" : r.status === "failed" ? "FAILED" : r.status === "processing" ? "PROCESSING" : "SETTLED"}
                            </span>
                          </div>
                          {r.skipped ? (
                            <p className="font-mono text-[10px] text-muted">{r.reason ?? "Skipped"}</p>
                          ) : (
                            <>
                              <div className="font-mono text-[10px] text-muted flex items-center gap-1.5 flex-wrap">
                                <span className="text-ink">{Number(r.settleAmount).toFixed(6)} {r.settleAsset}</span>
                                {settleNet && <><span>·</span><span>{settleNet.shortName}</span></>}
                                <span>·</span>
                                <span className="text-gold/80">{providerLabel}</span>
                              </div>
                              {txHref && (
                                <a href={txHref} target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-1 mt-1 hover:opacity-80 transition-opacity">
                                  <span className="font-mono text-[10px] text-muted truncate">
                                    {txHash ? `${txHash.slice(0, 18)}…` : "View transaction"}
                                  </span>
                                  <ExternalLink className="w-2.5 h-2.5 text-muted shrink-0" />
                                </a>
                              )}
                              {r.isTwoHop && r.transferTxHash && r.settleChainId && (
                                <a href={`${settleNet?.explorer}/tx/${r.transferTxHash}`} target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-1 mt-0.5 hover:opacity-80 transition-opacity">
                                  <span className="font-mono text-[10px] text-muted truncate">
                                    Delivery: {r.transferTxHash.slice(0, 18)}…
                                  </span>
                                  <ExternalLink className="w-2.5 h-2.5 text-muted shrink-0" />
                                </a>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setShowPayrollModal(false)}
                    className="w-full py-2.5 border border-rim text-muted font-mono text-xs tracking-widest hover:border-muted transition-colors"
                  >
                    CLOSE
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Accept Join Request Modal */}
      {acceptingRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm bg-surface border border-rim">
            <div className="px-6 py-4 border-b border-line flex items-center justify-between">
              <div className="font-heading text-sm font-bold text-ink">Accept Request</div>
              <button onClick={() => setAcceptingRequest(null)} className="text-muted hover:text-ink transition-colors font-mono text-sm">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="px-3 py-2.5 bg-overlay border border-rim space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-muted">Name</span>
                  <span className="font-heading text-sm font-bold text-ink">{acceptingRequest.employeeName}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-muted">Address</span>
                  <span className="font-mono text-[10px] text-ink">{acceptingRequest.employeeAddress.slice(0, 10)}…</span>
                </div>
                {acceptingRequest.solanaAddress && (
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-mono text-[10px] text-muted shrink-0">Solana</span>
                    <span className="font-mono text-[10px] text-ink truncate">{acceptingRequest.solanaAddress}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-muted">Prefers</span>
                  <span className="font-mono text-[10px] text-ink">{acceptingRequest.preferredAsset.toUpperCase()}</span>
                </div>
              </div>
              <div>
                <div className="section-label mb-1">Salary ({(company?.paymentAsset || "USDC").toUpperCase()})</div>
                <input
                  type="number"
                  value={acceptSalary}
                  onChange={(e) => setAcceptSalary(e.target.value)}
                  placeholder="5000"
                  min="1"
                  step="0.01"
                  className="w-full px-3 py-2 bg-overlay border border-rim text-ink font-ui text-sm placeholder:text-placeholder focus:outline-none focus:border-gold"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setAcceptingRequest(null)}
                  className="flex-1 py-2.5 border border-rim text-muted font-mono text-xs tracking-widest hover:border-muted transition-colors"
                >
                  CANCEL
                </button>
                <button
                  onClick={handleAcceptRequest}
                  disabled={acceptLoading || !acceptSalary || Number(acceptSalary) <= 0}
                  className="flex-1 py-2.5 flex items-center justify-center gap-2 bg-gold text-paper font-mono text-xs font-bold tracking-widest hover:brightness-110 disabled:opacity-40"
                >
                  {acceptLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                  CONFIRM
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Employee Modal */}
      {addingEmployee && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="w-full max-w-md bg-surface border border-rim">
            <div className="flex items-center justify-between px-6 py-4 border-b border-line">
              <div className="font-heading text-sm font-bold text-ink">
                Add Employee
              </div>
              <button
                onClick={closeModal}
                className="text-muted hover:text-ink transition-colors font-mono text-xs"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleAddEmployee} className="p-6 space-y-4">
              <div>
                <div className="section-label mb-1">Name</div>
                <input
                  type="text"
                  value={empForm.name}
                  onChange={(e) =>
                    setEmpForm({ ...empForm, name: e.target.value })
                  }
                  placeholder="Alice Chen"
                  required
                  className={INPUT}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <AssetSelector
                  value={empForm.preferredAsset}
                  onChange={(c) =>
                    setEmpForm({ ...empForm, preferredAsset: c })
                  }
                  chainId={
                    networkMode === "testnet"
                      ? 11155111
                      : empForm.preferredChainId
                  }
                  label="Receives in"
                />
                {networkMode === "mainnet" ? (
                  <NetworkSelector
                    networks={supportedNetworks}
                    value={empForm.preferredChainId}
                    onChange={(id) =>
                      setEmpForm({ ...empForm, preferredChainId: id })
                    }
                    label="On network"
                  />
                ) : (
                  <div>
                    <div className="section-label mb-1">On network</div>
                    <div className="flex items-center gap-2 px-3 py-2 bg-overlay border border-rim font-mono text-xs text-ink">
                      <img src="/token-eth.svg" alt="" className="w-4 h-4" />
                      Sepolia
                    </div>
                  </div>
                )}
              </div>
              <div>
                <div className="section-label mb-1">
                  {empForm.preferredAsset === "sol" ? "Solana address" : "Settlement address"}
                </div>
                <input
                  type="text"
                  value={empForm.settleAddress}
                  onChange={(e) => handleSettleAddressChange(e.target.value)}
                  placeholder={empForm.preferredAsset === "sol" ? "e.g. 7xKX…" : "0x…"}
                  required
                  className={INPUT}
                />
              </div>
              <div>
                <div className="section-label mb-1">
                  Salary ({(company.paymentAsset || "USDC").toUpperCase()})
                </div>
                <input
                  type="number"
                  value={empForm.salaryAmount}
                  onChange={(e) =>
                    setEmpForm({ ...empForm, salaryAmount: e.target.value })
                  }
                  placeholder="5000"
                  required
                  min="1"
                  step="0.01"
                  className={INPUT}
                />
              </div>
              {empError && (
                <p className="font-mono text-xs text-red">{empError}</p>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 py-2.5 border border-rim text-muted font-mono text-xs tracking-widest hover:border-muted transition-colors"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  disabled={empLoading}
                  className="flex-1 py-2.5 flex items-center justify-center gap-2 bg-gold text-paper font-mono text-xs font-bold tracking-widest transition-all hover:brightness-110 disabled:opacity-40"
                >
                  {empLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                  ADD EMPLOYEE
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
