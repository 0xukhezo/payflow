import { Router } from "express";
import { randomUUID } from "crypto";
import { supabase } from "../db/supabase.js";
import { getRelayerAddress, getTreasuryBalance } from "../services/dynamic.js";
import { SUPPORTED_CHAIN_IDS, SOLANA_CHAIN_ID, getToken } from "../config/networks.js";

const router = Router();

const DEFAULT_CHAIN_ID = 11155111; // Sepolia

async function getCompany(id) {
  const { data: company, error } = await supabase
    .from("companies")
    .select("*, employees(*)")
    .eq("id", id)
    .single();
  if (error || !company) return null;

  // Attach splits to each employee
  if (company.employees?.length > 0) {
    const empIds = company.employees.map((e) => e.id);
    const { data: splits } = await supabase
      .from("payroll_splits")
      .select("*")
      .in("employee_id", empIds);
    const splitsByEmp = {};
    for (const s of splits ?? []) {
      (splitsByEmp[s.employee_id] ??= []).push(s);
    }
    company.employees = company.employees.map((e) => ({
      ...e,
      splits: splitsByEmp[e.id] ?? [],
    }));
  }

  return company;
}

function shapeEmployee(e) {
  const splits = (e.splits ?? []).map((s) => ({
    percent:      s.percent,
    asset:        s.asset,
    chain_id:     s.chain_id,
    settleAddress: s.settle_address || undefined,
  }));
  return {
    id:               e.id,
    name:             e.name,
    email:            e.email,
    preferredAsset:   e.preferred_asset,
    preferredChainId: e.preferred_chain_id || DEFAULT_CHAIN_ID,
    settleAddress:    e.settle_address,
    solanaAddress:    e.solana_address || null,
    salaryAmount:     e.salary_amount,
    addedAt:          e.added_at,
    ...(splits.length > 0 && { splits }),
  };
}

