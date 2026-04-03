/**
 * Payroll Orchestration Service
 * Coordinates Uniswap swaps (same-chain and cross-chain) with Chainlink rate
 * verification. Chain/token config from config/networks.js.
 */
import * as uniswap from "./uniswap.js";
import { onSecondHopComplete } from "./uniswap.js";
import * as sideshift from "./sideshift.js";
import { checkRate } from "./chainlink.js";
import { pullFromTreasury, sendFromRelayer } from "./dynamic.js";
import { supabase } from "../db/supabase.js";
import { getSwapProvider } from "../config/networks.js";
import { expandToPaymentUnits, effectiveAddress } from "../utils/payroll-units.js";

// In-memory cache for fast status lookups within a session
export const payrollRuns = new Map();


// Default chain IDs when not set
const DEFAULT_COMPANY_CHAIN_ID  = 11155111; // Sepolia
const DEFAULT_EMPLOYEE_CHAIN_ID = 11155111; // Sepolia

/**
 * Run payroll for all eligible employees.
 * Pre-flight: verify all rates BEFORE pulling any funds.
 * @param {Object} company - { id, employees, paymentAsset, chainId, walletAddress }
 * @param {Function} onProgress - optional SSE callback
 */
export async function runPayroll(company, onProgress = () => {}, networkMode = "testnet") {
  if (!company.employees || company.employees.length === 0) {
    throw new Error("No employees to pay");
  }

  const eligible = company.employees.filter((e) => e.worldIdVerified);
  if (eligible.length === 0) {
    throw new Error("No World ID verified employees to pay");
  }

  const paymentAsset   = (company.paymentAsset || "usdc").toLowerCase();
  const depositChainId = company.chainId || DEFAULT_COMPANY_CHAIN_ID;

  // Expand employees into payment units (one per split, or one per employee)
  const paymentUnits = expandToPaymentUnits(eligible, DEFAULT_EMPLOYEE_CHAIN_ID);

  // --- Pre-flight: quote + attest all payment units ---
  onProgress({ id: "preflight", label: `Verifying rates for ${paymentUnits.length} payment(s)...`, status: "running" });
  const preflightResults = await Promise.all(
    paymentUnits.map(async (emp) => {
      const settleChainId = emp.preferredChainId || DEFAULT_EMPLOYEE_CHAIN_ID;
      const provider = getSwapProvider(paymentAsset, depositChainId, emp.preferredAsset, settleChainId);
      const splitSuffix = emp._splitLabel ? ` (${emp._splitLabel})` : "";
      try {
        let quote;
        if (provider === "sideshift") {
          const solanaAddr = effectiveAddress(emp, "sol");
          quote = await sideshift.getQuote(paymentAsset, depositChainId, emp.salaryAmount, solanaAddr);
        } else {
          quote = await uniswap.getQuote(paymentAsset, depositChainId, emp.preferredAsset, settleChainId, emp.salaryAmount);
        }
        let rateCheck;
        if (provider === "sideshift") {
          // SideShift fixed-rate — no Chainlink feed for SOL, accept as-is
          rateCheck = { withinRange: true, deviationPercent: "0.00", settleCoin: "sol", chainlinkPrice: null };
          onProgress({
            id:      `attest_${emp._stepKey}`,
            empId:   emp.id,
            empName: emp.name,
            label:   `Rate check${splitSuffix}: SideShift fixed rate ${quote.rate} SOL/USDC — accepted`,
            status:  "done",
          });
        } else {
          rateCheck = await checkRate(quote.rate, emp.preferredAsset, networkMode);
          onProgress({
            id:       `attest_${emp._stepKey}`,
            empId:    emp.id,
            empName:  emp.name,
            label:    `Rate check${splitSuffix}: ${rateCheck.deviationPercent}% deviation — ${rateCheck.withinRange ? "PASS ✓" : "FAIL ✗"}`,
            status:   rateCheck.withinRange ? "done" : "error",
            attestation: {
              swapRate:         rateCheck.swapRate,
              chainlinkPrice:   rateCheck.chainlinkPrice,
              deviationPercent: rateCheck.deviationPercent,
              toleranceBps:     rateCheck.toleranceBps,
              withinRange:      rateCheck.withinRange,
              settleCoin:       rateCheck.settleCoin,
            },
          });
        }
        return { emp, quote, rateCheck, settleChainId, provider };
      } catch (err) {
        const msg = err.name === "AbortError" ? "SideShift timed out" : (err.message || "Quote failed");
        onProgress({
          id:      `attest_${emp._stepKey}`,
          empId:   emp.id,
          empName: emp.name,
          label:   `Rate check${splitSuffix}: ${msg}`,
          status:  "error",
        });
        return { emp, error: msg, settleChainId, provider };
      }
    })
  );

  // SideShift network errors (SOL payments) are skipped — they don't block EVM payments
  const sideshiftFailed = preflightResults.filter((r) => r.error && r.provider === "sideshift");
  const badRates = preflightResults.filter((r) => !r.error && !r.rateCheck?.withinRange);

  if (sideshiftFailed.length > 0) {
    sideshiftFailed.forEach((r) => onProgress({
      id:      `skip_${r.emp._stepKey}`,
      empId:   r.emp.id,
      empName: r.emp.name,
      label:   `SOL payment skipped: ${r.error}`,
      status:  "warning",
    }));
  }

  if (badRates.length > 0) {
    const details = badRates.map((r) =>
      `${r.emp.name}: ${r.rateCheck.deviationPercent}% deviation (max ${(r.rateCheck.toleranceBps / 100).toFixed(2)}%)`
    ).join("; ");
    onProgress({ id: "preflight", label: "Rate verification failed", status: "error" });
    throw new Error(`Payroll aborted — rate verification failed for ${badRates.length} employee(s). No funds were moved. ${details}`);
  }

  // Only proceed with units that have valid quotes
  const validResults = preflightResults.filter((r) => !r.error);
  if (validResults.length === 0) {
    onProgress({ id: "preflight", label: "Nothing to pay", status: "error" });
    throw new Error("Payroll aborted — all payment units failed quote retrieval.");
  }
  onProgress({ id: "preflight", label: `Rates verified for ${validResults.length} payment(s)${sideshiftFailed.length > 0 ? ` (${sideshiftFailed.length} SOL skipped)` : ""}`, status: "done" });

  // --- Pull deposit asset from company treasury ---
  if (company.walletAddress) {
    const totalAmount = eligible.reduce((sum, e) => sum + (e.salaryAmount || 0), 0);
    const assetLabel  = paymentAsset.toUpperCase();
    onProgress({ id: "treasury", label: `Pulling ${totalAmount} ${assetLabel} from treasury...`, status: "running" });
    try {
      const pullTxHash = await pullFromTreasury(paymentAsset, company.walletAddress, totalAmount, depositChainId);
      onProgress({ id: "treasury", label: `${totalAmount} ${assetLabel} pulled`, status: "done", txHash: pullTxHash });
    } catch (err) {
      const raw = (err.reason || err.message || "").toLowerCase();
      const label = raw.includes("exceeds balance") || raw.includes("insufficient")
        ? `${assetLabel} pull failed — insufficient treasury balance`
        : raw.includes("allowance") || raw.includes("approve")
        ? `${assetLabel} pull failed — spending not approved`
        : `${assetLabel} pull failed`;
      onProgress({ id: "treasury", label, status: "error" });
      throw err;
    }
  }

  // --- Execute swaps (sequential — parallel would cause nonce collisions on the same chain) ---
  const paidResults = [];
  for (const { emp, quote, settleChainId, provider } of validResults) {
    const result = await (async () => {
      const stepKey   = emp._stepKey;
      const splitSuffix = emp._splitLabel ? ` (${emp._splitLabel})` : "";
      const empCtx = { empId: emp.id, empName: emp.name };

      // Swap
      const asset     = paymentAsset.toUpperCase();
      const settle    = emp.preferredAsset.toUpperCase();
      const isSideShift = provider === "sideshift";
      const swapLabel = isSideShift
        ? `SideShift ${emp.salaryAmount} ${asset} → SOL (Solana)${splitSuffix}...`
        : quote.isTwoHop
        ? `Bridging ${emp.salaryAmount} ${asset} Arbitrum → Base${splitSuffix}...`
        : quote.isCrossChain
        ? `Cross-chain swap ${emp.salaryAmount} ${asset} → ${settle}${splitSuffix}...`
        : `Swapping ${emp.salaryAmount} ${asset} → ${settle}${splitSuffix}...`;
      onProgress({ id: `swap_${stepKey}`, ...empCtx, label: swapLabel, status: "running" });
      let swap;
      let secondHopResult = null;
      try {
        if (isSideShift) {
          // SideShift fixed-rate: create order (deposit address returned, funds sent separately by relayer)
          const solanaAddr = effectiveAddress(emp, "sol");
          swap = await sideshift.createOrder(quote, solanaAddr);
          onProgress({
            id: `swap_${stepKey}`, ...empCtx,
            label: `SideShift order created — sending ${emp.salaryAmount} ${asset} to deposit address...`,
            status: "running",
            explorerUrl: swap.explorerUrl,
          });

          // Send USDC from relayer to the SideShift deposit address to trigger the shift
          const depositTxHash = await sendFromRelayer(paymentAsset, swap.depositAddress, emp.salaryAmount, depositChainId);
          onProgress({
            id: `swap_${stepKey}`, ...empCtx,
            label: `SideShift funded — ${emp.salaryAmount} ${asset} sent, SOL delivering to Solana wallet`,
            status: "done",
            txHash: depositTxHash,
            explorerUrl: swap.explorerUrl,
          });
          // SideShift orders settle async; record and continue
          const runResult = {
            employeeId:     emp.id,
            employeeName:   emp.name,
            shiftId:        swap.orderId,
            depositAddress: swap.depositAddress,
            depositAsset:   paymentAsset.toUpperCase(),
            depositChainId,
            depositAmount:  emp.salaryAmount,
            settleAsset:    settle,
            settleChainId,
            settleAmount:   quote.settleAmount,
            settleAddress:  solanaAddr,
            isCrossChain:   true,
            provider:       "sideshift",
            explorerUrl:    swap.explorerUrl,
            status:         "processing",
            createdAt:      new Date().toISOString(),
          };
          payrollRuns.set(swap.orderId, runResult);
          supabase.from("payroll_runs").insert({
            id:               swap.orderId,
            employee_id:      emp.id,
            company_id:       emp.company_id,
            settle_address:   solanaAddr,
            deposit_asset:    paymentAsset.toUpperCase(),
            deposit_chain_id: depositChainId,
            deposit_amount:   emp.salaryAmount,
            settle_asset:     settle,
            settle_chain_id:  settleChainId,
            settle_amount:    quote.settleAmount,
            is_cross_chain:   true,
            provider:         "sideshift",
            status:           "processing",
          }).then(({ error: dbErr }) => {
            if (dbErr) console.warn("[Payroll] Supabase SideShift insert failed:", dbErr.message);
          });
          return runResult;
        }

        // Re-quote fresh for same-chain swaps — pre-flight quote expires in 30s but
        // USDC pull can take 60s+, making the calldata stale.
        let execQuote = quote;
        if (!quote.isTwoHop && !quote.isCrossChain) {
          execQuote = await uniswap.getQuote(paymentAsset, depositChainId, emp.preferredAsset, settleChainId, emp.salaryAmount);
        }
        const effectiveSettleAddress = effectiveAddress(emp);
        swap = await uniswap.executeSwap(execQuote, effectiveSettleAddress);
        const doneLabel = quote.isTwoHop
          ? `Bridge confirmed: ${emp.salaryAmount} ${asset} → Base`
          : quote.routing === "DIRECT"
          ? `Sent ${emp.salaryAmount} ${asset} to employee wallet`
          : quote.isCrossChain
          ? `Bridge confirmed: ${emp.salaryAmount} ${asset} → ${settle}`
          : `Swap confirmed: ${emp.salaryAmount} ${asset} → ${Number(quote.settleAmount).toFixed(6)} ${settle}`;
        onProgress({ id: `swap_${stepKey}`, ...empCtx, label: doneLabel, status: "done", txHash: swap.txHash });

        // For two-hop: emit "waiting" step now (before the await), then wait for the
        // second hop to fully complete before moving to the next employee.
        // Sequential execution avoids nonce collisions and USDC over-consumption.
        if (swap.isTwoHop) {
          onProgress({ id: `second_hop_${stepKey}`, ...empCtx, label: `Waiting for USDC on Base — queuing ${settle} swap...`, status: "running" });
          secondHopResult = await new Promise((resolve) => {
            onSecondHopComplete.set(swap.id, (hopResult) => {
              const { secondHopTxHash, transferTxHash, error } = hopResult;
              const run = payrollRuns.get(swap.id);
              if (run) {
                run.secondHopTxHash  = secondHopTxHash;
                run.transferTxHash   = transferTxHash;
                run.secondHopError   = error || null;
                run.status           = error ? "failed" : "settled";
                payrollRuns.set(swap.id, run);
                if (error) console.warn(`[Payroll] Two-hop failed for ${swap.id}: ${error}`);
                else console.log(`[Payroll] Two-hop complete for ${swap.id}: swap=${secondHopTxHash} transfer=${transferTxHash}`);

                supabase.from("payroll_runs").update({
                  swap_tx_hash:      secondHopTxHash,
                  transfer_tx_hash:  transferTxHash,
                  status:            error ? "failed" : "settled",
                }).eq("id", swap.id).then(({ error: dbErr }) => {
                  if (dbErr) console.warn("[Payroll] Supabase second-hop update failed:", dbErr.message);
                  else console.log(`[Payroll] Supabase updated for ${swap.id}`);
                });
              }
              resolve(hopResult);
            });
          });

          if (secondHopResult?.error) {
            onProgress({ id: `second_hop_${stepKey}`, ...empCtx, label: `Delivery failed: ${secondHopResult.error}`, status: "error" });
          } else {
            onProgress({ id: `second_hop_${stepKey}`, ...empCtx, label: `${settle} delivered to employee wallet`, status: "done", txHash: secondHopResult?.transferTxHash, chainId: settleChainId });
          }
        }
      } catch (err) {
        const raw = (err.reason || err.message || "").toLowerCase();
        const label = raw.includes("liquidity") || raw.includes("no route") || raw.includes("calldata")
          ? "Swap failed — no liquidity for this pair"
          : raw.includes("gas") || raw.includes("fee")
          ? "Swap failed — insufficient gas"
          : "Swap failed — please try again";
        onProgress({ id: `swap_${stepKey}`, ...empCtx, label, status: "error" });
        throw err;
      }

      // Transfer step (non-two-hop only)
      if (!quote.isCrossChain && swap.transferTxHash) {
        onProgress({ id: `transfer_${stepKey}`, ...empCtx, label: `Sending ${settle} to employee wallet...`, status: "done", txHash: swap.transferTxHash, chainId: settleChainId });
      } else if (quote.isCrossChain && !quote.isTwoHop) {
        onProgress({ id: `transfer_${stepKey}`, ...empCtx, label: `Cross-chain delivery in progress...`, status: "done" });
      }

      const twoHopDone    = quote.isTwoHop && secondHopResult && !secondHopResult.error;
      const twoHopFailed  = quote.isTwoHop && secondHopResult?.error;
      const effectiveSettleAddress = effectiveAddress(emp);
      const result = {
        employeeId:     emp.id,
        employeeName:   emp.name,
        shiftId:        swap.id,
        depositAddress: swap.depositAddress,
        depositAsset:   paymentAsset.toUpperCase(),
        depositChainId,
        depositAmount:  emp.salaryAmount,
        settleAsset:    emp.preferredAsset.toUpperCase(),
        settleChainId,
        settleAmount:   quote.settleAmount,
        settleAddress:  effectiveSettleAddress,
        isCrossChain:   quote.isCrossChain,
        isTwoHop:       quote.isTwoHop || false,
        transferTxHash: twoHopDone ? secondHopResult.transferTxHash : swap.transferTxHash,
        explorerUrl:    swap.explorerUrl,
        provider:       swap.provider,
        status:         twoHopDone ? "settled" : twoHopFailed ? "failed" : "processing",
        createdAt:      new Date().toISOString(),
      };

      payrollRuns.set(swap.id, result);

      // Persist to Supabase
      supabase.from("payroll_runs").insert({
        id:               swap.id,
        employee_id:      emp.id,
        company_id:       emp.company_id,
        settle_address:   effectiveSettleAddress,
        deposit_asset:    paymentAsset.toUpperCase(),
        deposit_chain_id: depositChainId,
        deposit_amount:   emp.salaryAmount,
        settle_asset:     emp.preferredAsset.toUpperCase(),
        settle_chain_id:  settleChainId,
        settle_amount:    quote.settleAmount,
        is_cross_chain:   quote.isCrossChain,
        transfer_tx_hash: swap.transferTxHash,
        provider:         swap.provider,
        status:           "processing",
      }).then(({ error }) => {
        if (error) console.warn("[Payroll] Supabase insert failed:", error.message);
      });

      return result;
    })();
    paidResults.push(result);
  }

  const unverified = company.employees
    .filter((e) => !e.worldIdVerified)
    .map((e) => ({
      employeeId:   e.id,
      employeeName: e.name,
      skipped:      true,
      reason:       "World ID verification required",
    }));

  return [...paidResults, ...unverified];
}

