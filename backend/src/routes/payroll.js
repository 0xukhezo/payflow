import { Router } from "express";
import { supabase } from "../db/supabase.js";
import { runPayroll, payrollRuns } from "../services/payroll.js";
import { getQuote, getSwapStatus } from "../services/uniswap.js";
import { getQuote as getSideShiftQuote } from "../services/sideshift.js";
import { runCreSimulation } from "../services/cre-runner.js";
import { getChainlinkPriceByMode } from "../services/chainlink.js";

const router = Router();

// Per-company async payroll status — used when CRE runs on the live DON.
// Keyed by companyId. Auto-cleared after 15 minutes.
const companyRunStatus = new Map();
function setCompanyStatus(companyId, patch) {
  const prev = companyRunStatus.get(companyId) ?? { status: "running", steps: [], results: null, error: null };
  companyRunStatus.set(companyId, { ...prev, ...patch });
  // Auto-expire stale entries so the map doesn't grow unbounded
  setTimeout(() => companyRunStatus.delete(companyId), 15 * 60 * 1000);
}
function mergeStep(companyId, step) {
  const s = companyRunStatus.get(companyId);
  if (!s) return;
  const idx = s.steps.findIndex(x => x.id === step.id);
  if (idx >= 0) s.steps[idx] = step;
  else s.steps.push(step);
}

// Shape company + employees from Supabase row (splits attached separately)
function shapeCompany(data, splitsByEmployee = {}) {
  return {
    ...data,
    paymentAsset:  data.payment_asset,
    chainId:       data.chain_id || 11155111,
    walletAddress: data.wallet_address,
    employees: data.employees.map((e) => ({
      id:               e.id,
      name:             e.name,
      company_id:       e.company_id,
      preferredAsset:   e.preferred_asset,
      preferredChainId: e.preferred_chain_id || data.chain_id || 11155111,
      settleAddress:    e.settle_address,
      solanaAddress:    e.solana_address || null,
      salaryAmount:     e.salary_amount,
      worldIdVerified:  e.world_id_verified,
      splits:           splitsByEmployee[e.id] || [],
    })),
  };
}

// Load payroll splits for all employees of a company
async function loadSplits(employees) {
  if (!employees || employees.length === 0) return {};
  const ids = employees.map((e) => e.id);
  const { data, error } = await supabase
    .from("payroll_splits")
    .select("employee_id, percent, asset, chain_id, settle_address")
    .in("employee_id", ids);
  if (error) {
    console.warn("[payroll] could not load splits:", error.message);
    return {};
  }
  const byEmployee = {};
  for (const s of data || []) {
    if (!byEmployee[s.employee_id]) byEmployee[s.employee_id] = [];
    byEmployee[s.employee_id].push({
      percent:       s.percent,
      asset:         s.asset,
      chain_id:      s.chain_id,
      settleAddress: s.settle_address || null,
    });
  }
  return byEmployee;
}



// POST /api/payroll/:companyId/cre-quotes
// Called by the CRE workflow (Step 3) to batch all Uniswap quotes in one HTTP request.
// Returns oracle prices + one quote per payment unit so the DON stays within its HTTP budget.
router.post("/:companyId/cre-quotes", async (req, res) => {
  const { employees, depositChainId, treasury } = req.body ?? {};

  if (!employees?.length || !depositChainId) {
    return res.status(400).json({ error: "employees and depositChainId are required" });
  }

  const networkMode = depositChainId === 11155111 || depositChainId === 84532 ? "testnet" : "mainnet";
  const STABLECOINS = new Set(["usdc", "usdt", "dai"]);

  // Expand splits into payment units (mirrors CRE expandToPaymentUnits)
  const units = [];
  for (const emp of employees) {
    const splitSum    = emp.splits?.reduce((s, x) => s + x.percent, 0) ?? 0;
    const validSplits = emp.splits?.length > 0 && splitSum === 100;
    if (validSplits) {
      emp.splits.forEach((split, i) => {
        units.push({
          employeeId:    emp.id,
          splitIndex:    i,
          asset:         split.asset,
          chainId:       split.chain_id || depositChainId,
          salaryUsdc:    Number(((emp.salaryUsdc * split.percent) / 100).toFixed(6)),
          solanaAddress: emp.solanaAddress ?? null,
        });
      });
    } else {
      units.push({
        employeeId:    emp.id,
        splitIndex:    null,
        asset:         emp.preferredAsset,
        chainId:       emp.preferredChainId || depositChainId,
        salaryUsdc:    emp.salaryUsdc,
        solanaAddress: emp.solanaAddress ?? null,
      });
    }
  }

  // Fetch oracle prices and all Uniswap quotes in parallel
  const [ethResult, btcResult, ...quoteResults] = await Promise.allSettled([
    getChainlinkPriceByMode("eth", networkMode),
    getChainlinkPriceByMode("btc", networkMode),
    ...units.map(unit => {
      const asset = unit.asset.toLowerCase();
      if (STABLECOINS.has(asset)) return Promise.resolve(null);
      if (asset === "sol") {
        return getSideShiftQuote("usdc", depositChainId, unit.salaryUsdc, unit.solanaAddress ?? "")
          .then(q => ({ settleAmount: q.settleAmount, routing: "SIDESHIFT", isCrossChain: true, isTwoHop: false }))
          .catch(() => null);
      }
      return getQuote("usdc", depositChainId, asset, unit.chainId, unit.salaryUsdc);
    }),
  ]);

  const ethUsd = ethResult.status === "fulfilled" ? ethResult.value.price : 2000;
  const btcUsd = btcResult.status === "fulfilled" ? btcResult.value.price : 85000;

  const quotes = units.map((unit, i) => {
    const result = quoteResults[i];
    if (result?.status !== "fulfilled" || result.value === null) {
      return {
        employeeId:  unit.employeeId,
        splitIndex:  unit.splitIndex,
        settleAmount: null,
        routing:      null,
        isCrossChain: unit.chainId !== depositChainId,
        isTwoHop:     false,
        error:        result?.status === "rejected" ? result.reason?.message : null,
      };
    }
    const q = result.value;
    return {
      employeeId:   unit.employeeId,
      splitIndex:   unit.splitIndex,
      settleAmount: q.settleAmount,
      routing:      q.routing,
      isCrossChain: q.isCrossChain,
      isTwoHop:     q.isTwoHop ?? false,
    };
  });

  res.json({ ethUsd, btcUsd, quotes });
});