// POST /api/company/onboard
router.post("/onboard", async (req, res) => {
  try {
    const { name, email, walletAddress, paymentAsset = "usdc", chainId = DEFAULT_CHAIN_ID } = req.body;
    if (!name || !email || !walletAddress) {
      return res.status(400).json({ error: "name, email, and walletAddress required" });
    }
    if (!SUPPORTED_CHAIN_IDS.includes(Number(chainId))) {
      return res.status(400).json({ error: `Unsupported chainId. Supported: ${SUPPORTED_CHAIN_IDS.join(", ")}` });
    }

    const companyId = randomUUID();
    const { error } = await supabase.from("companies").insert({
      id:            companyId,
      name,
      email,
      payment_asset: paymentAsset.toLowerCase(),
      chain_id:      Number(chainId),
      wallet_address: walletAddress,
    });
    if (error) throw new Error(error.message);

    res.status(201).json({ companyId, walletAddress });
  } catch (err) {
    console.error("Onboard error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/company/join-requests/by-address/:address  — employee checks their own pending request
router.get("/join-requests/by-address/:address", async (req, res) => {
  const { data, error } = await supabase
    .from("join_requests")
    .select("id, company_id, employee_name, preferred_asset, preferred_chain_id, solana_address, created_at, companies(name)")
    .ilike("employee_address", req.params.address)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.json({ request: null });
  res.json({
    request: {
      id:               data.id,
      companyId:        data.company_id,
      companyName:      data.companies?.name ?? "Unknown",
      employeeName:     data.employee_name,
      preferredAsset:   data.preferred_asset,
      solanaAddress:    data.solana_address || null,
      createdAt:        data.created_at,
    },
  });
});

// GET /api/company/search?name=  — must be before /:id routes
router.get("/search", async (req, res) => {
  const { name } = req.query;
  if (!name || String(name).trim().length < 2) {
    return res.status(400).json({ error: "name query must be at least 2 characters" });
  }
  const { data, error } = await supabase
    .from("companies")
    .select("id, name, chain_id")
    .ilike("name", `%${String(name).trim()}%`)
    .limit(5);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ companies: data || [] });
});

// GET /api/company/by-wallet/:address  — must be before /:id routes
router.get("/by-wallet/:address", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("companies")
      .select("id, name, wallet_address, chain_id")
      .ilike("wallet_address", req.params.address)
      .single();
    if (error || !data) return res.status(404).json({ error: "Not found" });
    res.json({ companyId: data.id, name: data.name, walletAddress: data.wallet_address, chainId: data.chain_id || DEFAULT_CHAIN_ID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/company/by-treasury/:address/cre-payload
// Called by the CRE log-trigger workflow after picking up a PayrollRequested event.
// Returns the full trigger payload (companyId, treasury, depositChainId, employees[])
// so the DON does not need to store sensitive HR data on-chain.
router.get("/by-treasury/:address/cre-payload", async (req, res) => {
  try {
    const addr = req.params.address.toLowerCase();
    const { data: company, error } = await supabase
      .from("companies")
      .select("id, wallet_address, chain_id, payment_asset, employees(id, name, salary_amount, preferred_asset, preferred_chain_id, settle_address, solana_address)")
      .ilike("wallet_address", addr)
      .single();

    if (error || !company) return res.status(404).json({ error: "Company not found" });

    const empIds = company.employees.map((e) => e.id);
    let splitsByEmp = {};
    if (empIds.length > 0) {
      const { data: splits } = await supabase
        .from("payroll_splits")
        .select("employee_id, percent, asset, chain_id, settle_address")
        .in("employee_id", empIds);
      for (const s of splits ?? []) {
        (splitsByEmp[s.employee_id] ??= []).push({
          percent:       s.percent,
          asset:         s.asset,
          chain_id:      s.chain_id,
          settleAddress: s.settle_address,
        });
      }
    }

    const depositChainId = company.chain_id ?? 11155111;
    const employees = company.employees.map((emp) => ({
      id:               emp.id,
      name:             emp.name,
      salaryUsdc:       emp.salary_amount,
      settleAddress:    emp.settle_address,
      solanaAddress:    emp.solana_address ?? null,
      preferredAsset:   emp.preferred_asset,
      preferredChainId: emp.preferred_chain_id ?? depositChainId,
      ...(splitsByEmp[emp.id]?.length > 0 && { splits: splitsByEmp[emp.id] }),
    }));

    res.json({
      companyId:      company.id,
      treasury:       company.wallet_address,
      depositChainId,
      employees,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/company/:id/employee
router.post("/:id/employee", async (req, res) => {
  try {
    const { data: company } = await supabase.from("companies").select("id, chain_id").eq("id", req.params.id).single();
    if (!company) return res.status(404).json({ error: "Company not found" });

    const {
      name, preferredAsset, settleAddress, salaryAmount,
      preferredChainId, solanaAddress,
    } = req.body;

    const isSol = preferredAsset?.toLowerCase() === "sol";

    if (!name || !preferredAsset || !salaryAmount) {
      return res.status(400).json({ error: "name, preferredAsset, salaryAmount required" });
    }
    if (isSol && !solanaAddress) {
      return res.status(400).json({ error: "solanaAddress required for SOL employees" });
    }
    if (!isSol && !settleAddress) {
      return res.status(400).json({ error: "settleAddress required" });
    }

    const resolvedChainId = isSol ? SOLANA_CHAIN_ID : Number(preferredChainId || company.chain_id || DEFAULT_CHAIN_ID);

    if (!isSol) {
      if (!SUPPORTED_CHAIN_IDS.includes(resolvedChainId)) {
        return res.status(400).json({ error: `Unsupported preferredChainId. Supported: ${SUPPORTED_CHAIN_IDS.join(", ")}` });
      }
      try { getToken(preferredAsset, resolvedChainId); } catch {
        return res.status(400).json({ error: `Token ${preferredAsset} not supported on chain ${resolvedChainId}` });
      }
    }

    const employeeId = randomUUID();
    const { error } = await supabase.from("employees").insert({
      id:                employeeId,
      company_id:        req.params.id,
      name,
      preferred_asset:   preferredAsset.toLowerCase(),
      preferred_chain_id: resolvedChainId,
      settle_address:    isSol ? "0x0000000000000000000000000000000000000000" : settleAddress,
      solana_address:    solanaAddress || null,
      salary_amount:     Number(salaryAmount),
    });
    if (error) throw new Error(error.message);

    res.status(201).json({ employeeId });
  } catch (err) {
    console.error("Add employee error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/company/:id/employee/:employeeId/salary
router.patch("/:id/employee/:employeeId/salary", async (req, res) => {
  try {
    const { salaryAmount } = req.body;
    const amount = Number(salaryAmount);
    if (!salaryAmount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: "salaryAmount must be a positive number" });
    }
    const { error } = await supabase.from("employees")
      .update({ salary_amount: amount })
      .eq("id", req.params.employeeId)
      .eq("company_id", req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true, salaryAmount: amount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/company/:id/employee/:employeeId
router.delete("/:id/employee/:employeeId", async (req, res) => {
  try {
    const { error } = await supabase
      .from("employees")
      .delete()
      .eq("id", req.params.employeeId)
      .eq("company_id", req.params.id);
    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/company/:id/employees
router.get("/:id/employees", async (req, res) => {
  const { data, error } = await supabase.from("employees").select("*").eq("company_id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ employees: data.map(shapeEmployee) });
});

// GET /api/company/:id/wallet
router.get("/:id/wallet", async (req, res) => {
  try {
    const { data: company } = await supabase
      .from("companies").select("wallet_address, chain_id, payment_asset").eq("id", req.params.id).single();
    if (!company) return res.status(404).json({ error: "Company not found" });

    const chainId      = company.chain_id || DEFAULT_CHAIN_ID;
    const paymentAsset = company.payment_asset || "usdc";
    const treasuryBalance = await getTreasuryBalance(paymentAsset, company.wallet_address, chainId);

    res.json({
      address:        company.wallet_address,
      chainId,
      paymentAsset,
      treasuryBalance,
      relayerAddress: getRelayerAddress(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/company/:id/join-requests  — employee requests to join
router.post("/:id/join-requests", async (req, res) => {
  const { employeeName, employeeAddress, preferredAsset, preferredChainId, solanaAddress } = req.body;
  if (!employeeName || !employeeAddress) {
    return res.status(400).json({ error: "employeeName and employeeAddress required" });
  }
  // Prevent duplicate pending request from the same address
  const { data: existing } = await supabase
    .from("join_requests")
    .select("id")
    .eq("company_id", req.params.id)
    .ilike("employee_address", employeeAddress)
    .eq("status", "pending")
    .maybeSingle();
  if (existing) return res.status(409).json({ error: "You already have a pending request for this company" });

  const { data, error } = await supabase
    .from("join_requests")
    .insert({
      company_id:        req.params.id,
      employee_name:     employeeName.trim(),
      employee_address:  employeeAddress.toLowerCase(),
      preferred_asset:   (preferredAsset || "usdc").toLowerCase(),
      preferred_chain_id: Number(preferredChainId) || 11155111,
      solana_address:    solanaAddress ? solanaAddress.trim() : null,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ requestId: data.id });
});

// GET /api/company/:id/join-requests  — company fetches pending requests
router.get("/:id/join-requests", async (req, res) => {
  const { data, error } = await supabase
    .from("join_requests")
    .select("*")
    .eq("company_id", req.params.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({
    requests: (data || []).map((r) => ({
      id:               r.id,
      employeeName:     r.employee_name,
      employeeAddress:  r.employee_address,
      preferredAsset:   r.preferred_asset,
      preferredChainId: r.preferred_chain_id,
      solanaAddress:    r.solana_address || null,
      createdAt:        r.created_at,
    })),
  });
});

// POST /api/company/:id/join-requests/:requestId/accept  — accept + create employee
router.post("/:id/join-requests/:requestId/accept", async (req, res) => {
  const { salaryAmount } = req.body;
  if (!salaryAmount || isNaN(Number(salaryAmount)) || Number(salaryAmount) <= 0) {
    return res.status(400).json({ error: "salaryAmount required" });
  }
  const { data: jr, error: jrErr } = await supabase
    .from("join_requests")
    .select("*")
    .eq("id", req.params.requestId)
    .eq("company_id", req.params.id)
    .eq("status", "pending")
    .single();
  if (jrErr || !jr) return res.status(404).json({ error: "Request not found" });

  const { data: company } = await supabase
    .from("companies")
    .select("chain_id")
    .eq("id", req.params.id)
    .single();

  // Check if this address has been pre-verified via World ID (before having an employee record)
  const employeeId = randomUUID();
  const { error: empErr } = await supabase.from("employees").insert({
    id:                employeeId,
    company_id:        req.params.id,
    name:              jr.employee_name,
    preferred_asset:   jr.preferred_asset,
    preferred_chain_id: jr.preferred_chain_id || company?.chain_id || 11155111,
    settle_address:    jr.employee_address,
    solana_address:    jr.solana_address || null,
    salary_amount:     Number(salaryAmount),
  });
  if (empErr) return res.status(500).json({ error: empErr.message });

  await supabase.from("join_requests").update({ status: "accepted" }).eq("id", req.params.requestId);

  res.json({ ok: true, employeeId });
});

// DELETE /api/company/:id/join-requests/:requestId  — reject/dismiss
router.delete("/:id/join-requests/:requestId", async (req, res) => {
  const { error } = await supabase
    .from("join_requests")
    .update({ status: "rejected" })
    .eq("id", req.params.requestId)
    .eq("company_id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// GET /api/company/:id
router.get("/:id", async (req, res) => {
  try {
    const data = await getCompany(req.params.id);
    if (!data) return res.status(404).json({ error: "Company not found" });

    const company = {
      ...data,
      paymentAsset:  data.payment_asset,
      chainId:       data.chain_id || DEFAULT_CHAIN_ID,
      walletAddress: data.wallet_address,
      employees:     data.employees.map(shapeEmployee),
    };
    res.json(company);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
