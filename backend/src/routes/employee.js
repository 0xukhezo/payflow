import { Router } from "express";
import { ethers } from "ethers";
import { supabase } from "../db/supabase.js";
import { payrollRuns } from "../services/payroll.js";

const router = Router();

// GET /api/employee/by-wallet/:address — look up employee record by their wallet address
router.get("/by-wallet/:address", async (req, res) => {
  try {
    const addr = req.params.address.toLowerCase();
    const { data, error } = await supabase
      .from("employees")
      .select("*, companies(id, name, payment_asset, wallet_address)")
      .or(`settle_address.ilike.${addr},solana_address.ilike.${addr}`)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Not found" });

    res.json({
      employeeId: data.id,
      companyId: data.company_id,
      name: data.name,
      preferredAsset: data.preferred_asset,
      preferredChainId: data.preferred_chain_id || 11155111,
      settleAddress: data.settle_address,
      solanaAddress: data.solana_address || null,
      salaryAmount: data.salary_amount,
      company: {
        id: data.companies.id,
        name: data.companies.name,
        paymentAsset: data.companies.payment_asset,
      },
    });
  } catch (err) {
    console.error("[employee/by-wallet] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/employee/:employeeId/preferred-asset
router.patch("/:employeeId/preferred-asset", async (req, res) => {
  try {
    const { preferredAsset, preferredChainId } = req.body;
    if (!preferredAsset) return res.status(400).json({ error: "preferredAsset required" });

    const updateData = { preferred_asset: preferredAsset.toLowerCase() };
    if (preferredChainId) updateData.preferred_chain_id = Number(preferredChainId);

    const { error } = await supabase
      .from("employees")
      .update(updateData)
      .eq("id", req.params.employeeId);

    if (error) throw new Error(error.message);
    res.json({ ok: true, preferredAsset: preferredAsset.toLowerCase(), preferredChainId: Number(preferredChainId) || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/employee/:employeeId/splits
router.get("/:employeeId/splits", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("payroll_splits")
      .select("id, percent, asset, chain_id, settle_address")
      .eq("employee_id", req.params.employeeId)
      .order("created_at");
    if (error) throw new Error(error.message);
    res.json({ splits: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/employee/:employeeId/splits — replaces all splits for the employee
router.put("/:employeeId/splits", async (req, res) => {
  try {
    const { splits, solanaAddress } = req.body;
    if (!Array.isArray(splits)) return res.status(400).json({ error: "splits must be an array" });

    if (splits.length > 0) {
      const total = splits.reduce((sum, s) => sum + (Number(s.percent) || 0), 0);
      if (total !== 100) return res.status(400).json({ error: `Splits must sum to 100% (got ${total}%)` });
      const hasSolSplit = splits.some((s) => s.asset?.toLowerCase() === "sol");
      if (hasSolSplit && !solanaAddress) {
        return res.status(400).json({ error: "solanaAddress required when a SOL split is included" });
      }
      for (const s of splits) {
        if (!s.asset || !s.chain_id || !s.percent) return res.status(400).json({ error: "Each split needs asset, chain_id, percent" });
        if (s.percent <= 0 || s.percent > 100) return res.status(400).json({ error: "percent must be 1–100" });
      }
    }

    // Persist solana_address to employees record if provided
    if (solanaAddress) {
      await supabase.from("employees").update({ solana_address: solanaAddress }).eq("id", req.params.employeeId);
    }

    const { error: delErr } = await supabase
      .from("payroll_splits")
      .delete()
      .eq("employee_id", req.params.employeeId);
    if (delErr) throw new Error(delErr.message);

    if (splits.length > 0) {
      const rows = splits.map((s) => ({
        employee_id:   req.params.employeeId,
        percent:       Number(s.percent),
        asset:         s.asset.toLowerCase(),
        chain_id:      Number(s.chain_id),
        settle_address: s.settleAddress?.trim() || null,
      }));
      const { error: insErr } = await supabase.from("payroll_splits").insert(rows);
      if (insErr) throw new Error(insErr.message);
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/employee/:address/history
router.get("/:address/history", async (req, res) => {
  try {
    const { address } = req.params;

    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: "Invalid Ethereum address" });
    }

    // Query Supabase payroll_runs table
    const { data: dbRuns, error: dbError } = await supabase
      .from("payroll_runs")
      .select("*")
      .or(`settle_address.ilike.${address}`)
      .order("created_at", { ascending: false });

    if (dbError) console.warn("Supabase payroll_runs query failed:", dbError.message);

    const runs = (dbRuns || []).map((r) => ({
      employee: address,
      shiftId: r.id,
      amount: r.settle_amount != null ? Number(r.settle_amount).toFixed(8) : "—",
      asset: r.settle_asset,
      settleChainId: r.settle_chain_id || 11155111,
      depositChainId: r.deposit_chain_id || 11155111,
      swapTxHash: r.id?.startsWith("0x") ? r.id : null,
      transferTxHash: r.transfer_tx_hash || null,
      timestamp: new Date(r.created_at).getTime(),
      date: r.created_at,
      status: r.status,
      source: "db",
    }));

    // Also merge any in-memory runs not yet in DB
    for (const run of payrollRuns.values()) {
      if (
        run.settleAddress?.toLowerCase() === address.toLowerCase() &&
        !runs.find((r) => r.shiftId === run.shiftId)
      ) {
        runs.push({
          employee: address,
          shiftId: run.shiftId,
          amount: run.settleAmount?.toFixed(8),
          asset: run.settleAsset,
          timestamp: new Date(run.createdAt).getTime(),
          date: run.createdAt,
          status: run.status,
          source: "in-memory",
        });
      }
    }

    res.json({ address, payments: runs });
  } catch (err) {
    console.error("Employee history error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