// POST /api/payroll/:companyId/run
// Called by the CRE workflow (Step 6) after on-chain verification passes.
//   creTriggered=true  → legacy dry-run ack, no execution
//   creVerified=true   → CRE passed all checks; execute payroll
//
// Responds immediately (DON has a short response timeout) then runs payroll
// in the background, writing progress to companyRunStatus for polling.
router.post("/:companyId/run", async (req, res) => {
  if (req.body?.creTriggered === true) {
    return res.json({ ok: true, creAcknowledged: true });
  }

  const companyId  = req.params.companyId;
  const networkMode = req.body?.networkMode || "testnet";

  let company;
  try {
    const { data, error } = await supabase
      .from("companies")
      .select("*, employees(*)")
      .eq("id", companyId)
      .single();
    // CRE-verified simulation: company may only exist in the test payload, not Supabase.
    // Acknowledge without executing payroll — no real funds to move.
    if ((error || !data) && req.body?.creVerified === true) {
      return res.json({ ok: true, simulationOnly: true });
    }
    if (error || !data) return res.status(404).json({ error: "Company not found" });

    const splitsByEmployee = await loadSplits(data.employees);
    company = shapeCompany(data, splitsByEmployee);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  // Respond immediately — the DON will timeout if we wait for execution
  res.json({ ok: true, companyId });

  // Initialise polling status
  setCompanyStatus(companyId, { status: "running", steps: [], results: null, error: null });

  // Run payroll in background; progress writes to the polling map
  runPayroll(
    company,
    (step) => mergeStep(companyId, step),
    networkMode,
  )
    .then((results) => setCompanyStatus(companyId, { status: "done", results: results.map(formatResult) }))
    .catch((err)    => setCompanyStatus(companyId, { status: "error", error: friendlyError(err) }));
});

// GET /api/payroll/:companyId/status
// Polled by the frontend when CRE runs on the live DON (async path).
// Returns { status, steps, results, error } for the most recent payroll run.
router.get("/:companyId/status", (req, res) => {
  const s = companyRunStatus.get(req.params.companyId);
  if (!s) return res.json({ status: "idle" });
  res.json(s);
});

// POST /api/payroll/:companyId/run-stream
// SSE stream: emits progress steps then a final "done" event
router.post("/:companyId/run-stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const emit = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const { data, error } = await supabase
      .from("companies")
      .select("*, employees(*)")
      .eq("id", req.params.companyId)
      .single();
    if (error || !data) {
      emit({ type: "error", message: "Company not found" });
      return res.end();
    }

    const splitsByEmployee = await loadSplits(data.employees);
    const company = shapeCompany(data, splitsByEmployee);
    const networkMode = req.body?.networkMode || "testnet";

    // ── CRE simulation: Uniswap quotes + Chainlink rate verification ─────────
    // Build trigger payload for the CRE workflow.
    const triggerPayload = {
      companyId:      company.id,
      treasury:       company.walletAddress,
      depositChainId: company.chainId || 11155111,
      employees: company.employees
        .filter(e => e.worldIdVerified)
        .map(e => ({
          id:               e.id,
          name:             e.name,
          salaryUsdc:       e.salaryAmount,
          settleAddress:    e.settleAddress,
          solanaAddress:    e.solanaAddress || null,
          preferredAsset:   e.preferredAsset,
          preferredChainId: e.preferredChainId || company.chainId || 11155111,
          worldIdVerified:  true,
          splits:           e.splits?.length > 0 ? e.splits : undefined,
        })),
    };

    const creResult = await runCreSimulation(
      triggerPayload,
      (step) => emit({ type: "step", ...step }),
    );

    // If CRE flagged failed rate checks → abort before touching funds.
    if (creResult?.summary?.failed > 0) {
      emit({
        type: "error",
        message: `CRE rate verification failed for ${creResult.summary.failed} payment(s) — payroll aborted. No funds were moved.`,
      });
      return res.end();
    }

    // Deployed DON mode: CRE trigger was fired asynchronously.
    // Tell the frontend to switch to polling — the DON will call /run when done.
    if (creResult?.async === true) {
      emit({ type: "pending", companyId: data.id });
      return res.end();
    }

    // Simulation mode dispatched via Step 6 → results already in creResult.
    if (creResult?.dispatched === true) {
      emit({ type: "done", companyId: data.id, results: (creResult.results ?? []).map(formatResult), creDispatched: true });
      return res.end();
    }

    const results = await runPayroll(company, (step) => emit({ type: "step", ...step }), networkMode);

    emit({
      type: "done",
      companyId: data.id,
      results: results.map(formatResult),
    });
    res.end();
  } catch (err) {
    console.error("Payroll stream error:", err);
    emit({ type: "error", message: friendlyError(err) });
    res.end();
  }
});

