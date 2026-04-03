"use client";

import { useState, useEffect, useRef } from "react";
import { useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import type { Eip1193Provider } from "ethers";
import { ethers } from "ethers";
import { createPublicClient, http, parseAbi } from "viem";
import { AuthGate } from "@/components/AuthGate";
import {
  IDKitRequestWidget,
  orbLegacy,
  type RpContext,
  type IDKitResult,
} from "@worldcoin/idkit";
import { AppNav } from "@/components/AppNav";
import { WalletCard } from "@/components/WalletCard";
import { SalaryHistory } from "@/components/SalaryHistory";
import { WorldIdBadge } from "@/components/WorldIdBadge";
import { AssetSelector } from "@/components/AssetSelector";
import { NetworkSelector } from "@/components/NetworkSelector";
import { useNetworkMode } from "@/lib/network-mode";
import { getNetworkByChainId } from "@/lib/networks";
import { friendlyError } from "@/lib/errors";
import { API_URL } from "@/lib/contracts";
import { useToast } from "@/components/Toast";
import { Loader2, Pencil, Plus, Trash2, Link, CheckCircle } from "lucide-react";

const ERC20_BALANCE_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

const WORLD_APP_ID = (process.env.NEXT_PUBLIC_WORLD_APP_ID ||
  "") as `app_${string}`;
const WORLD_ACTION = process.env.NEXT_PUBLIC_WORLD_ACTION || "verify-employee";

interface EmployeeRecord {
  employeeId: string;
  companyId: string;
  name: string;
  preferredAsset: string;
  preferredChainId: number;
  settleAddress: string;
  solanaAddress: string | null;
  salaryAmount: number;
  worldIdVerified: boolean;
  company: { id: string; name: string; paymentAsset: string };
}

const ENS_RESOLVER_ABI = [
  "function setText(bytes32 node, string key, string value) external",
];
const MAINNET_RPC = "https://ethereum-rpc.publicnode.com";

export default function EmployeePage() {
  const { address: evmAddress, isConnected: evmConnected } = useAppKitAccount({ namespace: "eip155" });
  const { address: solanaWalletAddress, isConnected: solanaConnected } = useAppKitAccount({ namespace: "solana" });
  const { walletProvider } = useAppKitProvider<Eip1193Provider>("eip155");

  // Prefer EVM address for primary identity; fall back to Solana-only
  const activeAddress = evmAddress || solanaWalletAddress;
  const isConnected = evmConnected || solanaConnected;
  const primaryWallet = isConnected && activeAddress ? { address: activeAddress } : null;

  const toast = useToast();
  const { mode, supportedNetworks, defaultNetwork } = useNetworkMode();
  const [record, setRecord] = useState<EmployeeRecord | null | "not-found">(null);
  const [isCompanyOwner, setIsCompanyOwner] = useState(false);
  const [isWorldIdVerified, setIsWorldIdVerified] = useState(false);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [worldIdError, setWorldIdError] = useState<string | null>(null);
  const [tokenBalance, setTokenBalance] = useState<string | null>(null);
  const [solanaBalance, setSolanaBalance] = useState<string | null>(null);

  const SOLANA_CHAIN_ID = 1399811149;

  // Split payroll state
  interface Split {
    percent: number;
    asset: string;
    chain_id: number;
    settleAddress?: string;
  }
  const [splits, setSplits] = useState<Split[]>([]);
  const [editingSplits, setEditingSplits] = useState(false);
  const [draftSplits, setDraftSplits] = useState<Split[]>([]);
  const [savingSplits, setSavingSplits] = useState(false);
  const [solanaAddress, setSolanaAddress] = useState("");

  // ENS publish state
  const [ensName, setEnsName] = useState("");
  const [ensPublishing, setEnsPublishing] = useState(false);
  const [ensPublished, setEnsPublished] = useState(false);
  const [ensNameError, setEnsNameError] = useState<string | null>(null);
  const [ensSyncingPayments, setEnsSyncingPayments] = useState(false);
  const [ensSyncedPayments, setEnsSyncedPayments] = useState(false);

  // Join request state (employee-initiated)
  const [joinName, setJoinName] = useState("");
  const [joinEnsName, setJoinEnsName] = useState("");
  const [joinEnsResolving, setJoinEnsResolving] = useState(false);
  const [joinEnsResolved, setJoinEnsResolved] = useState<{ address: string; splits: { percent: number; asset: string; chain_id: number }[] | null; solanaAddress?: string | null } | null>(null);
  const [joinSolanaAddress, setJoinSolanaAddress] = useState("");
  const [joinEnsError, setJoinEnsError] = useState<string | null>(null);
  const joinEnsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [joinCompanyQuery, setJoinCompanyQuery] = useState("");
  const [joinCompanyResults, setJoinCompanyResults] = useState<{ id: string; name: string; chain_id: number }[]>([]);
  const [joinCompanySelected, setJoinCompanySelected] = useState<{ id: string; name: string } | null>(null);
  const [joinSearching, setJoinSearching] = useState(false);
  const [joinSubmitting, setJoinSubmitting] = useState(false);
  const [joinSent, setJoinSent] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [pendingRequest, setPendingRequest] = useState<{
    id: string; companyId: string; companyName: string; employeeName: string;
    ensName: string | null; solanaAddress: string | null; createdAt: string;
  } | null>(null);
  const [cancellingRequest, setCancellingRequest] = useState(false);

  // Auto-fill Solana address from connected Solana wallet
  useEffect(() => {
    if (solanaWalletAddress && !solanaAddress) {
      setSolanaAddress(solanaWalletAddress);
    }
  }, [solanaWalletAddress]);

  useEffect(() => {
    if (!primaryWallet) return;
    setRecord(null);
    const addr = primaryWallet.address;
    const addrKey = addr.toLowerCase();
    setIsCompanyOwner(!!localStorage.getItem(`payflow_company_id_${addrKey}`));
    setIsWorldIdVerified(
      !!localStorage.getItem(`payflow_worldid_verified_${addrKey}`),
    );

    // Check for existing pending join request
    fetch(`${API_URL}/api/company/join-requests/by-address/${addr}`)
      .then((r) => r.json())
      .then((d) => setPendingRequest(d.request || null))
      .catch(() => {});

    fetch(`${API_URL}/api/employee/by-wallet/${addr}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.employeeId) {
          setRecord(data);
          if (data.solanaAddress) setSolanaAddress(data.solanaAddress);
          // Load payout splits
          fetch(`${API_URL}/api/employee/${data.employeeId}/splits`)
            .then((r) => r.json())
            .then((d) => setSplits((d.splits || []).map((s: { percent: number; asset: string; chain_id: number; settle_address?: string }) => ({
              percent:      s.percent,
              asset:        s.asset,
              chain_id:     s.chain_id,
              settleAddress: s.settle_address || undefined,
            }))))
            .catch(() => {});
          // Sync World ID status from DB
          if (data.worldIdVerified) {
            localStorage.setItem(`payflow_worldid_verified_${addrKey}`, "1");
            setIsWorldIdVerified(true);
          } else {
            localStorage.removeItem(`payflow_worldid_verified_${addrKey}`);
            setIsWorldIdVerified(false);
          }
        } else {
          setRecord("not-found");
          // Check backend for pre-verification (verified before being added to any payroll)
          fetch(`${API_URL}/api/worldid/verified/${addr}`)
            .then((r) => r.json())
            .then((d) => {
              if (d.verified) {
                localStorage.setItem(`payflow_worldid_verified_${addrKey}`, "1");
                setIsWorldIdVerified(true);
              } else {
                localStorage.removeItem(`payflow_worldid_verified_${addrKey}`);
                setIsWorldIdVerified(false);
              }
            })
            .catch(() => {
              localStorage.removeItem(`payflow_worldid_verified_${addrKey}`);
              setIsWorldIdVerified(false);
            });
        }
      })
      .catch(() => setRecord("not-found"));
  }, [primaryWallet?.address]);

  // Fetch employee's preferred token balance
  useEffect(() => {
    if (!record || record === "not-found") return;
    const net = getNetworkByChainId(record.preferredChainId || 11155111);
    if (!net) return;
    const asset = record.preferredAsset.toLowerCase();
    const tokenCfg = net.tokens[asset];
    if (!tokenCfg) return;

    const client = createPublicClient({ transport: http(net.rpcUrl) });
    client
      .readContract({
        address: tokenCfg.address as `0x${string}`,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [record.settleAddress as `0x${string}`],
      })
      .then((raw) => {
        const balance = Number(raw as bigint) / 10 ** tokenCfg.decimals;
        setTokenBalance(balance.toFixed(4));
      })
      .catch(() => setTokenBalance(null));
  }, [record]);

  // Fetch native SOL balance when a Solana wallet is connected
  useEffect(() => {
    if (!solanaWalletAddress) {
      setSolanaBalance(null);
      return;
    }
    // Use ankr's free public RPC — more reliable for browser requests than api.mainnet-beta.solana.com
    const rpcUrl = "https://rpc.ankr.com/solana";
    fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [solanaWalletAddress, { commitment: "confirmed" }],
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        const lamports = data?.result?.value;
        if (typeof lamports === "number") {
          setSolanaBalance((lamports / 1e9).toFixed(4));
        } else {
          console.warn("[SOL balance] unexpected response:", data);
          setSolanaBalance(null);
        }
      })
      .catch((err) => {
        console.warn("[SOL balance] fetch error:", err);
        setSolanaBalance(null);
      });
  }, [solanaWalletAddress]);

  const openWorldId = async () => {
    setWorldIdError(null);
    try {
      const res = await fetch(`${API_URL}/api/worldid/sign-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: WORLD_ACTION }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "Failed to get request context");
      setRpContext(data);
      setWidgetOpen(true);
    } catch (err: unknown) {
      const msg = friendlyError(err);
      setWorldIdError(msg);
      toast("error", msg);
    }
  };

  const handleVerify = async (result: IDKitResult) => {
    if (!rpContext) throw new Error("No RP context");
    const emp = record && record !== "not-found" ? record : null;
    const res = await fetch(`${API_URL}/api/worldid/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rp_id: rpContext.rp_id,
        idkitResponse: result,
        employeeId: emp?.employeeId,
        companyId: emp?.companyId,
        walletAddress: emp ? undefined : evmAddress,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      const msg = data.error || "Verification failed";
      setWorldIdError(msg);
      toast("error", msg);
      throw new Error(msg);
    }
  };

  const handleWorldIdSuccess = async (_result: IDKitResult) => {
    if (evmAddress) {
      localStorage.setItem(
        `payflow_worldid_verified_${evmAddress.toLowerCase()}`,
        "1",
      );
    }
    setIsWorldIdVerified(true);
    if (record && record !== "not-found") {
      setRecord({ ...record, worldIdVerified: true });
    }
    toast("success", "World ID verified.");
  };

  const handleSaveSplits = async () => {
    if (!record || record === "not-found") return;
    const total = draftSplits.reduce((s, x) => s + x.percent, 0);
    if (draftSplits.length > 0 && total !== 100) {
      toast("error", `Splits must total 100% (currently ${total}%)`);
      return;
    }
    const hasSolSplit = draftSplits.some((s) => s.asset === "sol");
    if (hasSolSplit && !solanaAddress.trim()) {
      toast("error", "A Solana address is required for SOL payouts");
      return;
    }
    setSavingSplits(true);
    try {
      const body: Record<string, unknown> = { splits: draftSplits };
      if (hasSolSplit) body.solanaAddress = solanaAddress.trim();
      const res = await fetch(
        `${API_URL}/api/employee/${record.employeeId}/splits`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) throw new Error(await res.text());
      setSplits(draftSplits);
      setEditingSplits(false);
      toast(
        "success",
        draftSplits.length > 0
          ? "Payout splits saved."
          : "Splits cleared — single payout active.",
      );
    } catch (err: unknown) {
      toast("error", friendlyError(err));
    } finally {
      setSavingSplits(false);
    }
  };

  const handlePublishToEns = async () => {
    if (!ensName.includes(".")) {
      setEnsNameError("Enter a valid ENS name (e.g. yourname.eth)");
      return;
    }
    if (!walletProvider || !evmAddress) {
      setEnsNameError("Connect an EVM wallet to publish");
      return;
    }
    setEnsPublishing(true);
    setEnsNameError(null);
    setEnsPublished(false);
    try {
      // 1. Verify ENS name resolves to this wallet
      const r = await fetch(`${API_URL}/api/ens/${encodeURIComponent(ensName)}?network=${mode === "mainnet" ? "mainnet" : "sepolia"}`);
      const data = await r.json();
      if (!r.ok) {
        setEnsNameError(data.error || "ENS name not found");
        return;
      }
      if (data.address.toLowerCase() !== evmAddress.toLowerCase()) {
        setEnsNameError("This ENS name resolves to a different address than your connected wallet");
        return;
      }

      // 2. Get the resolver address for this name via public mainnet RPC
      const mainnetProvider = new ethers.JsonRpcProvider(MAINNET_RPC, "mainnet");
      const resolver = await mainnetProvider.getResolver(ensName);
      if (!resolver) {
        setEnsNameError("No resolver set for this ENS name — set one via the ENS app first");
        return;
      }

      // 3. Switch wallet to Ethereum mainnet if needed
      const browserProvider = new ethers.BrowserProvider(walletProvider);
      const network = await browserProvider.getNetwork();
      if (Number(network.chainId) !== 1) {
        await walletProvider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x1" }],
        });
      }
      // Re-create provider after potential chain switch so it picks up the new chain
      const activeProvider = new ethers.BrowserProvider(walletProvider);
      const signer = await activeProvider.getSigner();

      // 4. Call setText on the resolver
      const resolverContract = new ethers.Contract(resolver.address, ENS_RESOLVER_ABI, signer);
      const node = ethers.namehash(ensName);

      const tx1 = await resolverContract.setText(node, "com.payflow.splits", JSON.stringify(splits));
      await tx1.wait(1);

      // 5. Publish solana address if there's a SOL split
      const hasSol = splits.some((s) => s.asset === "sol");
      if (hasSol && solanaAddress.trim()) {
        const tx2 = await resolverContract.setText(node, "com.payflow.solanaAddress", solanaAddress.trim());
        await tx2.wait(1);
      }

      setEnsPublished(true);
      toast("success", "Payment profile published to ENS.");
    } catch (err: unknown) {
      setEnsNameError(friendlyError(err));
    } finally {
      setEnsPublishing(false);
    }
  };

  const handleSyncPaymentsToEns = async () => {
    if (!ensName.includes(".")) {
      setEnsNameError("Enter a valid ENS name first");
      return;
    }
    if (!walletProvider || !evmAddress) {
      setEnsNameError("Connect an EVM wallet to sync");
      return;
    }
    setEnsSyncingPayments(true);
    setEnsNameError(null);
    setEnsSyncedPayments(false);
    try {
      // 1. Fetch payment history
      const r = await fetch(`${API_URL}/api/employee/${evmAddress}/history`);
      if (!r.ok) throw new Error("Failed to fetch payment history");
      const { payments } = await r.json();
      if (!payments?.length) throw new Error("No payment history to sync");

      // 2. Format as compact array (last 20, completed only)
      const completed = (payments as { date: string; amount: string; asset: string; transferTxHash?: string; status: string }[])
        .filter((p) => p.status === "completed" || p.status === "sent")
        .slice(0, 20)
        .map((p) => ({
          date: p.date ? new Date(p.date).toISOString().split("T")[0] : "—",
          amount: p.amount,
          asset: p.asset?.toUpperCase() ?? "—",
          ...(p.transferTxHash ? { tx: p.transferTxHash } : {}),
        }));
      if (!completed.length) throw new Error("No completed payments to sync");

      // 3. Get resolver
      const mainnetProvider = new ethers.JsonRpcProvider(MAINNET_RPC, "mainnet");
      const resolver = await mainnetProvider.getResolver(ensName);
      if (!resolver) throw new Error("No resolver set for this ENS name");

      // 4. Switch to mainnet and sign
      const browserProvider = new ethers.BrowserProvider(walletProvider);
      const network = await browserProvider.getNetwork();
      if (Number(network.chainId) !== 1) {
        await walletProvider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] });
      }
      // Re-create provider after potential chain switch
      const activeProvider = new ethers.BrowserProvider(walletProvider);
      const signer = await activeProvider.getSigner();
      const resolverContract = new ethers.Contract(resolver.address, ENS_RESOLVER_ABI, signer);
      const node = ethers.namehash(ensName);

      // 5. Write com.payflow.payments
      const tx = await resolverContract.setText(node, "com.payflow.payments", JSON.stringify(completed));
      await tx.wait(1);

      setEnsSyncedPayments(true);
      toast("success", `${completed.length} payment${completed.length > 1 ? "s" : ""} synced to ENS.`);
    } catch (err: unknown) {
      setEnsNameError(friendlyError(err));
    } finally {
      setEnsSyncingPayments(false);
    }
  };

  // Auto-resolve ENS name from connected wallet when the join form appears.
  // Always use mainnet for reverse lookup — primary names are registered there.
  useEffect(() => {
    if (record !== "not-found" || !evmAddress || joinEnsName) return;
    const provider = new ethers.JsonRpcProvider("https://cloudflare-eth.com", "mainnet");
    provider.lookupAddress(evmAddress).then((name) => {
      if (!name) return;
      // Set the field value then trigger the full ENS fetch (splits etc.)
      setJoinEnsName(name);
      setJoinEnsResolving(true);
      setJoinEnsResolved(null);
      setJoinEnsError(null);
      fetch(`${API_URL}/api/ens/${encodeURIComponent(name)}?network=${mode === "mainnet" ? "mainnet" : "sepolia"}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.address) {
          setJoinEnsResolved({ address: data.address, splits: data.splits, solanaAddress: data.solanaAddress });
          if (data.solanaAddress) setJoinSolanaAddress(data.solanaAddress);
        }
        })
        .catch(() => {})
        .finally(() => setJoinEnsResolving(false));
    }).catch(() => {});
  }, [record, evmAddress]);

  // Company search debounce
  const joinSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleJoinCompanyQuery = (value: string) => {
    setJoinCompanyQuery(value);
    setJoinCompanySelected(null);
    setJoinCompanyResults([]);
    if (joinSearchRef.current) clearTimeout(joinSearchRef.current);
    if (value.trim().length < 2) return;
    setJoinSearching(true);
    joinSearchRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`${API_URL}/api/company/search?name=${encodeURIComponent(value.trim())}`);
        const data = await r.json();
        setJoinCompanyResults(data.companies || []);
      } catch {
        setJoinCompanyResults([]);
      } finally {
        setJoinSearching(false);
      }
    }, 400);
  };

  const handleJoinEnsName = (value: string) => {
    setJoinEnsName(value);
    setJoinEnsResolved(null);
    setJoinEnsError(null);
    if (joinEnsDebounceRef.current) clearTimeout(joinEnsDebounceRef.current);
    if (!value.includes(".") || value.startsWith("0x")) return;
    setJoinEnsResolving(true);
    joinEnsDebounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`${API_URL}/api/ens/${encodeURIComponent(value)}?network=${mode === "mainnet" ? "mainnet" : "sepolia"}`);
        const data = await r.json();
        if (!r.ok) { setJoinEnsError(data.error || "Name not found"); return; }
        if (data.address?.toLowerCase() !== evmAddress?.toLowerCase()) {
          setJoinEnsError("This ENS name resolves to a different address than your wallet");
          return;
        }
        setJoinEnsResolved({ address: data.address, splits: data.splits, solanaAddress: data.solanaAddress });
        if (data.solanaAddress) setJoinSolanaAddress(data.solanaAddress);
        setJoinEnsError(null);
      } catch {
        setJoinEnsError("Could not resolve ENS name");
      } finally {
        setJoinEnsResolving(false);
      }
    }, 600);
  };

  const handleSubmitJoinRequest = async () => {
    if (!joinName.trim()) { setJoinError("Enter your name"); return; }
    if (!joinCompanySelected) { setJoinError("Select a company"); return; }
    if (!evmAddress) { setJoinError("Connect your EVM wallet first"); return; }
    setJoinSubmitting(true);
    setJoinError(null);
    try {
      const r = await fetch(`${API_URL}/api/company/${joinCompanySelected.id}/join-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeName: joinName.trim(),
          employeeAddress: evmAddress,
          preferredAsset: "usdc",
          preferredChainId: 11155111,
          ensName: joinEnsResolved ? joinEnsName.trim() : undefined,
          solanaAddress: joinSolanaAddress.trim() || undefined,
          ensSplits: joinEnsResolved?.splits?.length ? joinEnsResolved.splits : undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed to send request");
      setJoinSent(true);
      setPendingRequest(null); // will be replaced by the awaiting state via joinSent
      toast("success", `Request sent to ${joinCompanySelected.name}.`);
    } catch (err: unknown) {
      setJoinError(friendlyError(err));
    } finally {
      setJoinSubmitting(false);
    }
  };

  const handleCancelRequest = async () => {
    if (!pendingRequest) return;
    setCancellingRequest(true);
    try {
      await fetch(`${API_URL}/api/company/${pendingRequest.companyId}/join-requests/${pendingRequest.id}`, {
        method: "DELETE",
      });
      setPendingRequest(null);
      setJoinSent(false);
      toast("success", "Request cancelled.");
    } catch {
      toast("error", "Could not cancel request.");
    } finally {
      setCancellingRequest(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    setWidgetOpen(isOpen);
    if (!isOpen) setRpContext(null);
  };

  /* ── Auth gate ─────────────────────────────────────────────── */
  if (!primaryWallet)
    return (
      <AuthGate
        sectionLabel="Employee Portal"
        heading={
          <>
            View your earnings &amp;
            <br />
            <span className="text-gradient-gold">set payout preferences.</span>
          </>
        }
        body="Connect your wallet to manage your payout preferences and view payment history."
      />
    );

  /* ── Company owner gate ────────────────────────────────────── */
  if (isCompanyOwner)
    return (
      <div className="min-h-screen bg-bg flex flex-col">
        <AppNav />
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
          <div className="w-full max-w-md">
            <div className="section-label mb-3">Access Restricted</div>
            <h1 className="text-3xl font-bold mb-4 font-heading text-ink leading-tight">
              This wallet is registered
              <br />
              <span className="text-gradient-gold">as a company.</span>
            </h1>
            <p className="text-sm text-muted leading-relaxed mb-8">
              A single wallet can only participate as one role in PayFlow —
              either a company or an employee, not both. Use a different wallet
              to access the employee portal.
            </p>
            <a
              href="/company"
              className="inline-flex items-center gap-3 px-7 py-3.5 font-mono text-sm tracking-widest font-medium bg-gold text-paper transition-all hover:brightness-110"
            >
              Go to company dashboard →
            </a>
          </div>
        </div>
      </div>
    );

  /* ── Loading ───────────────────────────────────────────────── */
  if (record === null)
    return (
      <div className="min-h-screen bg-bg flex flex-col">
        <AppNav label="MY EARNINGS" />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted" />
        </div>
      </div>
    );

  /* ── Main portal ───────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-bg">
      <AppNav label="MY EARNINGS" />

      <div className="max-w-6xl mx-auto px-8 py-10 space-y-8">

        <WalletCard
          address={evmAddress ?? primaryWallet.address}
          balance={tokenBalance ?? "—"}
          unit={
            record !== "not-found"
              ? record.preferredAsset === "eth"
                ? "WETH"
                : record.preferredAsset.toUpperCase()
              : ""
          }
          label="EVM Wallet"
          solana={
            solanaWalletAddress
              ? { address: solanaWalletAddress, balance: solanaBalance ?? "—", unit: "SOL", label: "Solana Wallet" }
              : undefined
          }
        />

        {/* Employee record from DB */}
        {record !== "not-found" ? (
          <div className="bg-surface border border-line">
            <div className="px-6 py-4 border-b border-line flex items-center justify-between">
              <div>
                <div className="section-label mb-1">Payroll</div>
                <div className="font-heading text-base font-bold text-ink">
                  Your Payroll Record
                </div>
              </div>
              <WorldIdBadge verified={isWorldIdVerified} />
            </div>

            <div className="px-6">
              <div className="data-row">
                <span className="data-label">Company</span>
                <span className="data-value">{record.company.name}</span>
              </div>
              <div className="data-row">
                <span className="data-label">Name</span>
                <span className="data-value">{record.name}</span>
              </div>
              <div className="data-row">
                <span className="data-label">Salary</span>
                <span className="data-value text-gold font-bold">
                  {record.salaryAmount.toLocaleString()}{" "}
                  {record.company.paymentAsset.toUpperCase()}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-surface border border-line">
            <div className="px-6 py-4 border-b border-line">
              <div className="section-label mb-1">Join Request</div>
              <div className="font-heading text-base font-bold text-ink">
                Request to Join a Company
              </div>
            </div>
            {(pendingRequest || joinSent) ? (
              <div className="px-6 py-6 space-y-4">
                <div className="flex items-center gap-2 text-gold font-mono text-xs font-bold">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  AWAITING APPROVAL
                </div>
                <div className="px-3 py-2.5 bg-overlay border border-rim space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] text-muted">Company</span>
                    <span className="font-heading text-sm font-bold text-ink">
                      {pendingRequest?.companyName ?? joinCompanySelected?.name}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] text-muted">Name</span>
                    <span className="font-mono text-xs text-ink">
                      {pendingRequest?.employeeName ?? joinName}
                    </span>
                  </div>
                  {(pendingRequest?.ensName ?? joinEnsName) && (
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-muted">ENS</span>
                      <span className="font-mono text-xs text-gold">
                        {pendingRequest?.ensName ?? joinEnsName}
                      </span>
                    </div>
                  )}
                  {(pendingRequest?.solanaAddress ?? joinSolanaAddress) && (
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-mono text-[10px] text-muted shrink-0">Solana</span>
                      <span className="font-mono text-[10px] text-ink truncate">
                        {pendingRequest?.solanaAddress ?? joinSolanaAddress}
                      </span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted leading-relaxed">
                  The company owner will review your request. You'll be added to payroll once they accept.
                </p>
                <button
                  onClick={handleCancelRequest}
                  disabled={cancellingRequest}
                  className="flex items-center justify-center gap-2 w-full py-2.5 bg-red/10 border border-red/30 text-red font-mono text-xs font-bold tracking-widest hover:bg-red/20 transition-colors disabled:opacity-40"
                >
                  {cancellingRequest && <Loader2 className="w-3 h-3 animate-spin" />}
                  CANCEL REQUEST
                </button>
              </div>
            ) : (
              <div className="px-6 py-5 space-y-4">
                <p className="text-xs text-muted leading-relaxed">
                  Search for your company and send a join request. The owner will see it in their dashboard and can accept you directly.
                </p>
                <div>
                  <div className="section-label mb-1">Your name</div>
                  <input
                    type="text"
                    value={joinName}
                    onChange={(e) => setJoinName(e.target.value)}
                    placeholder="Alice Chen"
                    className="w-full px-3 py-2 bg-overlay border border-rim text-ink font-ui text-sm placeholder:text-placeholder focus:outline-none focus:border-gold"
                  />
                </div>
                <div>
                  <div className="section-label mb-1">Your ENS name <span className="text-faint normal-case font-sans font-normal tracking-normal">(optional — auto-applies your payment splits)</span></div>
                  <div className="relative">
                    <input
                      type="text"
                      value={joinEnsName}
                      onChange={(e) => handleJoinEnsName(e.target.value)}
                      placeholder="yourname.eth"
                      className="w-full px-3 py-2 bg-overlay border border-rim text-ink font-ui text-sm placeholder:text-placeholder focus:outline-none focus:border-gold"
                    />
                    {joinEnsResolving && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted" />
                    )}
                  </div>
                  {joinEnsResolved && (
                    <div className="mt-1.5 px-2.5 py-1.5 bg-teal/5 border border-teal/20 font-mono text-[10px] text-teal space-y-0.5">
                      <div className="flex items-center gap-1 font-bold">
                        <CheckCircle className="w-3 h-3 shrink-0" />
                        ENS PROFILE FOUND
                      </div>
                      {joinEnsResolved.splits && joinEnsResolved.splits.length > 0 ? (
                        joinEnsResolved.splits.map((s, i) => (
                          <div key={i} className="text-muted">{s.percent}% → {s.asset.toUpperCase()} (chain {s.chain_id})</div>
                        ))
                      ) : (
                        <div className="text-muted">Address verified — no splits set yet</div>
                      )}
                    </div>
                  )}
                  {joinEnsError && (
                    <p className="mt-1 font-mono text-[10px] text-red">{joinEnsError}</p>
                  )}
                </div>
                <div>
                  <div className="section-label mb-1">
                    Solana address <span className="text-faint normal-case font-sans font-normal tracking-normal">(optional — for SOL payouts)</span>
                  </div>
                  <input
                    type="text"
                    value={joinSolanaAddress}
                    onChange={(e) => setJoinSolanaAddress(e.target.value)}
                    placeholder="7xKX… (auto-filled from ENS if set)"
                    className="w-full px-3 py-2 bg-overlay border border-rim text-ink font-ui text-sm placeholder:text-placeholder focus:outline-none focus:border-gold font-mono"
                  />
                  {solanaWalletAddress && joinSolanaAddress !== solanaWalletAddress && (
                    <button
                      onClick={() => setJoinSolanaAddress(solanaWalletAddress)}
                      className="mt-1 font-mono text-[10px] text-muted hover:text-gold transition-colors"
                    >
                      Use connected Solana wallet ({solanaWalletAddress.slice(0, 8)}…)
                    </button>
                  )}
                </div>
                <div>
                  <div className="section-label mb-1">Company name</div>
                  <div className="relative">
                    <input
                      type="text"
                      value={joinCompanySelected ? joinCompanySelected.name : joinCompanyQuery}
                      onChange={(e) => handleJoinCompanyQuery(e.target.value)}
                      placeholder="Search company…"
                      className="w-full px-3 py-2 bg-overlay border border-rim text-ink font-ui text-sm placeholder:text-placeholder focus:outline-none focus:border-gold"
                    />
                    {joinSearching && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted" />
                    )}
                  </div>
                  {joinCompanyResults.length > 0 && !joinCompanySelected && (
                    <div className="border border-rim bg-overlay divide-y divide-rim">
                      {joinCompanyResults.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setJoinCompanySelected(c);
                            setJoinCompanyResults([]);
                          }}
                          className="w-full px-3 py-2 text-left font-ui text-sm text-ink hover:bg-surface/60 transition-colors"
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {joinCompanySelected && (
                    <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-teal">
                      <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3" />{joinCompanySelected.name}</span>
                      <button onClick={() => { setJoinCompanySelected(null); setJoinCompanyQuery(""); }} className="text-muted hover:text-red transition-colors">change</button>
                    </div>
                  )}
                </div>
                {joinError && (
                  <p className="font-mono text-xs text-red">{joinError}</p>
                )}
                <button
                  onClick={handleSubmitJoinRequest}
                  disabled={joinSubmitting || !joinName.trim() || !joinCompanySelected}
                  className="w-full py-2.5 flex items-center justify-center gap-2 bg-gold text-paper font-mono text-xs font-bold tracking-widest transition-all hover:brightness-110 disabled:opacity-40"
                >
                  {joinSubmitting && <Loader2 className="w-3 h-3 animate-spin" />}
                  SEND JOIN REQUEST →
                </button>
              </div>
            )}
          </div>
        )}

        {/* Split payroll configuration */}
        {record !== "not-found" && (
          <div className="bg-surface border border-line">
            <div className="px-6 py-4 border-b border-line flex items-center justify-between">
              <div>
                <div className="section-label mb-1">Payout Splits</div>
                <div className="font-heading text-base font-bold text-ink">
                  Token Allocation
                </div>
              </div>
              {!editingSplits && (
                <button
                  onClick={() => {
                    const initial =
                      splits.length > 0
                        ? splits.map((s) => ({ ...s }))
                        : [
                            {
                              percent: 100,
                              asset: record.preferredAsset,
                              chain_id: record.preferredChainId || 11155111,
                            },
                          ];
                    setDraftSplits(initial);
                    setEditingSplits(true);
                  }}
                  className="p-1.5 text-muted hover:text-gold transition-colors rounded"
                  title="Configure payout splits"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              )}
            </div>

            {!editingSplits ? (
              <div className="px-6 py-4">
                {splits.length > 0 ? (
                  <div className="space-y-2">
                    {splits.map((s, i) => {
                      const isSolana = s.asset.toLowerCase() === "sol";
                      const net = isSolana
                        ? null
                        : getNetworkByChainId(s.chain_id);
                      const asset = s.asset.toLowerCase();
                      const symbol =
                        asset === "eth" ? "WETH" : asset.toUpperCase();
                      return (
                        <div key={i} className="space-y-0.5">
                          <div className="flex items-center gap-3">
                            <span className="font-mono font-bold text-gold w-10 text-sm">
                              {s.percent}%
                            </span>
                            <img
                              src={`/token-${asset}.svg`}
                              alt=""
                              className="w-4 h-4"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display =
                                  "none";
                              }}
                            />
                            <span className="text-sm text-ink">{symbol}</span>
                            {isSolana ? (
                              <span className="font-mono text-xs text-muted">
                                · Solana
                              </span>
                            ) : (
                              net && (
                                <span className="font-mono text-xs text-muted">
                                  · {net.shortName}
                                </span>
                              )
                            )}
                          </div>
                          {s.settleAddress && (
                            <div className="pl-[52px] font-mono text-[10px] text-muted truncate">
                              → {s.settleAddress}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted">
                    Single payout in{" "}
                    {record.preferredAsset === "eth"
                      ? "WETH"
                      : record.preferredAsset.toUpperCase()}
                    . Configure splits to receive in multiple tokens or chains.
                  </p>
                )}
              </div>
            ) : (
              <div className="px-6 py-5 space-y-4">
                <div className="section-label">Configure allocations</div>

                {draftSplits.map((s, i) => (
                  <div key={i} className="space-y-1.5">
                  <div
                    className="grid grid-cols-[56px_1fr_1fr_32px] gap-2 items-end"
                  >
                    <div>
                      <div className="section-label mb-1">%</div>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={s.percent}
                        onChange={(e) => {
                          const next = [...draftSplits];
                          next[i] = {
                            ...next[i],
                            percent: Number(e.target.value),
                          };
                          setDraftSplits(next);
                        }}
                        className="w-full px-2 py-2 bg-overlay border border-rim font-mono text-xs text-ink focus:outline-none focus:border-gold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                    <AssetSelector
                      value={s.asset}
                      onChange={(v) => {
                        const next = [...draftSplits];
                        next[i] = {
                          ...next[i],
                          asset: v,
                          chain_id:
                            v === "sol"
                              ? SOLANA_CHAIN_ID
                              : next[i].chain_id || defaultNetwork.chainId,
                        };
                        setDraftSplits(next);
                      }}
                      chainId={
                        mode === "testnet"
                          ? 11155111
                          : s.chain_id === SOLANA_CHAIN_ID
                            ? undefined
                            : s.chain_id || 11155111
                      }
                      label="Token"
                      exclude={draftSplits
                        .filter((_, j) => j !== i && draftSplits[j].chain_id === s.chain_id)
                        .map((x) => x.asset)}
                    />
                    {s.asset === "sol" ? (
                      <div>
                        <div className="section-label mb-1">Network</div>
                        <div className="flex items-center gap-2 px-3 py-2 bg-overlay border border-rim font-mono text-xs text-ink">
                          <img
                            src="/token-sol.svg"
                            alt=""
                            className="w-4 h-4"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display =
                                "none";
                            }}
                          />
                          Solana
                        </div>
                      </div>
                    ) : mode === "mainnet" ? (
                      <NetworkSelector
                        networks={supportedNetworks}
                        value={s.chain_id || defaultNetwork.chainId}
                        onChange={(v) => {
                          const next = [...draftSplits];
                          next[i] = { ...next[i], chain_id: v };
                          setDraftSplits(next);
                        }}
                        label="Network"
                      />
                    ) : (
                      <div>
                        <div className="section-label mb-1">Network</div>
                        <div className="flex items-center gap-2 px-3 py-2 bg-overlay border border-rim font-mono text-xs text-ink">
                          <img
                            src="/token-eth.svg"
                            alt=""
                            className="w-4 h-4"
                          />
                          Sepolia
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() =>
                        setDraftSplits(draftSplits.filter((_, j) => j !== i))
                      }
                      className="mb-0.5 p-2 text-muted hover:text-red transition-colors"
                      title="Remove"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  {s.asset !== "sol" && (
                    <input
                      type="text"
                      placeholder="Custom delivery wallet (optional — leave empty to use your default)"
                      value={s.settleAddress || ""}
                      onChange={(e) => {
                        const next = [...draftSplits];
                        next[i] = { ...next[i], settleAddress: e.target.value || undefined };
                        setDraftSplits(next);
                      }}
                      className="w-full px-3 py-2 bg-overlay border border-rim font-mono text-xs text-ink placeholder:text-muted focus:outline-none focus:border-gold"
                    />
                  )}
                  </div>
                ))}

                {/* Solana address input — shown when any split targets SOL */}
                {draftSplits.some((s) => s.asset === "sol") && (
                  <div>
                    <div className="section-label mb-1">
                      Solana Address (for SOL delivery)
                    </div>
                    <input
                      type="text"
                      value={solanaAddress}
                      onChange={(e) => setSolanaAddress(e.target.value)}
                      placeholder="e.g. 7xKX..."
                      className="w-full px-3 py-2 bg-overlay border border-gold/40 font-mono text-xs text-ink focus:outline-none focus:border-gold placeholder:text-faint"
                    />
                    {solanaWalletAddress && solanaAddress !== solanaWalletAddress && (
                      <button
                        onClick={() => setSolanaAddress(solanaWalletAddress)}
                        className="mt-1 font-mono text-xs text-muted hover:text-gold transition-colors"
                      >
                        Use connected Solana wallet ({solanaWalletAddress.slice(0, 8)}…)
                      </button>
                    )}
                  </div>
                )}

                {draftSplits.length > 0 && (
                  <div
                    className={`font-mono text-xs ${draftSplits.reduce((s, x) => s + x.percent, 0) === 100 ? "text-green" : "text-red"}`}
                  >
                    Total: {draftSplits.reduce((s, x) => s + x.percent, 0)}%{" "}
                    {draftSplits.reduce((s, x) => s + x.percent, 0) === 100
                      ? "✓"
                      : "(must be 100%)"}
                  </div>
                )}

                {draftSplits.length < 5 && (
                  <button
                    onClick={() =>
                      setDraftSplits([
                        ...draftSplits,
                        {
                          percent: 0,
                          asset: record.preferredAsset,
                          chain_id: record.preferredChainId || 11155111,
                        },
                      ])
                    }
                    className="flex items-center gap-1.5 font-mono text-xs text-muted hover:text-gold transition-colors"
                  >
                    <Plus className="w-3 h-3" /> ADD ALLOCATION
                  </button>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingSplits(false)}
                    className="flex-1 py-2.5 border border-rim text-muted font-mono text-xs tracking-widest hover:border-muted transition-colors"
                  >
                    CANCEL
                  </button>
                  <button
                    onClick={handleSaveSplits}
                    disabled={
                      savingSplits ||
                      (draftSplits.length > 0 &&
                        draftSplits.reduce((s, x) => s + x.percent, 0) !== 100)
                    }
                    className="flex-1 py-2.5 flex items-center justify-center gap-2 bg-gold text-paper font-mono text-xs font-bold tracking-widest transition-all hover:brightness-110 disabled:opacity-40"
                  >
                    {savingSplits && (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    )}
                    SAVE
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ENS Payment Profile — publish splits on-chain */}
        {record !== "not-found" && splits.length > 0 && evmConnected && (
          <div className="bg-surface border border-line">
            <div className="px-6 py-4 border-b border-line flex items-center gap-3">
              <div className="flex-1">
                <div className="section-label mb-1">ENS</div>
                <div className="font-heading text-base font-bold text-ink">
                  Publish Payment Profile
                </div>
              </div>
              <Link className="w-4 h-4 text-muted" />
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-xs text-muted leading-relaxed">
                Store your payout splits on your ENS name. Any company that adds
                you by ENS will automatically load your preferences — no manual
                setup needed.
              </p>

              <div className="px-3 py-2.5 bg-overlay border border-rim space-y-1">
                {splits.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 font-mono text-xs">
                    <span className="text-gold font-bold w-8">{s.percent}%</span>
                    <span className="text-ink">{s.asset === "eth" ? "WETH" : s.asset.toUpperCase()}</span>
                    <span className="text-muted">·</span>
                    <span className="text-muted">
                      {s.asset === "sol" ? "Solana" : (getNetworkByChainId(s.chain_id)?.shortName ?? `chain ${s.chain_id}`)}
                    </span>
                  </div>
                ))}
              </div>

              <div>
                <div className="section-label mb-1">Your ENS name</div>
                <input
                  type="text"
                  value={ensName}
                  onChange={(e) => {
                    setEnsName(e.target.value);
                    setEnsNameError(null);
                    setEnsPublished(false);
                  }}
                  placeholder="yourname.eth"
                  className="w-full px-3 py-2 bg-overlay border border-rim text-ink font-ui text-sm placeholder:text-placeholder focus:outline-none focus:border-gold"
                />
                {ensNameError && (
                  <p className="mt-1 font-mono text-[10px] text-red">{ensNameError}</p>
                )}
                {ensPublished && (
                  <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-teal">
                    <CheckCircle className="w-3 h-3 shrink-0" />
                    Published on-chain — any PayFlow company can now read your splits from {ensName}
                  </div>
                )}
              </div>

              <button
                onClick={handlePublishToEns}
                disabled={ensPublishing || !ensName.trim()}
                className="w-full py-2.5 flex items-center justify-center gap-2 bg-gold text-paper font-mono text-xs font-bold tracking-widest transition-all hover:brightness-110 disabled:opacity-40"
              >
                {ensPublishing ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    PUBLISHING…
                  </>
                ) : (
                  "PUBLISH TO ENS →"
                )}
              </button>

              <div className="border-t border-line pt-4 space-y-2">
                <div className="font-mono text-[10px] text-muted leading-relaxed">
                  Sync your payment history on-chain as <span className="text-ink">com.payflow.payments</span> — visible to anyone who resolves your ENS name.
                </div>
                <button
                  onClick={handleSyncPaymentsToEns}
                  disabled={ensSyncingPayments || !ensName.trim()}
                  className="w-full py-2.5 flex items-center justify-center gap-2 bg-overlay border border-rim text-ink font-mono text-xs font-bold tracking-widest transition-all hover:border-gold hover:text-gold disabled:opacity-40"
                >
                  {ensSyncingPayments ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      SYNCING…
                    </>
                  ) : ensSyncedPayments ? (
                    <>
                      <CheckCircle className="w-3 h-3 text-teal" />
                      SYNCED TO ENS
                    </>
                  ) : (
                    "SYNC PAYMENT HISTORY →"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* World ID verification — only relevant for EVM identity */}
        {!isWorldIdVerified && evmConnected && (
          <div className="bg-surface border border-line p-6">
            <div className="font-heading text-sm font-bold text-ink mb-2">
              Verify your identity
            </div>
            <p className="text-xs text-muted leading-relaxed mb-5">
              Verify with World ID so your company can run payroll for you. Each
              person can only register once — no duplicate accounts.
            </p>
            {worldIdError && (
              <p className="mb-4 font-mono text-xs text-red">{worldIdError}</p>
            )}
            {WORLD_APP_ID ? (
              <>
                {rpContext && (
                  <IDKitRequestWidget
                    open={widgetOpen}
                    onOpenChange={handleOpenChange}
                    app_id={WORLD_APP_ID}
                    action={WORLD_ACTION}
                    rp_context={rpContext}
                    allow_legacy_proofs={true}
                    preset={orbLegacy()}
                    environment="staging"
                    handleVerify={handleVerify}
                    onSuccess={handleWorldIdSuccess}
                  />
                )}
                <button
                  onClick={openWorldId}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet/10 border border-violet/30 text-violet font-mono text-xs font-bold tracking-widest transition-all hover:brightness-110"
                >
                  VERIFY WITH WORLD ID →
                </button>
              </>
            ) : (
              <p className="font-mono text-xs text-faint">
                World ID not configured (NEXT_PUBLIC_WORLD_APP_ID missing)
              </p>
            )}
          </div>
        )}

        {/* Payment history */}
        <div className="bg-surface border border-line p-6">
          <SalaryHistory
            employeeAddress={
              record && record !== "not-found"
                ? record.settleAddress
                : primaryWallet.address
            }
          />
        </div>
      </div>
    </div>
  );
}
