/**
 * World ID Proof Verification Service
 * Validates World ID 4.0 proofs server-side
 */
import { signRequest } from "@worldcoin/idkit-server";

const WORLD_ID_ACTION = process.env.WORLD_ID_ACTION || "verify-employee";
const RP_ID = process.env.RP_ID || "";
const RP_SIGNING_KEY = process.env.RP_SIGNING_KEY || "";

// In-memory store for verified nullifiers (prevents double-use)
const verifiedNullifiers = new Map();

/**
 * Generate an RpContext to send to the frontend before opening IDKit
 */
export function createRpContext(action) {
  const actionId = action || WORLD_ID_ACTION;
  const { sig, nonce, createdAt, expiresAt } = signRequest(actionId, RP_SIGNING_KEY);
  return {
    rp_id: RP_ID,
    nonce,
    created_at: createdAt,
    expires_at: expiresAt,
    signature: sig,
  };
}

/**
 * Verify a World ID v4 proof by forwarding the IDKit result to the v4 API
 * @param {string} rpId - The RP ID
 * @param {object} idkitResponse - The full IDKit result forwarded as-is
 */
export async function verifyProof(rpId, idkitResponse) {
  // Extract nullifier for dedup (v4 uses responses[].nullifier, v3 uses responses[].nullifier)
  const nullifier = idkitResponse?.responses?.[0]?.nullifier;
  if (nullifier && verifiedNullifiers.has(nullifier)) {
    return { verified: false, error: "Nullifier already used — this identity has already verified." };
  }

  try {
    const res = await fetch(
      `https://developer.world.org/api/v4/verify/${rpId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(idkitResponse),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      return { verified: false, error: data.detail || data.error || data.message || "Verification failed" };
    }

    // Store nullifier to prevent reuse
    if (nullifier) {
      verifiedNullifiers.set(nullifier, { verifiedAt: Date.now() });
    }

    return { verified: true };
  } catch (err) {
    return { verified: false, error: err.message };
  }
}
