/**
 * World ID Proof Verification Service
 * Follows https://docs.world.org/world-id/idkit/integrate
 */
import { signRequest } from "@worldcoin/idkit-core/signing";

const RP_ID          = process.env.RP_ID          || "";
const RP_SIGNING_KEY = process.env.RP_SIGNING_KEY || "";
const WORLD_ACTION   = process.env.WORLD_ID_ACTION || "verify-employee";

/**
 * Generate RP context to send to the frontend before opening IDKit.
 * Never expose RP_SIGNING_KEY to the client.
 */
export function createRpContext(action) {
  const { sig, nonce, createdAt, expiresAt } = signRequest({
    signingKeyHex: RP_SIGNING_KEY,
    action: action || WORLD_ACTION,
  });
  return {
    rp_id:      RP_ID,
    nonce,
    created_at: createdAt,
    expires_at: expiresAt,
    signature:  sig,
  };
}

/**
 * Verify a World ID proof by forwarding the IDKit result to the Developer Portal.
 * @param {string} rpId          - RP ID from the Developer Portal
 * @param {object} idkitResponse - The full IDKit result, forwarded as-is
 */
export async function verifyProof(rpId, idkitResponse) {
  const res = await fetch(
    `https://developer.world.org/api/v4/verify/${rpId}`,
    {
      method:  "POST",
      headers: { "content-type": "application/json" },
      body:    JSON.stringify(idkitResponse),
    },
  );

  const data = await res.json();

  if (!res.ok) {
    return { verified: false, error: data.detail || data.error || data.message || "Verification failed" };
  }

  return { verified: true };
}