// GET /api/payroll/shift/:shiftId
router.get("/shift/:shiftId", async (req, res) => {
  try {
    const { shiftId } = req.params;
    const run = payrollRuns.get(shiftId);

    let swapStatus = null;
    const chainId = req.query.chainId ? Number(req.query.chainId) : (run?.depositChainId || 11155111);
    if (shiftId.startsWith("0x") && shiftId.length === 66) {
      swapStatus = await getSwapStatus(shiftId, chainId);
    }

    res.json({
      shiftId,
      status:             swapStatus?.status || run?.status || "unknown",
      provider:           run?.provider || "uniswap",
      isTwoHop:           run?.isTwoHop || false,
      txHash:             swapStatus?.txHash || shiftId,
      depositChainId:     run?.depositChainId || null,
      settleChainId:      run?.settleChainId  || null,
      depositAddress:     run?.depositAddress || null,
      settleAddress:      run?.settleAddress  || null,
      secondHopTxHash:    run?.secondHopTxHash  || null,
      secondHopError:     run?.secondHopError   || null,
      transferTxHash:     run?.transferTxHash   || null,
      ledgerTxHash:       run?.ledgerTxHash     || null,
      attestation: run?.attestation
        ? {
            deviationBps:     run.attestation.deviationBps,
            deviationPercent: run.attestation.deviationPercent,
            withinRange:      run.attestation.withinRange,
          }
        : null,
    });
  } catch (err) {
    console.error("Shift status error:", err);
    res.status(500).json({ error: err.message });
  }
});

function friendlyError(err) {
  const raw = (err.reason || err.shortMessage || err.message || "").toLowerCase();
  if (raw.includes("transfer amount exceeds balance") || raw.includes("insufficient balance") || raw.includes("exceeds balance"))
    return "Insufficient USDC balance in treasury. Top up your wallet and try again.";
  if (raw.includes("allowance") || raw.includes("not approved") || raw.includes("approve"))
    return "USDC spending not approved. Use the Approve USDC button first.";
  if (raw.includes("no world id verified") || raw.includes("world id"))
    return "No verified employees to pay. Employees must complete World ID verification first.";
  if (raw.includes("rate verification") || raw.includes("deviation") || raw.includes("tolerance"))
    return "Oracle rate check failed. Market rates may be volatile — try again shortly.";
  if (raw.includes("no employees") || raw.includes("no employees to pay"))
    return "No employees found on this payroll.";
  if (raw.includes("network") || raw.includes("timeout") || raw.includes("econnrefused"))
    return "Network error. Please check your connection and try again.";
  if (raw.includes("gas") || raw.includes("fee"))
    return "Transaction failed — insufficient gas or network congestion. Try again.";
  return "Payroll failed. Please check your treasury balance and try again.";
}

function formatResult(r) {
  return {
    employeeId:         r.employeeId,
    employeeName:       r.employeeName,
    skipped:            r.skipped || false,
    reason:             r.reason || null,
    shiftId:            r.shiftId,
    depositAsset:       r.depositAsset,
    depositAmount:      r.depositAmount,
    depositChainId:     r.depositChainId || null,
    settleAsset:        r.settleAsset,
    settleAmount:       r.settleAmount,
    settleChainId:      r.settleChainId  || null,
    isTwoHop:           r.isTwoHop       || false,
    provider:           r.provider || "uniswap",
    deviationBps:       r.attestation?.deviationBps,
    deviationPercent:   r.attestation?.deviationPercent,
    withinRange:        r.attestation?.withinRange,
    status:             r.status,
  };
}

export default router;
