/**
 * Converts raw viem/ethers/wallet errors into short, user-friendly messages.
 */
export function friendlyError(err: unknown): string {
  const raw = (err instanceof Error ? err.message : String(err)).toLowerCase();

  if (raw.includes("user rejected") || raw.includes("user denied") || raw.includes("rejected the request"))
    return "Transaction rejected.";
  if (raw.includes("insufficient funds") || raw.includes("exceeds balance"))
    return "Insufficient funds.";
  if (raw.includes("allowance") || raw.includes("approve"))
    return "Insufficient USDC allowance — approve first.";
  if (raw.includes("gas") && (raw.includes("estimate") || raw.includes("fee")))
    return "Transaction would fail — check your balance.";
  if (raw.includes("network") || raw.includes("rpc") || raw.includes("timeout") || raw.includes("fetch"))
    return "Network error — please try again.";
  if (raw.includes("nonce"))
    return "Transaction nonce conflict — please try again.";

  // Last resort: first line only, capped at 80 chars
  const first = (err instanceof Error ? err.message : String(err)).split("\n")[0].trim();
  return first.length > 80 ? first.slice(0, 77) + "…" : first;
}
