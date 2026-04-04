import { Router }              from "express";
import { supabase }             from "../db/supabase.js";
import { createRpContext, verifyProof } from "../services/worldid.js";

const router = Router();

// POST /api/worldid/sign-request
// Returns RP context (sig, nonce, timestamps) for the frontend to open IDKit.
router.post("/sign-request", (req, res) => {
  try {
    const { action } = req.body;
    const rpContext  = createRpContext(action);
    res.json(rpContext);
  } catch (err) {
    console.error("[WorldID] sign-request error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/worldid/verify
// Forwards the IDKit result to the Developer Portal and marks the employee as verified.
router.post("/verify", async (req, res) => {
  try {
    const { rp_id, idkitResponse, employeeId, companyId, walletAddress } = req.body;

    if (!rp_id || !idkitResponse) {
      return res.status(400).json({ error: "Missing rp_id or idkitResponse" });
    }

    const result = await verifyProof(rp_id, idkitResponse);

    if (!result.verified) {
      return res.status(400).json({ error: result.error });
    }

    // Extract nullifier to prevent replay attacks (v4 uses responses[].nullifier)
    const nullifier = idkitResponse?.responses?.[0]?.nullifier ?? null;

    if (employeeId && companyId) {
      // Employee already on payroll — update record directly
      const { error: dbErr } = await supabase
        .from("employees")
        .update({ world_id_verified: true, nullifier_hash: nullifier })
        .eq("id", employeeId)
        .eq("company_id", companyId);
      if (dbErr) console.error("[WorldID] DB update failed:", dbErr.message);
    } else if (walletAddress) {
      // Employee not on payroll yet — store by wallet address for later linking
      const { error: dbErr } = await supabase
        .from("world_id_verifications")
        .upsert({ address: walletAddress.toLowerCase(), nullifier_hash: nullifier });
      if (dbErr) console.error("[WorldID] pre-verify save failed:", dbErr.message);
    }

    res.json({ verified: true });
  } catch (err) {
    console.error("[WorldID] verify error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/worldid/verified/:address
// Check if a wallet has a pre-verification record (before joining a company).
router.get("/verified/:address", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("world_id_verifications")
      .select("address, nullifier_hash")
      .eq("address", req.params.address.toLowerCase())
      .maybeSingle();
    if (error) throw error;
    res.json({ verified: !!data, nullifierHash: data?.nullifier_hash ?? null });
  } catch (err) {
    console.error("[WorldID] verified check error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
