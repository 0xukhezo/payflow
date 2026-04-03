import { Router } from "express";
import { supabase } from "../db/supabase.js";
import { createRpContext, verifyProof } from "../services/worldid.js";

const router = Router();

// POST /api/worldid/sign-request
// Frontend calls this to get an RpContext before opening IDKit
router.post("/sign-request", (req, res) => {
  try {
    const { action } = req.body;
    const rpContext = createRpContext(action);
    res.json(rpContext);
  } catch (err) {
    console.error("World ID sign-request error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/worldid/verify
router.post("/verify", async (req, res) => {
  try {
    const { rp_id, idkitResponse, employeeId, companyId } = req.body;

    if (!rp_id || !idkitResponse) {
      return res.status(400).json({ error: "Missing required fields: rp_id, idkitResponse" });
    }

    const result = await verifyProof(rp_id, idkitResponse);

    if (!result.verified) {
      return res.status(400).json({ error: result.error });
    }

    const nullifier = idkitResponse?.responses?.[0]?.nullifier;

    if (employeeId && companyId) {
      // Employee already on payroll — update their record directly
      const { error: dbErr } = await supabase.from("employees")
        .update({ world_id_verified: true, nullifier_hash: nullifier || null })
        .eq("id", employeeId)
        .eq("company_id", companyId);
      if (dbErr) console.error("World ID DB update failed:", dbErr.message);
    } else if (req.body.walletAddress) {
      // Employee not on payroll yet — persist verification by wallet address
      const { error: dbErr } = await supabase.from("world_id_verifications")
        .upsert({ address: req.body.walletAddress.toLowerCase(), nullifier_hash: nullifier || null })
        .eq("address", req.body.walletAddress.toLowerCase());
      if (dbErr) console.error("World ID pre-verify save failed:", dbErr.message);
    }

    res.json({ verified: true });
  } catch (err) {
    console.error("World ID verify error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/worldid/verified/:address
// Check if a wallet address has a pre-verification record (employee not yet on payroll)
router.get("/verified/:address", async (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    const { data, error } = await supabase
      .from("world_id_verifications")
      .select("address, nullifier_hash")
      .eq("address", address)
      .maybeSingle();
    if (error) throw error;
    res.json({ verified: !!data, nullifierHash: data?.nullifier_hash || null });
  } catch (err) {
    console.error("World ID verified check error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
